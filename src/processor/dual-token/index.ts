import { Meter } from '../../meter-rest';
import { Persist } from './persist';
import { blockIDtoNum, displayID } from '../../utils';
import { EnergyAddress, getPreAllocAccount, Network } from '../../const';
import { getConnection, EntityManager } from 'typeorm';
import { BlockProcessor, SnapAccount } from './block-processor';
import { AssetMovement } from '../../powergrid-db/entity/movement';
import { Account } from '../../powergrid-db/entity/account';
import { Snapshot } from '../../powergrid-db/entity/snapshot';
import {
  insertSnapshot,
  clearSnapShot,
  removeSnapshot,
  listRecentSnapshot,
} from '../../service/snapshot';
import { Processor } from '../processor';
import { AssetType, SnapType, MoveType } from '../../powergrid-db/types';
import * as logger from '../../logger';
import { AggregatedMovement } from '../../powergrid-db/entity/aggregated-move';
import { Block } from '../../powergrid-db/entity/block';
import { TransactionMeta } from '../../powergrid-db/entity/tx-meta';
import { getBlockByNumber } from '../../service/block';

export class DualToken extends Processor {
  private persist: Persist;

  constructor(readonly meter: Meter) {
    super();
    this.persist = new Persist();
  }

  protected loadHead(manager?: EntityManager) {
    return this.persist.getHead(manager);
  }

  protected async saveHead(head: number, manager?: EntityManager) {
    await this.persist.saveHead(head, manager);
    return;
  }

  protected bornAt() {
    return Promise.resolve(0);
  }

  protected get snapType() {
    return SnapType.DualToken;
  }

  /**
   * @return inserted column number
   */
  protected async processBlock(
    block: Block,
    txs: TransactionMeta[],
    manager: EntityManager,
    saveSnapshot = false
  ) {
    const proc = new BlockProcessor(block, this.meter, manager);

    const attachAggregated = (transfer: AssetMovement) => {
      if (transfer.sender === transfer.recipient) {
        const move = manager.create(AggregatedMovement, {
          participant: transfer.sender,
          type: MoveType.Self,
          asset: transfer.asset,
          seq: {
            blockNumber: block.number,
            moveIndex: transfer.moveIndex,
          },
        });

        transfer.aggregated = [move];
      } else {
        const sender = manager.create(AggregatedMovement, {
          participant: transfer.sender,
          type: MoveType.Out,
          asset: transfer.asset,
          seq: {
            blockNumber: block.number,
            moveIndex: transfer.moveIndex,
          },
        });

        const recipient = manager.create(AggregatedMovement, {
          participant: transfer.recipient,
          type: MoveType.In,
          asset: transfer.asset,
          seq: {
            blockNumber: block.number,
            moveIndex: transfer.moveIndex,
          },
        });

        transfer.aggregated = [sender, recipient];
      }
    };

    for (const meta of txs) {
      for (const [clauseIndex, o] of meta.transaction.outputs.entries()) {
        for (const [logIndex, t] of o.transfers.entries()) {
          const token = meta.transaction.clauses[clauseIndex].token;
          let asset = AssetType.MTR;
          if (token === 1) {
            asset = AssetType.MTRG;
          }
          const transfer = manager.create(AssetMovement, {
            ...t,
            amount: BigInt(t.amount),
            txID: meta.txID,
            blockID: block.id,
            asset: asset,
            moveIndex: {
              txIndex: meta.seq.txIndex,
              clauseIndex,
              logIndex,
            },
          });
          attachAggregated(transfer);

          if (token === 1) {
            await proc.transferMTR(transfer);
          } else {
            await proc.transferMTRG(transfer);
          }
          if (saveSnapshot) {
            logger.log(
              `Account(${transfer.sender}) -> Account(${transfer.recipient}): ${transfer.amount} VET`
            );
          }
        }
      }
      await proc.touchMTR(meta.transaction.gasPayer);
    }
    if (txs.length) {
      await proc.touchMTR(block.beneficiary);
    }

    if (proc.Movement.length) {
      await this.persist.saveMovements(proc.Movement, manager);
    }
    if (saveSnapshot) {
      const snap = proc.snapshot();
      await insertSnapshot(snap, manager);
    }

    await proc.finalize();
    const accs = proc.accounts();
    if (accs.length) {
      await this.persist.saveAccounts(accs, manager);
    }

    return proc.Movement.length + accs.length;
  }

  protected async latestTrunkCheck() {
    let head = await this.getHead();

    const snapshots = await listRecentSnapshot(head, this.snapType);

    if (snapshots.length) {
      for (; snapshots.length; ) {
        if (snapshots[0].block.isTrunk === false) {
          break;
        }
        snapshots.shift();
      }
      if (snapshots.length) {
        await this.revertSnapshot(snapshots);
      }
    }

    head = await this.getHead();
    await clearSnapShot(head, this.snapType);
  }

  protected async processGenesis() {
    const block = (await getBlockByNumber(0))!;

    await getConnection().transaction(async (manager) => {
      const proc = new BlockProcessor(block, this.meter, manager);

      for (const addr of getPreAllocAccount(block.id as Network)) {
        await proc.genesisAccount(addr);
      }

      await proc.finalize();
      await this.persist.saveAccounts(proc.accounts(), manager);
      await this.saveHead(0, manager);
    });
    this.head = 0;
  }

  private async revertSnapshot(snapshots: Snapshot[]) {
    const headNum = blockIDtoNum(snapshots[0].blockID) - 1;
    const headID = snapshots[0].blockID;
    const toRevert = snapshots.map((x) => x.blockID);
    await getConnection().transaction(async (manager) => {
      const accounts = new Map<string, Account>();
      const accCreated: string[] = [];

      for (; snapshots.length; ) {
        const snap = snapshots.pop()!;
        if (snap.data) {
          for (const snapAcc of snap.data as SnapAccount[]) {
            if (snapAcc.firstSeen === snap.block.timestamp) {
              accCreated.push(snapAcc.address);
            } else {
              const acc = manager.create(Account, {
                address: snapAcc.address,
                balance: BigInt(snapAcc.balance),
                energy: BigInt(snapAcc.energy),
                blockTime: snapAcc.blockTime,
                firstSeen: snapAcc.firstSeen,
                code: snapAcc.code,
              });
              accounts.set(snapAcc.address, acc);
            }
          }
        }
      }

      const toSave: Account[] = [];
      for (const [_, acc] of accounts.entries()) {
        toSave.push(acc);
        logger.log(
          `Account(${acc.address}) reverted to VET(${acc.balance}) Energy(${
            acc.balance
          }) BlockTime(${acc.blockTime}) at Block(${displayID(headID)})`
        );
      }
      for (const acc of accCreated) {
        logger.log(
          `newAccount(${acc}) removed for revert at Block(${displayID(headID)})`
        );
      }

      if (accCreated.length) {
        await this.persist.removeAccounts(accCreated);
      }
      await this.persist.saveAccounts(toSave, manager);
      await this.persist.removeMovements(toRevert, manager);
      await removeSnapshot(toRevert, this.snapType, manager);
      await this.saveHead(headNum, manager);
      logger.log('-> revert to head: ' + headNum);
    });
    this.head = headNum;
  }
}
