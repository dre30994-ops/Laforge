"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";

import {
  associatedTokenAddress,
  fetchPool,
  ixClaim,
  ixCompound,
  ixStake,
  ixUnstake,
  poolPda,
  positionPda,
  programId,
  rewardVaultPda,
  stakeVaultPda,
  stakingMint,
  TREASURY,
  type StakingAccounts,
} from "@/lib/stakingClient";

export type StakingStatus = "idle" | "building" | "signing" | "success" | "error";

export interface StakingResult {
  status: StakingStatus;
  signature: string | null;
  error: string | null;
}

const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";

/**
 * Build and send the four staking transactions (stake / unstake / claim /
 * compound) through the connected Solana wallet (@solana/wallet-adapter).
 *
 * Reads the pool account on-chain to discover the mint, vaults, schedule, and
 * token program (nothing is hardcoded beyond the program id + mint env var),
 * assembles a legacy transaction, and hands it to the wallet-adapter's
 * `sendTransaction`, which signs (fee payer) and broadcasts, returning the
 * transaction signature.
 */
export function useStaking() {
  const { connection: adapterConnection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  const [status, setStatus] = useState<StakingStatus>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Prefer the provider's connection; fall back to a direct one (keeps reads
  // working even if the provider endpoint differs from NEXT_PUBLIC_RPC_URL).
  const connection = useMemo(
    () => adapterConnection ?? new Connection(RPC_URL, "confirmed"),
    [adapterConnection]
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setSignature(null);
    setError(null);
  }, []);

  /**
   * Resolve every account the instructions need from the on-chain pool state,
   * for the currently connected wallet.
   */
  const resolveAccounts = useCallback(
    async (ownerStr: string): Promise<StakingAccounts> => {
      const pid = programId();
      const mint = stakingMint();
      const owner = new PublicKey(ownerStr);
      const pool = poolPda(mint, pid);

      const parsed = await fetchPool(connection, pool);
      if (!parsed) {
        throw new Error(
          "Staking pool not found on-chain for the configured mint. " +
            "Check NEXT_PUBLIC_STAKING_MINT and that the pool is initialized."
        );
      }

      const tokenProgram = parsed.tokenProgram;
      return {
        owner,
        pool,
        position: positionPda(pool, owner, pid),
        schedule: parsed.schedule,
        stakeVault: stakeVaultPda(pool, pid),
        rewardVault: rewardVaultPda(pool, pid),
        mint,
        userTokenAccount: associatedTokenAddress(owner, mint, tokenProgram),
        treasuryTokenAccount: associatedTokenAddress(TREASURY, mint, tokenProgram),
        tokenProgram,
      };
    },
    [connection]
  );

  /** Assemble a legacy tx, then sign + send via the wallet adapter. */
  const send = useCallback(
    async (instructions: TransactionInstruction[], feePayer: PublicKey) => {
      if (!publicKey) throw new Error("No connected Solana wallet.");

      const tx = new Transaction();
      tx.add(...instructions);
      tx.feePayer = feePayer;
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;

      setStatus("signing");
      // wallet-adapter signs (fee payer) and broadcasts, returning the sig.
      const sig = await sendTransaction(tx, connection);

      // Best-effort confirmation so the UI reflects a landed tx.
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      setSignature(sig);
      setStatus("success");
      return sig;
    },
    [publicKey, connection, sendTransaction]
  );

  const run = useCallback(
    async (build: (accts: StakingAccounts) => Promise<TransactionInstruction[]>) => {
      if (!publicKey) {
        setError("Connect a wallet first.");
        setStatus("error");
        return null;
      }
      try {
        setError(null);
        setStatus("building");
        const accts = await resolveAccounts(publicKey.toBase58());
        const ixs = await build(accts);
        return await send(ixs, accts.owner);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setStatus("error");
        return null;
      }
    },
    [publicKey, resolveAccounts, send]
  );

  const stake = useCallback(
    (amount: bigint) => run(async (a) => [await ixStake(a, amount)]),
    [run]
  );

  const unstake = useCallback(
    (amount: bigint) => run(async (a) => [await ixUnstake(a, amount)]),
    [run]
  );

  const claim = useCallback(
    () => run(async (a) => [await ixClaim(a)]),
    [run]
  );

  const compound = useCallback(
    () => run(async (a) => [await ixCompound(a)]),
    [run]
  );

  const result: StakingResult = { status, signature, error };

  return { stake, unstake, claim, compound, reset, result, walletReady: !!publicKey };
}

