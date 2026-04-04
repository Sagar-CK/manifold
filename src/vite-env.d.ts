/// <reference types="vite/client" />

declare module "tsne" {
  export type TsneOptions = { perplexity?: number; dim?: number; epsilon?: number };
  export class tSNE {
    constructor(opt?: TsneOptions);
    initDataRaw(X: number[][]): void;
    step(): void;
    getSolution(): number[][];
  }
  const tsnejs: { tSNE: typeof tSNE };
  export default tsnejs;
}
