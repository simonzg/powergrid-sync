import { Persist } from '../../sync/persist';
import { getConnection, MoreThan, createConnection } from 'typeorm';
import { Block } from '../../powergrid-db/entity/block';
import { displayID, blockIDtoNum, getMeterREST } from '../../utils';
import { Meter } from '../../meter-rest';
import { Net } from '../../net';
import { getNetwork, checkNetworkWithDB } from '../network';
import { getExpandedBlockByID } from '../../service/block';

const net = getNetwork();
const STOP_NUMBER = 0;
const persist = new Persist();
const meter = new Meter(new Net(getMeterREST()), net);

const getBlockFromREST = async (id: string) => {
  const b = await meter.getBlock(id, 'regular');
  (async () => {
    let pos = b;
    for (let i = 0; i <= 10; i++) {
      pos = await meter.getBlock(pos!.parentID, 'regular');
    }
  })().catch();
  return b;
};

createConnection()
  .then(async () => {
    // await checkNetworkWithDB(net)

    const head = (await persist.getHead())!;
    const headNum = blockIDtoNum(head.value);

    const count = await getConnection()
      .getRepository(Block)
      .count({ number: MoreThan(headNum) });
    if (count) {
      throw new Error('larger number block exist than head');
    }

    let current = head.value;
    for (;;) {
      const { block, txs } = await getExpandedBlockByID(current);
      if (!block) {
        throw new Error(
          `Continuity failed: Block(${displayID(current)}) missing`
        );
      }

      let chainB: Meter.Block<'regular'>;
      try {
        chainB = (await getBlockFromREST(block.id))!;
      } catch {
        continue;
      }
      for (const [index, tx] of chainB.transactions.entries()) {
        if (txs[index].txID !== tx) {
          console.log(txs);
          throw new Error(
            `Block(${displayID(current)})'s TX(#${index}) mismatch`
          );
        }
      }
      if (block.number === STOP_NUMBER) {
        console.log('Finished integrity check');
        break;
      }
      if (block.number % 1000 === 0) {
        console.log(`Processed to Block(${displayID(block.id)})`);
      }
      current = block.parentID;
    }

    process.exit(0);
  })
  .catch((e: Error) => {
    console.log('Integrity check: ');
    console.log(e);
    process.exit(1);
  });
