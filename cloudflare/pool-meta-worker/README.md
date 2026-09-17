# Pool metadata worker

Off-chain nickname / image / banner / socials for Laforge pools.

Metadata is keyed by lowercased **token** address. Banner and socials are
persisted only when the matching factory reports `pool.tier() >= 1`.

## Factory map

The worker must call the factory on the **same chain the pool was created on**.
`FACTORY_BY_CHAIN` (see `src/index.ts` + `[vars]` in `wrangler.toml`):

| chainId | network    | factory                                      |
|--------:|------------|----------------------------------------------|
|    4663 | Robinhood  | `0x0E69CcAfB4f8bFBA970750703fc3154ff0D01691` |
|       1 | Ethereum   | `0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f` |
|    8453 | Base       | `0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f` |
|      56 | BNB Chain  | `0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f` |
|     999 | HyperEVM   | `0x84ee0716F5Af308Ce3D265962a9237e353fD0c6f` |

PUT `/pools/:token` accepts `{ chainId, factory, pool, ...meta }`. `chainId`
selects the factory/RPC. If it is omitted, the worker tries every known
factory via `poolOf(token)` and fails closed when none resolve.

Never trust `body.tier` for branded fields.
