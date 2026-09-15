"use client";

// Tiered USD price resolver for tokens on the active EVM chain.
//
//   getTokenUsdPrice(token, decimals) tries, in order (first hit wins):
//     1) Chainlink AggregatorV3 feed for the token (with L2 sequencer-uptime +
//        staleness guards). Best for crypto majors AND tokenized stocks — note
//        UniswapX (used for RH stock tokens) is an off-chain intent/auction
//        system with NO readable on-chain spot price, so stocks price here.
//     2) Uniswap V4  — StateView.getSlot0(poolId) → sqrtPriceX96 (PRIMARY: where
//        newly-created coins live). poolId = keccak256(abi.encode(PoolKey)); the
//        {fee,tickSpacing,hooks} candidates are configured (V4 has no getPool).
//     3) Uniswap V3  — factory.getPool(token,base,fee) across fee tiers → slot0.
//     4) Uniswap V2  — getPair + getReserves (reserve ratio).
//     5) null  → callers render "—".
//
// All addresses/params are env-configured (not hardcoded); with nothing set
// (testnet) every tier no-ops and the resolver returns null. Fill at mainnet:
//
//   Chainlink:
//     NEXT_PUBLIC_CHAINLINK_FEEDS         JSON { "<tokenLower>": "<feedProxy>" }
//     NEXT_PUBLIC_CHAINLINK_SEQUENCER     L2 sequencer uptime feed proxy (optional)
//     NEXT_PUBLIC_CHAINLINK_STALE_SECONDS max feed age before rejecting (default 3600)
//   Priced bases (shared by V4/V3/V2):
//     NEXT_PUBLIC_DEX_BASES               JSON [{ "token","feed"?, "assumeUsd"? }]
//   Uniswap V4 (primary):
//     NEXT_PUBLIC_UNIV4_STATE_VIEW        StateView lens address
//     NEXT_PUBLIC_UNIV4_POOL_CANDIDATES   JSON [{ "fee","tickSpacing","hooks"? }]
//   Uniswap V3:
//     NEXT_PUBLIC_UNIV3_FACTORY           V3 factory address
//     NEXT_PUBLIC_UNIV3_FEE_TIERS         JSON number[] (default [500,3000,10000])
//   Uniswap V2:
//     NEXT_PUBLIC_DEX_FACTORY             V2 factory address

import {
  getAddress,
  keccak256,
  encodeAbiParameters,
  type Hex,
} from "viem";
import { getPublicClient } from "@/lib/factoryClient";

// ── Config (env) ─────────────────────────────────────────────────────────────

function parseJson<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** token(lowercased) -> Chainlink feed proxy address. */
const CHAINLINK_FEEDS = parseJson<Record<string, string>>(
  process.env.NEXT_PUBLIC_CHAINLINK_FEEDS,
  {}
);
const SEQUENCER_FEED = (process.env.NEXT_PUBLIC_CHAINLINK_SEQUENCER ?? "").trim();
const STALE_SECONDS = Number(process.env.NEXT_PUBLIC_CHAINLINK_STALE_SECONDS ?? "3600") || 3600;
/** Grace period after the sequencer comes back up before trusting prices. */
const SEQUENCER_GRACE_SECONDS = 3600;

/**
 * A priced base token (shared by all Uniswap tiers). Provide EITHER:
 *   - `feed`: a Chainlink feed proxy that prices the base in USD, OR
 *   - `assumeUsd`: a fixed USD price (e.g. 1 for a stablecoin) — no feed needed.
 * If both are given, `feed` is tried first and `assumeUsd` is the fallback.
 */
type DexBase = { token: string; feed?: string; assumeUsd?: number };
const DEX_BASES = parseJson<DexBase[]>(process.env.NEXT_PUBLIC_DEX_BASES, []);

// Uniswap V2
const V2_FACTORY = (process.env.NEXT_PUBLIC_DEX_FACTORY ?? "").trim();

// Uniswap V3
const V3_FACTORY = (process.env.NEXT_PUBLIC_UNIV3_FACTORY ?? "").trim();
const V3_FEE_TIERS = parseJson<number[]>(process.env.NEXT_PUBLIC_UNIV3_FEE_TIERS, [500, 3000, 10000]);

// Uniswap V4
const V4_STATE_VIEW = (process.env.NEXT_PUBLIC_UNIV4_STATE_VIEW ?? "").trim();
/** Candidate pool params to try for V4 (V4 has no getPool). hooks defaults to
 *  the zero address (hookless pool) when omitted. */
type V4Candidate = { fee: number; tickSpacing: number; hooks?: string };
const V4_POOL_CANDIDATES = parseJson<V4Candidate[]>(
  process.env.NEXT_PUBLIC_UNIV4_POOL_CANDIDATES,
  []
);

// ── ABIs ─────────────────────────────────────────────────────────────────────

const AGGREGATOR_V3_ABI = [
  {
    type: "function",
    name: "latestRoundData",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "roundId", type: "uint80" },
      { name: "answer", type: "int256" },
      { name: "startedAt", type: "uint256" },
      { name: "updatedAt", type: "uint256" },
      { name: "answeredInRound", type: "uint80" },
    ],
  },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

const UNIV2_FACTORY_ABI = [
  {
    type: "function",
    name: "getPair",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
    ],
    outputs: [{ name: "pair", type: "address" }],
  },
] as const;

const UNIV2_PAIR_ABI = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

const ERC20_DECIMALS_ABI = [
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Uniswap V3: factory.getPool(tokenA, tokenB, fee) → pool; pool.slot0() → sqrtPriceX96.
const UNIV3_FACTORY_ABI = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const UNIV3_POOL_ABI = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

// Uniswap V4: StateView.getSlot0(poolId) → sqrtPriceX96 (lens over the singleton
// PoolManager). poolId = keccak256(abi.encode(PoolKey)).
const UNIV4_STATE_VIEW_ABI = [
  {
    type: "function",
    name: "getSlot0",
    stateMutability: "view",
    inputs: [{ name: "poolId", type: "bytes32" }],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
  },
] as const;

const ZERO = "0x0000000000000000000000000000000000000000";

// ── Chainlink read (with L2 sequencer + staleness guards) ────────────────────

/** True if a sequencer feed is configured AND reports the sequencer is up and
 *  past the grace period. If no sequencer feed is configured, returns true
 *  (skip the check). */
async function sequencerOk(): Promise<boolean> {
  if (!SEQUENCER_FEED) return true;
  try {
    const client = getPublicClient();
    const [, status, startedAt] = (await client.readContract({
      address: getAddress(SEQUENCER_FEED) as Hex,
      abi: AGGREGATOR_V3_ABI,
      functionName: "latestRoundData",
    })) as readonly [bigint, bigint, bigint, bigint, bigint];
    // 0 = up. Also require the grace period to have elapsed since it came up.
    if (status !== BigInt(0)) return false;
    const now = BigInt(Math.floor(Date.now() / 1000));
    return now - startedAt > BigInt(SEQUENCER_GRACE_SECONDS);
  } catch {
    return false; // fail closed
  }
}

/**
 * Read a Chainlink USD price (as a float) for a token if a feed is configured
 * and the value is fresh and positive. Returns null otherwise.
 */
async function chainlinkUsd(tokenLower: string): Promise<number | null> {
  const feed = CHAINLINK_FEEDS[tokenLower];
  if (!feed) return null;
  if (!(await sequencerOk())) return null;

  try {
    const client = getPublicClient();
    const feedAddr = getAddress(feed) as Hex;
    const [round, decimals] = await Promise.all([
      client.readContract({
        address: feedAddr,
        abi: AGGREGATOR_V3_ABI,
        functionName: "latestRoundData",
      }) as Promise<readonly [bigint, bigint, bigint, bigint, bigint]>,
      client.readContract({
        address: feedAddr,
        abi: AGGREGATOR_V3_ABI,
        functionName: "decimals",
      }) as Promise<number>,
    ]);
    const answer = round[1];
    const updatedAt = round[3];
    if (answer <= BigInt(0)) return null; // reject zero/negative
    const now = Math.floor(Date.now() / 1000);
    if (updatedAt === BigInt(0) || now - Number(updatedAt) > STALE_SECONDS) return null; // stale
    return Number(answer) / 10 ** Number(decimals);
  } catch {
    return null;
  }
}

// ── Shared helpers for the Uniswap tiers ─────────────────────────────────────

/** Resolve a base token's USD price: its Chainlink feed, else a fixed assumeUsd. */
async function baseUsdFor(base: DexBase): Promise<number | null> {
  if (base.feed) {
    const v = await chainlinkUsd(base.token.toLowerCase());
    if (v != null) return v;
  }
  if (typeof base.assumeUsd === "number" && base.assumeUsd > 0) return base.assumeUsd;
  return null;
}

const decimalsCache = new Map<string, number>();
async function tokenDecimals(addr: string): Promise<number> {
  const key = addr.toLowerCase();
  const cached = decimalsCache.get(key);
  if (cached != null) return cached;
  try {
    const d = (await getPublicClient().readContract({
      address: getAddress(addr) as Hex,
      abi: ERC20_DECIMALS_ABI,
      functionName: "decimals",
    })) as number;
    decimalsCache.set(key, Number(d));
    return Number(d);
  } catch {
    return 18;
  }
}

const Q192 = BigInt(2) ** BigInt(192);

/**
 * Convert a Uniswap sqrtPriceX96 to the price of `token` in `base` units.
 *
 * price(token1 in token0) = sqrtPriceX96^2 / 2^192, then adjust for decimals.
 * Returns "how many base tokens one token is worth" as a float.
 */
function priceFromSqrt(
  sqrtPriceX96: bigint,
  tokenIs0: boolean,
  tokenDec: number,
  baseDec: number
): number {
  if (sqrtPriceX96 <= BigInt(0)) return 0;
  // raw = (sqrtP^2 / 2^192) = price of token1 denominated in token0 (raw units).
  const num = sqrtPriceX96 * sqrtPriceX96;
  const raw = Number(num) / Number(Q192); // token1 per token0 (in raw base units ratio)
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  // If token is token0, 1 token0 = raw token1 (base). Decimal-adjust: multiply by
  // 10^(tokenDec - baseDec). If token is token1, invert first.
  if (tokenIs0) {
    return raw * 10 ** (tokenDec - baseDec);
  }
  return (1 / raw) * 10 ** (tokenDec - baseDec);
}

/** Sort two addresses ascending (Uniswap currency0 < currency1 ordering). */
function sortTokens(a: string, b: string): [Hex, Hex, boolean] {
  const A = getAddress(a);
  const B = getAddress(b);
  const aFirst = A.toLowerCase() < B.toLowerCase();
  return aFirst ? [A as Hex, B as Hex, true] : [B as Hex, A as Hex, false];
}

// ── Uniswap V4 (primary) ─────────────────────────────────────────────────────

/**
 * Derive `token` USD via Uniswap V4. For each priced base and each configured
 * pool-param candidate, compute poolId = keccak256(abi.encode(PoolKey)) and read
 * StateView.getSlot0(poolId). First initialized pool wins.
 */
async function v4Usd(tokenLower: string, tokenDec: number): Promise<number | null> {
  if (!V4_STATE_VIEW || V4_POOL_CANDIDATES.length === 0 || DEX_BASES.length === 0) return null;
  const client = getPublicClient();
  const stateView = getAddress(V4_STATE_VIEW) as Hex;

  for (const base of DEX_BASES) {
    if (base.token.toLowerCase() === tokenLower) continue;
    const [currency0, currency1, tokenIs0] = sortTokens(tokenLower, base.token);
    for (const cand of V4_POOL_CANDIDATES) {
      try {
        const hooks = getAddress(cand.hooks || ZERO) as Hex;
        // PoolKey = (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)
        const encoded = encodeAbiParameters(
          [
            { type: "address" },
            { type: "address" },
            { type: "uint24" },
            { type: "int24" },
            { type: "address" },
          ],
          [currency0, currency1, cand.fee, cand.tickSpacing, hooks]
        );
        const poolId = keccak256(encoded);
        const slot0 = (await client.readContract({
          address: stateView,
          abi: UNIV4_STATE_VIEW_ABI,
          functionName: "getSlot0",
          args: [poolId],
        })) as readonly [bigint, number, number, number];
        const sqrtP = slot0[0];
        if (sqrtP <= BigInt(0)) continue; // uninitialized pool
        const baseDec = await tokenDecimals(base.token);
        const tokenInBase = priceFromSqrt(sqrtP, tokenIs0, tokenDec, baseDec);
        if (tokenInBase <= 0) continue;
        const baseUsd = await baseUsdFor(base);
        if (baseUsd == null) continue;
        const usd = tokenInBase * baseUsd;
        if (Number.isFinite(usd) && usd > 0) return usd;
      } catch {
        // try next candidate/base
      }
    }
  }
  return null;
}

// ── Uniswap V3 ───────────────────────────────────────────────────────────────

async function v3Usd(tokenLower: string, tokenDec: number): Promise<number | null> {
  if (!V3_FACTORY || DEX_BASES.length === 0) return null;
  const client = getPublicClient();
  const factory = getAddress(V3_FACTORY) as Hex;
  const token = getAddress(tokenLower) as Hex;

  for (const base of DEX_BASES) {
    if (base.token.toLowerCase() === tokenLower) continue;
    const baseAddr = getAddress(base.token) as Hex;
    for (const fee of V3_FEE_TIERS) {
      try {
        const pool = (await client.readContract({
          address: factory,
          abi: UNIV3_FACTORY_ABI,
          functionName: "getPool",
          args: [token, baseAddr, fee],
        })) as string;
        if (!pool || pool.toLowerCase() === ZERO) continue;
        const poolAddr = getAddress(pool) as Hex;
        const [slot0, token0] = await Promise.all([
          client.readContract({ address: poolAddr, abi: UNIV3_POOL_ABI, functionName: "slot0" }) as Promise<
            readonly [bigint, number, number, number, number, number, boolean]
          >,
          client.readContract({ address: poolAddr, abi: UNIV3_POOL_ABI, functionName: "token0" }) as Promise<string>,
        ]);
        const sqrtP = slot0[0];
        if (sqrtP <= BigInt(0)) continue;
        const tokenIs0 = token0.toLowerCase() === tokenLower;
        const baseDec = await tokenDecimals(base.token);
        const tokenInBase = priceFromSqrt(sqrtP, tokenIs0, tokenDec, baseDec);
        if (tokenInBase <= 0) continue;
        const baseUsd = await baseUsdFor(base);
        if (baseUsd == null) continue;
        const usd = tokenInBase * baseUsd;
        if (Number.isFinite(usd) && usd > 0) return usd;
      } catch {
        // try next fee tier / base
      }
    }
  }
  return null;
}

// ── Uniswap V2 ───────────────────────────────────────────────────────────────

/**
 * Derive a token's USD price from a UniswapV2-style pair against a priced base:
 *   tokenUsd = (baseReserve / 10^baseDec) / (tokenReserve / 10^tokenDec) * baseUsd
 */
async function v2Usd(tokenLower: string, tokenDecimals_: number): Promise<number | null> {
  if (!V2_FACTORY || DEX_BASES.length === 0) return null;
  const client = getPublicClient();
  const factory = getAddress(V2_FACTORY) as Hex;
  const token = getAddress(tokenLower) as Hex;

  for (const base of DEX_BASES) {
    try {
      const baseAddr = getAddress(base.token) as Hex;
      if (baseAddr.toLowerCase() === token.toLowerCase()) continue;

      const pair = (await client.readContract({
        address: factory,
        abi: UNIV2_FACTORY_ABI,
        functionName: "getPair",
        args: [token, baseAddr],
      })) as string;
      if (!pair || pair.toLowerCase() === ZERO) continue;
      const pairAddr = getAddress(pair) as Hex;

      const [token0, reserves, baseDec] = await Promise.all([
        client.readContract({ address: pairAddr, abi: UNIV2_PAIR_ABI, functionName: "token0" }) as Promise<string>,
        client.readContract({ address: pairAddr, abi: UNIV2_PAIR_ABI, functionName: "getReserves" }) as Promise<
          readonly [bigint, bigint, number]
        >,
        tokenDecimals(base.token),
      ]);

      const tokenIs0 = token0.toLowerCase() === token.toLowerCase();
      const tokenReserve = tokenIs0 ? reserves[0] : reserves[1];
      const baseReserve = tokenIs0 ? reserves[1] : reserves[0];
      if (tokenReserve <= BigInt(0) || baseReserve <= BigInt(0)) continue;

      const baseUsd = await baseUsdFor(base);
      if (baseUsd == null) continue;

      const tokenAmt = Number(tokenReserve) / 10 ** tokenDecimals_;
      const baseAmt = Number(baseReserve) / 10 ** Number(baseDec);
      if (tokenAmt <= 0) continue;
      const tokenUsd = (baseAmt / tokenAmt) * baseUsd;
      if (!Number.isFinite(tokenUsd) || tokenUsd <= 0) continue;
      return tokenUsd;
    } catch {
      // try the next base
    }
  }
  return null;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve a token's USD price. Order: Chainlink → Uniswap V4 → V3 → V2 → null.
 * `tokenDecimals` is used for the AMM price math.
 */
export async function getTokenUsdPrice(
  tokenAddress: string,
  tokenDecimals: number
): Promise<number | null> {
  if (!tokenAddress) return null;
  const lower = tokenAddress.toLowerCase();

  const cl = await chainlinkUsd(lower);
  if (cl != null) return cl;

  const v4 = await v4Usd(lower, tokenDecimals);
  if (v4 != null) return v4;

  const v3 = await v3Usd(lower, tokenDecimals);
  if (v3 != null) return v3;

  return v2Usd(lower, tokenDecimals);
}

/**
 * Pool USD value = (staked base units / 10^decimals) * tokenUsdPrice.
 * Returns null when no price is available (caller renders "—").
 */
export async function getPoolValueUsd(
  tokenAddress: string,
  tokenDecimals: number,
  stakedBaseUnits: bigint
): Promise<number | null> {
  const price = await getTokenUsdPrice(tokenAddress, tokenDecimals);
  if (price == null) return null;
  const staked = Number(stakedBaseUnits) / 10 ** tokenDecimals;
  const value = staked * price;
  return Number.isFinite(value) ? value : null;
}

/** True when any price source is configured (so the UI can decide whether to try). */
export function priceFeedsConfigured(): boolean {
  const hasBases = DEX_BASES.length > 0;
  return (
    Object.keys(CHAINLINK_FEEDS).length > 0 ||
    (hasBases && (!!V4_STATE_VIEW && V4_POOL_CANDIDATES.length > 0)) ||
    (hasBases && !!V3_FACTORY) ||
    (hasBases && !!V2_FACTORY)
  );
}
