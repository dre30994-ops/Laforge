import { publicEnv } from "@/lib/publicEnv";
/**
 * Anchor-compatible client for the on-chain staking program.
 *
 * This mirrors the raw instruction layouts in
 * `tests/integration/src/helpers.rs` — the ground truth for discriminators,
 * PDA seeds, account ordering, and (mut/signer) flags. No IDL is generated for
 * this program, so we build instructions by hand exactly as the Rust test
 * harness does.
 *
 * Discriminator = sha256("global:<ix_name>")[..8].
 * Account metas must match each `#[derive(Accounts)]` struct field order.
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";

/** Legacy SPL Token program (the pool was initialized with `spl_token::id()`). */
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

/** Associated Token Account program. */
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
);

/** Treasury wallet that receives the 5% unstake tax (matches crate::TREASURY). */
export const TREASURY = new PublicKey(
  "BzwWjFrwuA31rvcJShTgvmNYnirpkp19Q4ijunj5pbuk"
);

const enc = new TextEncoder();

/** Program id from env (falls back to the declared id in lib.rs). */
export function programId(): PublicKey {
  return new PublicKey(
    publicEnv("PROGRAM_ID") ||
      "gXdv8YGX4SJQANNXTMsNEZMyvDKJkxgZn9KthxQB79o"
  );
}

/** Staking/reward SPL mint from env. Throws if unset — required for all ixs. */
export function stakingMint(): PublicKey {
  const m = publicEnv("STAKING_MINT");
  if (!m) {
    throw new Error(
      "NEXT_PUBLIC_STAKING_MINT is not set. Add the staking token mint to app/.env.local."
    );
  }
  return new PublicKey(m);
}

// ─── Anchor discriminator ───

/** sha256("global:<name>")[..8] via Web Crypto (browser + modern Node). */
export async function discriminator(ixName: string): Promise<Uint8Array> {
  const data = enc.encode(`global:${ixName}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest).slice(0, 8);
}

/** Little-endian u64 encoding of a bigint amount. */
export function u64le(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, value, true);
  return buf;
}

// ─── PDAs (seeds match helpers.rs / the program) ───

export function poolPda(mint: PublicKey, pid = programId()): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc.encode("pool"), mint.toBuffer()],
    pid
  )[0];
}

export function stakeVaultPda(pool: PublicKey, pid = programId()): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc.encode("stake_vault"), pool.toBuffer()],
    pid
  )[0];
}

export function rewardVaultPda(pool: PublicKey, pid = programId()): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc.encode("reward_vault"), pool.toBuffer()],
    pid
  )[0];
}

export function positionPda(
  pool: PublicKey,
  owner: PublicKey,
  pid = programId()
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [enc.encode("position"), pool.toBuffer(), owner.toBuffer()],
    pid
  )[0];
}

/** Derive the associated token account for (owner, mint) — no spl-token dep. */
export function associatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram = TOKEN_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  )[0];
}

// ─── Pool account parsing ───
//
// Layout mirrors PoolState::from_account_data in helpers.rs: after the 8-byte
// Anchor discriminator, seven Pubkeys (authority, operator, mint,
// token_program, stake_vault, reward_vault, schedule), then the scalar fields.

export interface ParsedPool {
  authority: PublicKey;
  operator: PublicKey;
  mint: PublicKey;
  tokenProgram: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  schedule: PublicKey;
  started: boolean;
  paused: boolean;
  minStake: bigint;
  /** Immutable schedule param: seconds per hourly tenure step (e.g. 3600). */
  tenureStepSeconds: bigint;
  /** Program start timestamp (unix seconds). Zero until started. */
  startTs: bigint;
  /** Accumulated reward per unit weight (A), scaled by ACC_SCALE. */
  accRewardPerWeight: bigint;
  /** Running sum of A at every hourly boundary (G_n). */
  sumAccAtBoundaries: bigint;
  /** Timestamp of the last crank/advance. */
  lastUpdateTs: bigint;
  /** Next hourly boundary index not yet crossed. */
  nextBoundaryIndex: number;
}

/** Fetch and parse the pool account. Returns null if the pool doesn't exist. */
export async function fetchPool(
  connection: Connection,
  pool: PublicKey
): Promise<ParsedPool | null> {
  const info = await connection.getAccountInfo(pool);
  if (!info) return null;
  const d = info.data.subarray(8); // skip discriminator
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);

  const pk = (offset: number) => new PublicKey(d.subarray(offset, offset + 32));

  // 7 pubkeys, offsets 0..224.
  const authority = pk(0);
  const operator = pk(32);
  const mint = pk(64);
  const tokenProgram = pk(96);
  const stakeVault = pk(128);
  const rewardVault = pk(160);
  const schedule = pk(192);

  // Scalar fields in declaration order (borsh, no padding), starting at 224:
  //   start_ts i64 @224
  const startTs = view.getBigInt64(224, true);
  //   end_ts i64 @232
  //   period_seconds u64 @240
  //   emission_step_seconds u64 @248
  //   emission_ramp_steps u64 @256
  //   tenure_step_seconds u64 @264
  const tenureStepSeconds = view.getBigUint64(264, true);
  //   tenure_ramp_steps u64 @272
  //   checkpoint_capacity u32 @280
  //   decimals u8 @284
  //   min_funding u64 @285
  //   min_stake u64 @293
  const minStake = view.getBigUint64(293, true);
  //   funded_amount u64 @301
  //   base_rate_per_period u64 @309
  //   started bool @317
  const started = d[317] !== 0;
  //   paused bool @318
  const paused = d[318] !== 0;
  //   total_staked u128 @319
  //   total_weight u128 @335
  //   ramping_stake u128 @351
  //   acc_reward_per_weight u128 @367
  const accRewardPerWeight = readU128LE(view, 367);
  //   sum_acc_at_boundaries u128 @383
  const sumAccAtBoundaries = readU128LE(view, 383);
  //   last_update_ts i64 @399
  const lastUpdateTs = view.getBigInt64(399, true);
  //   last_nonzero_stake_ts i64 @407
  //   next_boundary_index u32 @415
  const nextBoundaryIndex = view.getUint32(415, true);

  return {
    authority,
    operator,
    mint,
    tokenProgram,
    stakeVault,
    rewardVault,
    schedule,
    started,
    paused,
    minStake,
    tenureStepSeconds,
    startTs,
    accRewardPerWeight,
    sumAccAtBoundaries,
    lastUpdateTs,
    nextBoundaryIndex,
  };
}

/** Read a little-endian u128 from a DataView (two u64 halves). */
function readU128LE(view: DataView, offset: number): bigint {
  const lo = view.getBigUint64(offset, true);
  const hi = view.getBigUint64(offset + 8, true);
  return (hi << BigInt(64)) | lo;
}

// ─── Instruction builders ───
//
// Ordering and flags copied verbatim from helpers.rs. `isSigner`/`isWritable`
// map to AccountMeta::new (writable) vs new_readonly, and the `true` signer arg.

function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean) {
  return { pubkey, isSigner, isWritable };
}

export interface StakingAccounts {
  owner: PublicKey;
  pool: PublicKey;
  position: PublicKey;
  schedule: PublicKey;
  stakeVault: PublicKey;
  rewardVault: PublicKey;
  mint: PublicKey;
  userTokenAccount: PublicKey;
  treasuryTokenAccount: PublicKey;
  tokenProgram: PublicKey;
}

/** stake(amount): [owner(s,w), pool(w), position(w), schedule(w), stake_vault(w), mint, user_ata(w), token_prog, system_prog] */
export async function ixStake(
  a: StakingAccounts,
  amount: bigint,
  pid = programId()
): Promise<TransactionInstruction> {
  const disc = await discriminator("stake");
  const data = new Uint8Array([...disc, ...u64le(amount)]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      meta(a.owner, true, true),
      meta(a.pool, false, true),
      meta(a.position, false, true),
      meta(a.schedule, false, true),
      meta(a.stakeVault, false, true),
      meta(a.mint, false, false),
      meta(a.userTokenAccount, false, true),
      meta(a.tokenProgram, false, false),
      meta(SystemProgram.programId, false, false),
    ],
    data: Buffer.from(data),
  });
}

/** claim(): [owner(s), pool(w), position(w), schedule, reward_vault(w), mint, user_ata(w), token_prog] */
export async function ixClaim(
  a: StakingAccounts,
  pid = programId()
): Promise<TransactionInstruction> {
  const disc = await discriminator("claim");
  return new TransactionInstruction({
    programId: pid,
    keys: [
      meta(a.owner, true, false),
      meta(a.pool, false, true),
      meta(a.position, false, true),
      meta(a.schedule, false, false),
      meta(a.rewardVault, false, true),
      meta(a.mint, false, false),
      meta(a.userTokenAccount, false, true),
      meta(a.tokenProgram, false, false),
    ],
    data: Buffer.from(disc),
  });
}

/** unstake(amount): [owner(s), pool(w), position(w), schedule(w), stake_vault(w), mint, user_ata(w), treasury_ata(w), token_prog] */
export async function ixUnstake(
  a: StakingAccounts,
  amount: bigint,
  pid = programId()
): Promise<TransactionInstruction> {
  const disc = await discriminator("unstake");
  const data = new Uint8Array([...disc, ...u64le(amount)]);
  return new TransactionInstruction({
    programId: pid,
    keys: [
      meta(a.owner, true, false),
      meta(a.pool, false, true),
      meta(a.position, false, true),
      meta(a.schedule, false, true),
      meta(a.stakeVault, false, true),
      meta(a.mint, false, false),
      meta(a.userTokenAccount, false, true),
      meta(a.treasuryTokenAccount, false, true),
      meta(a.tokenProgram, false, false),
    ],
    data: Buffer.from(data),
  });
}

/** compound(): [owner(s), pool(w), position(w), schedule(w), reward_vault(w), stake_vault(w), mint, token_prog] */
export async function ixCompound(
  a: StakingAccounts,
  pid = programId()
): Promise<TransactionInstruction> {
  const disc = await discriminator("compound");
  return new TransactionInstruction({
    programId: pid,
    keys: [
      meta(a.owner, true, false),
      meta(a.pool, false, true),
      meta(a.position, false, true),
      meta(a.schedule, false, true),
      meta(a.rewardVault, false, true),
      meta(a.stakeVault, false, true),
      meta(a.mint, false, false),
      meta(a.tokenProgram, false, false),
    ],
    data: Buffer.from(disc),
  });
}



// ─── StakePosition account parsing ───
//
// Layout mirrors state/position.rs, after the 8-byte Anchor discriminator:
//   owner Pubkey(32), pool Pubkey(32),
//   amount u64(8), weighted_deposit_ts i64(8),
//   deposit_boundary_index u32(4), snapshot_k u32(4),
//   acc_snapshot u128(16), sum_acc_snapshot u128(16),
//   pending_rewards u64(8), total_claimed u64(8), bump u8(1).

export interface ParsedPosition {
  owner: PublicKey;
  pool: PublicKey;
  /** Staked principal, base units. */
  amount: bigint;
  /** Stake-weighted average deposit timestamp (unix seconds). */
  weightedDepositTs: bigint;
  depositBoundaryIndex: number;
  snapshotK: number;
  /** `A` at the moment of last settlement (acc_snapshot). */
  accSnapshot: bigint;
  /** `G_{n0 + snapshot_k}` at last settlement (sum_acc_snapshot). */
  sumAccSnapshot: bigint;
  /** Settled, unclaimed rewards on-chain, base units. Accrual since the last
   *  settlement is NOT included (that requires the O(1) formula + schedule). */
  pendingRewards: bigint;
  /** Lifetime rewards claimed by this position, base units. */
  totalClaimed: bigint;
}

/**
 * Fetch and parse the caller's StakePosition. Returns null if the position
 * account does not exist yet (user has never staked).
 */
export async function fetchPosition(
  connection: Connection,
  position: PublicKey
): Promise<ParsedPosition | null> {
  const info = await connection.getAccountInfo(position);
  if (!info) return null;
  const d = info.data.subarray(8); // skip discriminator
  const view = new DataView(d.buffer, d.byteOffset, d.byteLength);

  const owner = new PublicKey(d.subarray(0, 32));
  const pool = new PublicKey(d.subarray(32, 64));

  let off = 64;
  const amount = view.getBigUint64(off, true);
  off += 8;
  const weightedDepositTs = view.getBigInt64(off, true);
  off += 8;
  const depositBoundaryIndex = view.getUint32(off, true);
  off += 4;
  const snapshotK = view.getUint32(off, true);
  off += 4;
  const accSnapshot = readU128LE(view, off); // acc_snapshot u128
  off += 16;
  const sumAccSnapshot = readU128LE(view, off); // sum_acc_snapshot u128
  off += 16;
  const pendingRewards = view.getBigUint64(off, true);
  off += 8;
  const totalClaimed = view.getBigUint64(off, true);

  return {
    owner,
    pool,
    amount,
    weightedDepositTs,
    depositBoundaryIndex,
    snapshotK,
    accSnapshot,
    sumAccSnapshot,
    pendingRewards,
    totalClaimed,
  };
}

/**
 * Read the SPL token balance (base units) of a token account. Returns 0n when
 * the account doesn't exist. Standard SPL Token account layout: `amount` is a
 * u64 at byte offset 64.
 */
export async function fetchTokenBalance(
  connection: Connection,
  tokenAccount: PublicKey
): Promise<bigint> {
  const info = await connection.getAccountInfo(tokenAccount);
  if (!info || info.data.length < 72) return BigInt(0);
  const view = new DataView(
    info.data.buffer,
    info.data.byteOffset,
    info.data.byteLength
  );
  return view.getBigUint64(64, true);
}


// ─── Exact live pending rewards ───
//
// Replicates the program's O(1) accrual (crates/staking-math/src/accrual.rs)
// so the UI can show unclaimed rewards that have accrued *since* the position's
// last settlement — not just the settled `pending_rewards` field.

/** Fixed-point scale for A (matches staking-math ACC_SCALE = 1e18). */
export const ACC_SCALE = BigInt("1000000000000000000");
/** Tenure steps to the 2.0x cap (matches TENURE_RAMP_STEPS = 72). */
export const TENURE_RAMP_STEPS = BigInt(72);

/** Schedule header size before the checkpoints array. */
const SCHEDULE_CHECKPOINTS_OFFSET = 8 + 32 + 4 + 4 + 8; // disc, pool, lens, pad = 56
/** Each Checkpoint is two u128s: { acc, sum_acc } = 32 bytes. */
const CHECKPOINT_SIZE = 32;
/** Number of checkpoint slots (matches CHECKPOINT_CAPACITY = 384). */
export const CHECKPOINT_CAPACITY = 384;

/** capped_steps: min(k, 72), on bigint. */
function cappedSteps(k: bigint): bigint {
  return k > TENURE_RAMP_STEPS ? TENURE_RAMP_STEPS : k;
}

/**
 * Read only `checkpoints[index].sum_acc` (G at that boundary) from the ~16 KB
 * Schedule account using a `dataSlice` — fetches just 16 bytes over RPC.
 * Returns null if the index is out of the allocated range.
 */
export async function fetchCheckpointSumAcc(
  connection: Connection,
  schedule: PublicKey,
  index: number
): Promise<bigint | null> {
  if (index < 0 || index >= CHECKPOINT_CAPACITY) return null;
  const offset =
    SCHEDULE_CHECKPOINTS_OFFSET + index * CHECKPOINT_SIZE + 16; // +16 = sum_acc half
  const info = await connection.getAccountInfo(schedule, {
    dataSlice: { offset, length: 16 },
  });
  if (!info || info.data.length < 16) return null;
  const view = new DataView(
    info.data.buffer,
    info.data.byteOffset,
    info.data.byteLength
  );
  const lo = view.getBigUint64(0, true);
  const hi = view.getBigUint64(8, true);
  return (hi << BigInt(64)) | lo;
}

/**
 * The g_k (G_{n0 + min(k_now,72)}) needed by the accrual formula.
 *
 * Mirrors the program's branch: use the checkpoint at
 * `deposit_boundary_index + capped_steps(k_now)` when that index is within the
 * checkpoint capacity AND strictly below `next_boundary_index`; otherwise fall
 * back to the pool's live `sum_acc_at_boundaries`.
 *
 * Returns the g_k value; only performs an RPC read when a checkpoint is needed.
 */
export async function resolveGk(
  connection: Connection,
  pool: ParsedPool,
  position: ParsedPosition,
  kNow: bigint
): Promise<bigint> {
  const gIdx = position.depositBoundaryIndex + Number(cappedSteps(kNow));
  const inRange =
    gIdx < CHECKPOINT_CAPACITY && gIdx < pool.nextBoundaryIndex;
  if (!inRange) return pool.sumAccAtBoundaries;
  const cp = await fetchCheckpointSumAcc(connection, pool.schedule, gIdx);
  return cp ?? pool.sumAccAtBoundaries;
}

/**
 * The pure accrual bracket + multiply (no RPC), matching `accrual()`:
 *
 *   bracket = (72+k_now)*acc_now - (72+k_snap)*acc_snap - (g_k - sum_acc_snap)
 *   accrued = stake * bracket / ACC_SCALE   (floored)
 *
 * `kNow` is the tenure step at the pool's last update (uncapped input; capped
 * inside). Returns 0 when stake is 0 or the position went backwards in tenure
 * (defensive; the program would error).
 */
export function accrual(
  stake: bigint,
  accSnapshot: bigint,
  sumAccSnapshot: bigint,
  snapshotK: bigint,
  kNow: bigint,
  accNow: bigint,
  gK: bigint
): bigint {
  if (stake === BigInt(0)) return BigInt(0);

  const kNowC = cappedSteps(kNow);
  const kSnapC = cappedSteps(snapshotK);
  if (kNowC < kSnapC) return BigInt(0);

  const coeffNow = TENURE_RAMP_STEPS + kNowC;
  const coeffSnap = TENURE_RAMP_STEPS + kSnapC;

  const grown = coeffNow * accNow;
  const base = coeffSnap * accSnapshot;
  const boundaryCorrection = gK - sumAccSnapshot;

  const bracket = grown - base - boundaryCorrection;
  if (bracket <= BigInt(0)) return BigInt(0);

  return (stake * bracket) / ACC_SCALE;
}

/**
 * Exact live pending rewards (base units) for a position:
 * settled `pending_rewards` plus accrual since the last settlement.
 *
 * Reads at most one Schedule checkpoint (16 bytes via dataSlice). `kNow` uses
 * the pool's `last_update_ts` exactly as the program's `compute_pending` does
 * — accrual only advances as far as the pool has been cranked.
 */
export async function computePending(
  connection: Connection,
  pool: ParsedPool,
  position: ParsedPosition
): Promise<bigint> {
  if (position.amount === BigInt(0)) return position.pendingRewards;

  const tenureStep = pool.tenureStepSeconds;
  const elapsed =
    pool.lastUpdateTs > position.weightedDepositTs
      ? pool.lastUpdateTs - position.weightedDepositTs
      : BigInt(0);
  const kNow = cappedSteps(tenureStep > BigInt(0) ? elapsed / tenureStep : BigInt(0));

  const gK = await resolveGk(connection, pool, position, kNow);

  const accrued = accrual(
    position.amount,
    position.accSnapshot,
    position.sumAccSnapshot,
    BigInt(position.snapshotK),
    kNow,
    pool.accRewardPerWeight,
    gK
  );

  return position.pendingRewards + accrued;
}
