import { AssetMovement } from '../powergrid-db/entity/movement';
import { Config } from '../powergrid-db/entity/config';
import { Snapshot } from '../powergrid-db/entity/snapshot';
import { SnapType, AssetType } from '../powergrid-db/types';
import { getVIP180Token, Network } from '../const';
import { TokenBalance } from '../powergrid-db/entity/token-balance';
import { createConnection, getConnectionOptions } from 'typeorm';

const token = getVIP180Token(Network.MainNet, process.argv[2] || 'OCE');

Promise.resolve()
  .then(async () => {
    const opt = await getConnectionOptions();
    const conn = await createConnection(
      Object.assign({}, opt, {
        logging: true,
        logger: undefined,
      })
    );
    await conn
      .getRepository(AssetMovement)
      .delete({ asset: AssetType[token.symbol as keyof typeof AssetType] });
    await conn
      .getRepository(TokenBalance)
      .delete({ type: AssetType[token.symbol as keyof typeof AssetType] });
    await conn.getRepository(Snapshot).delete({
      type:
        SnapType.VIP180Token +
        AssetType[token.symbol as keyof typeof AssetType],
    });
    await conn
      .getRepository(Config)
      .delete({ key: `token-${token.symbol}-head` });
  })
  .then(() => {
    process.exit();
  })
  .catch((e) => {
    console.log(e);
  });
