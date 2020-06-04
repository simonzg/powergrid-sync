import { SnapType, MoveType } from '../../powergrid-db/types';
import { Meter } from '../../meter-rest';
import { Persist } from './persist';
import {
  insertSnapshot,
  listRecentSnapshot,
  clearSnapShot,
} from '../../service/snapshot';
import { EntityManager, getConnection } from 'typeorm';
import { Processor } from '../processor';
import * as logger from '../../logger';
import { blockIDtoNum } from '../../utils';
import { Block } from '../../powergrid-db/entity/block';
import { TransactionMeta } from '../../powergrid-db/entity/tx-meta';
import { AggregatedTransaction } from '../../powergrid-db/entity/aggregated-tx';
import { Snapshot } from '../../powergrid-db/entity/snapshot';

export class ExpandTX extends Processor {
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

  protected async bornAt() {
    return Promise.resolve(0);
  }

  protected get snapType() {
    return SnapType.ExpandTX;
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
    const aggregated: AggregatedTransaction[] = [];
    for (const [_, meta] of txs.entries()) {
      const rec = new Set<string | null>();

      for (const c of meta.transaction.clauses) {
        if (!rec.has(c.to)) {
          if (c.to !== meta.transaction.origin) {
            aggregated.push(
              manager.create(AggregatedTransaction, {
                participant: c.to,
                type: MoveType.In,
                txID: meta.txID,
                blockID: block.id,
                seq: { ...meta.seq },
              })
            );
          }
          rec.add(c.to);
        }
      }

      aggregated.push(
        manager.create(AggregatedTransaction, {
          participant: meta.transaction.origin,
          type: rec.has(meta.transaction.origin) ? MoveType.Self : MoveType.Out,
          txID: meta.txID,
          blockID: block.id,
          seq: { ...meta.seq },
        })
      );
    }
    await this.persist.saveTXs(aggregated, manager);
    if (saveSnapshot) {
      const snapshot = new Snapshot();
      snapshot.blockID = block.id;
      snapshot.type = this.snapType;
      snapshot.data = null;

      await insertSnapshot(snapshot, manager);
    }

    return aggregated.length;
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
        const headNum = blockIDtoNum(snapshots[0].blockID) - 1;
        const toRevert = snapshots.map((x) => x.blockID);

        await getConnection().transaction(async (manager) => {
          await this.persist.removeTXs(toRevert, manager);
          await this.saveHead(headNum, manager);
          logger.log('-> revert to head: ' + headNum);
        });
        this.head = headNum;
      }
    }

    head = await this.getHead();
    await clearSnapShot(head, this.snapType);
  }

  protected async processGenesis() {
    return;
  }
}
