import { Account } from '../powergrid-db/entity/account';
import { AssetMovement } from '../powergrid-db/entity/movement';
import { Config } from '../powergrid-db/entity/config';
import { Snapshot } from '../powergrid-db/entity/snapshot';
import { SnapType, AssetType } from '../powergrid-db/types';
import { In, createConnection, getConnectionOptions } from 'typeorm';

Promise.resolve()
  .then(async () => {
    const opt = await getConnectionOptions();
    const conn = await createConnection(
      Object.assign({}, opt, {
        logging: true,
        logger: undefined,
      })
    );

    await conn.getRepository(Account).clear();
    await conn
      .getRepository(AssetMovement)
      .delete({ asset: In([AssetType.VET, AssetType.VTHO]) });
    await conn.getRepository(Snapshot).delete({ type: SnapType.DualToken });
    await conn.getRepository(Config).delete({ key: 'dual-token-head' });
  })
  .then(() => {
    process.exit(0);
  })
  .catch((e: Error) => {
    console.log(e);
  });
