export const MAX_BLOCK_PROPOSERS = 101;
export const BLOCK_INTERVAL = 10;

export const blockIDtoNum = (blockID: string) => {
  if (typeof blockID === 'string' && !/^0x[0-9a-fA-f]{64}$/i.test(blockID)) {
    throw new Error('bytes32 required as param but got: ' + blockID);
  }

  return parseInt(blockID.slice(0, 10), 16);
};

export const bufferToHex = (val: Buffer) => {
  return '0x' + val.toString('hex');
};

export const sleep = (ms: number) => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const displayID = (blockID: string) => {
  return `${blockIDtoNum(blockID)}...${blockID.slice(58)}`;
};

export const sanitizeHex = (val: string) => {
  if (val.startsWith('0x')) {
    val = val.slice(2);
  }
  if (val.length % 2) {
    val = '0' + val;
  }
  return val;
};

export const hexToBuffer = (val: string) => {
  if (!/^0x[0-9a-fA-f]+/i.test(val)) {
    throw new Error('hex string required as param but got: ' + val);
  }

  return Buffer.from(sanitizeHex(val), 'hex');
};

export const isBytes32 = (val: string) => {
  return /^0x[0-9a-fA-f]{64}/i.test(val);
};

export const getMeterREST = () => {
  return process.env.METER_REST || 'http://localhost:8669';
};

class Metric {
  private duration = BigInt(0);
  constructor(readonly name: string) {}
  public start() {
    const s = process.hrtime.bigint();
    return () => {
      this.duration += process.hrtime.bigint() - s;
    };
  }
  public stats() {
    console.log(
      `Task[${this.name}] duration: ${this.duration / BigInt(1e6)}ms`
    );
    this.duration = BigInt(0);
  }
}

export class InterruptedError extends Error {
  constructor() {
    super('interrupted');
  }
}

export class WaitNextTickError extends Error {
  constructor() {
    super();
  }
}

WaitNextTickError.prototype.name = 'WaitNextTickError';
InterruptedError.prototype.name = 'InterruptedError';
