"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { isAddress, getAddress } from "viem";
import {
  validateCreateInputs,
  MAX_TAX_BPS,
  waitForPoolTx,
  PoolTier,
  TIER_FEE_WEI,
  fetchTierFee,
  BRONZE_MAX_DURATION_DAYS,
  MAX_DURATION_DAYS,
  type CreatePoolInputs,
} from "@/lib/factoryClient";
import { useEvmFactory } from "@/hooks/useEvmFactory";
import { setPoolMeta, fileToDataUrl, sanitizeSocialUrl, type PoolMeta } from "@/lib/poolMeta";
import { emitPoolsChanged } from "@/lib/poolEvents";
import { robinhoodExplorerUrl } from "@/lib/chains";

/**
 * A green "Create" button that opens a modal collecting the inputs needed to
 * launch a staking pool via the StakingFactory (Robinhood Chain / EVM), then
 * sends the createPool transaction with the fixed 0.02 ETH launch fee.
 *
 * The launcher (connected wallet) becomes the pool's operator and admin.
 */
export function CreatePoolButton({
  className,
  style,
  label = "Create",
  showIcon = true,
}: {
  className?: string;
  style?: React.CSSProperties;
  label?: string;
  showIcon?: boolean;
} = {}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          `inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl
                   text-sm font-semibold text-white border-none shadow-md
                   transition-transform active:scale-[0.98]`
        }
        style={
          style ?? {
            background: "linear-gradient(180deg, #22c55e, #16a34a)",
            fontFamily: "var(--font-mono, monospace)",
          }
        }
        aria-haspopup="dialog"
      >
        {showIcon && (
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        )}
        {label}
      </button>

      {open && <CreatePoolModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CreatePoolModal({ onClose }: { onClose: () => void }) {
  const { createPool } = useEvmFactory();
  const [token, setToken] = useState("");
  const [nickname, setNickname] = useState(""); // display-only, off-chain
  const [image, setImage] = useState(""); // data URL, off-chain
  const [imageError, setImageError] = useState("");
  const [treasury, setTreasury] = useState("");
  const [decimals, setDecimals] = useState("18");
  const [durationDays, setDurationDays] = useState("14"); // 1–14
  const [stakeTax, setStakeTax] = useState("0"); // percent
  const [unstakeTax, setUnstakeTax] = useState("0"); // percent
  const [fundingAmount, setFundingAmount] = useState(""); // whole tokens, one-time funding
  const [minStake, setMinStake] = useState(""); // whole tokens

  // Pricing tier + tier-gated features.
  const [tier, setTier] = useState<PoolTier>(PoolTier.Ecosystem);
  const [banner, setBanner] = useState(""); // data URL, Ecosystem/Marketing only
  const [bannerError, setBannerError] = useState("");
  const [website, setWebsite] = useState("");
  const [twitter, setTwitter] = useState("");
  const [telegram, setTelegram] = useState("");
  const [discord, setDiscord] = useState("");

  // Feature gating by tier.
  const canBrand = tier === PoolTier.Ecosystem || tier === PoolTier.Marketing; // banner + socials
  const isMarketing = tier === PoolTier.Marketing; // trending + verified-safe badge
  const maxDuration = tier === PoolTier.Bronze ? BRONZE_MAX_DURATION_DAYS : MAX_DURATION_DAYS;

  // Duration entry is clamped to the active tier's cap: Bronze ≤ 2 days,
  // Ecosystem/Marketing ≤ 30 days. We strip non-digits and never let the
  // stored value exceed maxDuration, so a larger number can't be typed in.
  function onDurationChange(v: string) {
    const digits = v.replace(/[^0-9]/g, "");
    if (digits === "") {
      setDurationDays("");
      return;
    }
    const n = Math.min(Number(digits), maxDuration);
    setDurationDays(String(n));
  }

  // If the tier changes to a lower cap (e.g. → Bronze) while a larger value is
  // already entered, clamp it down to that tier's maximum.
  useEffect(() => {
    setDurationDays((prev) => {
      if (prev === "") return prev;
      const n = Number(prev);
      return n > maxDuration ? String(maxDuration) : prev;
    });
  }, [maxDuration]);

  // Treasury gating for taxes. Taxes are paid to the treasury, so they can only
  // be set once a VALID treasury address is present. A blank treasury means
  // "no treasury / no tax"; a non-empty-but-malformed value is an error we
  // surface at the top of the form.
  const treasuryTrimmed = treasury.trim();
  // Non-strict: accept any valid 20-byte hex address regardless of EIP-55
  // checksum casing. viem's isAddress defaults to strict checksum validation,
  // which wrongly rejects lowercased (or mis-cased) addresses even though the
  // contract treats them case-insensitively.
  const treasuryValid = treasuryTrimmed !== "" && isAddress(treasuryTrimmed, { strict: false });
  const treasuryInvalid = treasuryTrimmed !== "" && !treasuryValid;
  const taxesDisabled = !treasuryValid;

  // When taxes are disabled (no valid treasury), force both tax fields to "0"
  // so a stale value can't be submitted, and the inputs read as empty/0.
  useEffect(() => {
    if (taxesDisabled) {
      setStakeTax("0");
      setUnstakeTax("0");
    }
  }, [taxesDisabled]);

  const [status, setStatus] = useState<"idle" | "submitting" | "confirming" | "done" | "error">("idle");
  const [message, setMessage] = useState<string>("");
  const [txHash, setTxHash] = useState<string>("");

  // Live per-tier launch fees read from the DEPLOYED factory (so a cheap test
  // factory shows its real prices). Seeded with the fallback constants; a
  // deferred effect replaces them with the on-chain values.
  const [fees, setFees] = useState<Record<PoolTier, bigint>>(TIER_FEE_WEI);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const [b, e, m] = await Promise.all([
          fetchTierFee(PoolTier.Bronze),
          fetchTierFee(PoolTier.Ecosystem),
          fetchTierFee(PoolTier.Marketing),
        ]);
        if (!cancelled) {
          setFees({
            [PoolTier.Bronze]: b,
            [PoolTier.Ecosystem]: e,
            [PoolTier.Marketing]: m,
          });
        }
      } catch {
        // keep the fallback constants
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, []);

  function toBaseUnits(whole: string, dec: number): bigint {
    // Parse a decimal token amount to base units without float error.
    const [intPart, fracPartRaw = ""] = whole.trim().split(".");
    const frac = (fracPartRaw + "0".repeat(dec)).slice(0, dec);
    const digits = (intPart.replace(/[^0-9]/g, "") || "0") + (dec > 0 ? frac : "");
    return BigInt(digits || "0");
  }

  function buildInputs(): { inputs?: CreatePoolInputs; error?: string } {
    const dec = Number(decimals);
    if (!Number.isInteger(dec) || dec < 0 || dec > 36) {
      return { error: "Decimals must be an integer between 0 and 36." };
    }
    const sTaxPct = Number(stakeTax);
    const uTaxPct = Number(unstakeTax);
    if (Number.isNaN(sTaxPct) || Number.isNaN(uTaxPct)) {
      return { error: "Taxes must be numbers (percent)." };
    }
    const dur = Number(durationDays);
    if (!Number.isInteger(dur) || dur < 1 || dur > maxDuration) {
      return {
        error:
          tier === PoolTier.Bronze
            ? `Bronze tier is capped at ${BRONZE_MAX_DURATION_DAYS} days (48h).`
            : `Duration must be a whole number of days between 1 and ${maxDuration}.`,
      };
    }
    // Canonicalize addresses to their EIP-55 checksummed form before they hit
    // the contract. We accept mixed/loose casing in the input (see the
    // strict:false check above, so users can paste lowercased addresses from
    // explorers), then normalize here for a consistent on-chain value. This
    // also acts as a final validity guard — getAddress throws on a malformed
    // address, which we surface as a clean form error rather than a wallet
    // revert.
    let normToken: string;
    let normTreasury: string;
    try {
      normToken = getAddress(token.trim());
    } catch {
      return { error: "Token must be a valid 0x address." };
    }
    const treasuryRaw = treasury.trim();
    if (treasuryRaw === "") {
      normTreasury = "";
    } else {
      try {
        normTreasury = getAddress(treasuryRaw);
      } catch {
        return { error: "Treasury must be a valid 0x address (or leave blank)." };
      }
    }

    const inputs: CreatePoolInputs = {
      token: normToken,
      treasury: normTreasury,
      durationDays: dur,
      stakeTaxBps: Math.round(sTaxPct * 100),
      unstakeTaxBps: Math.round(uTaxPct * 100),
      fundingAmount: toBaseUnits(fundingAmount || "0", dec),
      minStake: toBaseUnits(minStake || "0", dec),
      tier,
    };
    const err = validateCreateInputs(inputs);
    if (err) return { error: err };

    // Validate branded socials up front (Ecosystem/Marketing only) so the user
    // gets a clear message instead of a link being silently dropped by the
    // sanitizer. Each non-empty link must be a safe https URL on its expected
    // host. This mirrors the sanitizer in poolMeta/the Worker.
    if (canBrand) {
      const checks: [string, string, keyof NonNullable<PoolMeta["socials"]>][] = [
        [website, "Website", "website"],
        [twitter, "X / Twitter", "twitter"],
        [telegram, "Telegram", "telegram"],
        [discord, "Discord", "discord"],
      ];
      for (const [value, label, field] of checks) {
        const v = value.trim();
        if (v && !sanitizeSocialUrl(v, field)) {
          return {
            error:
              field === "website"
                ? `${label} must be a valid https:// URL.`
                : `${label} must be a valid https:// link on its official domain.`,
          };
        }
      }
    }

    return { inputs };
  }

  /** The connected tier's fee, formatted as an ETH string (e.g. "0.03"). */
  function tierFeeEth(t: PoolTier): string {
    // wei -> ether with up to 4 decimals, trimmed. Uses the live on-chain fee
    // when loaded (so a cheap test factory shows its real price), else the
    // fallback constant.
    const wei = fees[t];
    const whole = wei / BigInt("1000000000000000000");
    const frac = wei % BigInt("1000000000000000000");
    const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr}` : `${whole}`;
  }

  async function onImageChange(file: File | null) {
    setImageError("");
    if (!file) {
      setImage("");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setImage(dataUrl);
    } catch (e: unknown) {
      setImage("");
      setImageError(e instanceof Error ? e.message : "Could not read the image.");
    }
  }

  async function onBannerChange(file: File | null) {
    setBannerError("");
    if (!file) {
      setBanner("");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      setBanner(dataUrl);
    } catch (e: unknown) {
      setBanner("");
      setBannerError(e instanceof Error ? e.message : "Could not read the image.");
    }
  }

  async function onSubmit() {
    setStatus("submitting");
    setMessage("");
    setTxHash("");
    const { inputs, error } = buildInputs();
    if (error) {
      setStatus("error");
      setMessage(error);
      return;
    }
    try {
      const { txHash } = await createPool(inputs!);
      setTxHash(txHash);

      // Persist the display-only metadata off-chain (shared backend + local
      // cache), keyed by token address. Cosmetic — never blocks creation.
      // Banner/socials only apply to branded tiers; marketing perks (verified
      // badge + a 12h trending window) only to the Marketing tier.
      const socials = canBrand
        ? { website, twitter, telegram, discord }
        : undefined;
      const marketing = isMarketing
        ? {
            verifiedBadge: true,
            // 12 hours on the trending list, from now.
            trendingUntil: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
          }
        : undefined;
      await setPoolMeta(inputs!.token, {
        nickname,
        image,
        tier,
        banner: canBrand ? banner : undefined,
        socials,
        marketing,
      });

      // Wait for the tx to be mined so the factory's poolCount/allPools/poolOf
      // actually reflect the new pool before we refresh the directory.
      setStatus("confirming");
      setMessage("Waiting for confirmation…");
      const mined = await waitForPoolTx(txHash);

      if (!mined) {
        setStatus("error");
        setMessage("Transaction reverted. The pool was not created.");
        return;
      }

      // Announce the new pool so PoolDirectory refetches and it appears.
      emitPoolsChanged();
      setStatus("done");
      setMessage("Pool created. It now appears in the directory below.");
    } catch (e: unknown) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : "Transaction failed.");
    }
  }

  // Lock body scroll while the modal is open. The modal itself is portaled to
  // <body> (see the return) so it escapes the sidebar's stacking context
  // (relative z-10); without that portal the fixed backdrop is trapped inside
  // the sidebar and can't dim the dashboard behind it.
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const overlay = (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="glass !rounded-2xl w-full max-w-lg p-6 relative max-h-[90vh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
        style={{
          // Override the translucent .glass background so the modal reads as
          // mostly solid but still slightly see-through (~92% opaque).
          background:
            "linear-gradient(160deg, rgba(255,255,255,0.94) 0%, rgba(250,248,242,0.95) 100%)",
          backdropFilter: "blur(24px) saturate(140%)",
          WebkitBackdropFilter: "blur(24px) saturate(140%)",
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-hi">Create Staking Pool</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-lo hover:text-hi text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Top-of-form warning: invalid treasury address entered. */}
        {treasuryInvalid && (
          <div
            className="mb-4 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
            style={{ border: "1px solid rgba(220,38,38,0.4)", background: "rgba(220,38,38,0.08)" }}
            role="alert"
          >
            <span className="text-red-500 font-semibold">Invalid treasury address.</span>{" "}
            <span className="text-mid">
              The treasury you entered isn&rsquo;t a valid 0x address. Stake and unstake tax fields
              are disabled until you provide a valid address, or clear the treasury field to launch
              a tax-free pool.
            </span>
          </div>
        )}

        <p className="label-term mb-4 !normal-case !tracking-normal text-lo">
          Launch a staking pool for any token. You become the operator and
          admin. Pick a tier below — the launch fee and features depend on it.
          Funding is one-time (at creation) and taxes are immutable after launch.
        </p>

        {/* Token-trust note (audit H-1): stakers custody the pool's token. */}
        <p
          className="mb-4 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
          style={{ border: "1px solid rgba(255,157,46,0.3)", background: "rgba(255,157,46,0.06)" }}
        >
          <span className="text-amber-neon font-semibold">Note:</span>{" "}
          <span className="text-mid">
            stakers deposit into the token you choose. A malicious or buggy token
            contract can block claim/unstake — only launch pools for tokens you and
            your stakers can trust.
          </span>
        </p>

        {/* Tier picker */}
        <div className="mb-4">
          <span className="label-term block mb-2">Pricing tier</span>
          <div className="grid grid-cols-3 gap-2">
            <TierCard
              active={tier === PoolTier.Bronze}
              onClick={() => setTier(PoolTier.Bronze)}
              name="Bronze"
              fee={`${tierFeeEth(PoolTier.Bronze)} ETH`}
              perks="Up to 48h. No banner/socials."
            />
            <TierCard
              active={tier === PoolTier.Ecosystem}
              onClick={() => setTier(PoolTier.Ecosystem)}
              name="Ecosystem"
              fee={`${tierFeeEth(PoolTier.Ecosystem)} ETH`}
              perks="Up to 30d. Banner + social links + dashboard."
            />
            <TierCard
              active={tier === PoolTier.Marketing}
              onClick={() => setTier(PoolTier.Marketing)}
              name="Marketing"
              fee={`${tierFeeEth(PoolTier.Marketing)} ETH`}
              perks="12h trending + verified-safe badge."
            />
          </div>
          <p className="mt-2 text-[11px] text-lo">
            Selected: <span className="text-hi">{tierFeeEth(tier)} ETH</span> launch fee.
          </p>
        </div>

        <div className="space-y-3">
          <Field label="Token address (ERC-20)">
            <Input value={token} onChange={setToken} placeholder="0x…" />
          </Field>

          <Field label="Pool nickname (optional)">
            <Input value={nickname} onChange={setNickname} placeholder="e.g. Golden Anvil Pool" />
          </Field>

          <Field label="Pool image (optional)">
            <div className="flex items-center gap-3">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={image}
                  alt="Pool"
                  className="h-12 w-12 rounded-lg object-cover border border-black/10 shrink-0"
                />
              ) : (
                <div className="h-12 w-12 rounded-lg border border-dashed border-black/15 bg-black/[0.03] shrink-0 grid place-items-center text-lo text-[10px]">
                  none
                </div>
              )}
              <div className="flex flex-col gap-1">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => onImageChange(e.target.files?.[0] ?? null)}
                  className="text-xs text-mid file:mr-3 file:rounded-lg file:border-0
                             file:bg-black/[0.06] file:px-3 file:py-1.5 file:text-xs
                             file:text-hi file:cursor-pointer hover:file:bg-black/[0.08]"
                />
                {image && (
                  <button
                    type="button"
                    onClick={() => {
                      setImage("");
                      setImageError("");
                    }}
                    className="self-start text-[10px] text-lo hover:text-hi underline"
                  >
                    Remove image
                  </button>
                )}
              </div>
            </div>
            {imageError && (
              <span className="mt-1 block text-[10px] text-red-300">{imageError}</span>
            )}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Token decimals">
              <Input value={decimals} onChange={setDecimals} placeholder="18" inputMode="numeric" />
            </Field>
            <Field label={`Duration (days, 1–${maxDuration})`}>
              <Input value={durationDays} onChange={onDurationChange} placeholder={String(maxDuration)} inputMode="numeric" />
            </Field>
          </div>

          <Field label="Treasury (optional — blank = no tax)">
            <Input value={treasury} onChange={setTreasury} placeholder="0x…" />
            {treasuryInvalid && (
              <span className="mt-1 block text-[10px] text-red-500">
                That&rsquo;s not a valid 0x address. Enter a valid treasury to enable taxes, or clear
                the field for a no-tax pool.
              </span>
            )}
          </Field>

          {/* Advisory: the treasury must be able to receive the tax transfers. */}
          <div
            className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
            style={{ border: "1px solid rgba(217,132,19,0.35)", background: "rgba(217,132,19,0.06)" }}
          >
            <span className="text-amber-neon font-semibold">Important:</span>{" "}
            <span className="text-mid">
              stake and unstake taxes are sent to your treasury on every stake/unstake. Make sure
              the treasury is an address that can <span className="text-hi">receive and accept</span>{" "}
              those token transfers (a wallet or a contract with a payable/token-receiving fallback).
              If the treasury can&rsquo;t accept the token, taxed transfers may fail.
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={`Stake tax % (≤ ${MAX_TAX_BPS / 100}%)`}>
              <Input value={stakeTax} onChange={setStakeTax} placeholder="0" inputMode="decimal" disabled={taxesDisabled} />
            </Field>
            <Field label={`Unstake tax % (≤ ${MAX_TAX_BPS / 100}%)`}>
              <Input value={unstakeTax} onChange={setUnstakeTax} placeholder="0" inputMode="decimal" disabled={taxesDisabled} />
            </Field>
          </div>
          {taxesDisabled && (
            <p className="text-[10px] text-lo -mt-1">
              Enter a valid treasury address above to set stake / unstake taxes. Without a treasury
              this pool is tax-free.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Funding (reward tokens, one-time)">
              <Input value={fundingAmount} onChange={setFundingAmount} placeholder="100000" inputMode="decimal" />
            </Field>
            <Field label="Min stake (tokens)">
              <Input value={minStake} onChange={setMinStake} placeholder="35000" inputMode="decimal" />
            </Field>
          </div>

          {/* Branded-tier features: banner + social links (Ecosystem/Marketing) */}
          {canBrand ? (
            <div className="space-y-3 rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="flex items-center justify-between">
                <span className="label-term">Branding &amp; socials</span>
                {isMarketing && (
                  <span className="text-[10px] text-[#22c55e]">
                    Marketing: 12h trending + verified-safe badge
                  </span>
                )}
              </div>

              <Field label="Banner image (optional)">
                <div className="flex items-center gap-3">
                  {banner ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={banner}
                      alt="Banner"
                      className="h-12 w-24 rounded-lg object-cover border border-black/10 shrink-0"
                    />
                  ) : (
                    <div className="h-12 w-24 rounded-lg border border-dashed border-black/15 bg-black/[0.03] shrink-0 grid place-items-center text-lo text-[10px]">
                      none
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(e) => onBannerChange(e.target.files?.[0] ?? null)}
                    className="text-xs text-mid file:mr-3 file:rounded-lg file:border-0
                               file:bg-black/[0.06] file:px-3 file:py-1.5 file:text-xs
                               file:text-hi file:cursor-pointer hover:file:bg-black/[0.08]"
                  />
                </div>
                {bannerError && (
                  <span className="mt-1 block text-[10px] text-red-300">{bannerError}</span>
                )}
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Website">
                  <Input value={website} onChange={setWebsite} placeholder="https://…" inputMode="text" />
                </Field>
                <Field label="Twitter / X">
                  <Input value={twitter} onChange={setTwitter} placeholder="https://x.com/…" inputMode="text" />
                </Field>
                <Field label="Telegram">
                  <Input value={telegram} onChange={setTelegram} placeholder="https://t.me/…" inputMode="text" />
                </Field>
                <Field label="Discord">
                  <Input value={discord} onChange={setDiscord} placeholder="https://discord.gg/…" inputMode="text" />
                </Field>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-lo rounded-xl border border-dashed border-black/10 p-3">
              Custom banner and social links are available on the{" "}
              <span className="text-hi">Ecosystem</span> and{" "}
              <span className="text-hi">Marketing</span> tiers.
            </p>
          )}
        </div>

        {message && (
          <div
            className={`mt-4 text-xs rounded-lg px-3 py-2 break-words ${
              status === "error"
                ? "bg-red-500/10 text-red-300"
                : "bg-green-500/10 text-green-300"
            }`}
          >
            {message}
            {txHash && (
              <div className="mt-1 text-[10px] break-all">
                <a
                  href={`${robinhoodExplorerUrl}/tx/${txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold-neon hover:underline"
                >
                  View transaction ↗ ({txHash.slice(0, 10)}…{txHash.slice(-8)})
                </a>
              </div>
            )}
          </div>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-xl text-sm text-lo hover:text-hi border border-black/10"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={status === "submitting" || status === "confirming"}
            className="h-10 px-6 rounded-xl text-sm font-semibold text-white border-none
                       disabled:opacity-50 transition-transform active:scale-[0.98]"
            style={{ background: "linear-gradient(180deg, #22c55e, #16a34a)" }}
          >
            {status === "submitting"
              ? "Submitting…"
              : status === "confirming"
                ? "Confirming…"
                : "Create Pool"}
          </button>
        </div>
      </div>
    </div>
  );

  // Portal to <body> so the overlay isn't constrained by the sidebar's
  // stacking context. Guard against SSR where document is unavailable.
  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}

function TierCard({
  active,
  onClick,
  name,
  fee,
  perks,
}: {
  active: boolean;
  onClick: () => void;
  name: string;
  fee: string;
  perks: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-2.5 transition-colors ${
        active
          ? "border-[#22c55e] bg-[#22c55e]/10"
          : "border-black/10 bg-black/[0.02] hover:border-black/20"
      }`}
      aria-pressed={active}
    >
      <div className={`text-xs font-semibold ${active ? "text-[#22c55e]" : "text-hi"}`}>{name}</div>
      <div className="mono text-[11px] text-hi mt-0.5">{fee}</div>
      <div className="text-[9px] text-lo mt-1 leading-tight">{perks}</div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col h-full">
      <span className="label-term block mb-1">{label}</span>
      <span className="mt-auto block">{children}</span>
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  inputMode,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
  disabled?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      inputMode={inputMode}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full h-10 px-3 rounded-lg bg-black/[0.03] border border-black/10
                 text-sm text-hi placeholder:text-lo/50 outline-none
                 focus:border-black/20 disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ fontFamily: "var(--font-mono, monospace)" }}
    />
  );
}
