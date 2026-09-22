import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import {
  validateCreateInputs,
  MAX_TAX_BPS,
  waitForPoolTx,
  PoolTier,
  BRONZE_MAX_DURATION_DAYS,
  MAX_DURATION_DAYS,
  recordCreatedPool,
  tierFeeWei,
  resolvePoolAddress,
  quoteLaunch,
  formatNative,
  type CreatePoolInputs,
  type LaunchQuote,
} from "@/lib/factoryClient";
import { useEvmFactory } from "@/hooks/useEvmFactory";
import { useChain } from "@/components/ChainProvider";
import { setPoolMeta, fileToDataUrl } from "@/lib/poolMeta";
import { emitPoolsChanged } from "@/lib/poolEvents";
import { checkEvmAddress } from "@/lib/addressSyntax";
import { EVM_NETWORKS, EVM_VISIBLE_NETWORKS, explorerTxUrl } from "@/lib/evmNetworks";
import { sanitizeSocials } from "@/lib/sanitize";
import { ChainGlyph } from "@/components/ChainSwitch";
import { useI18n } from "@/components/LanguageProvider";
import { captureReferralFromSearch, referralForLauncher } from "@/lib/referral";
import { TOKEN_SYMBOL } from "@/lib/brand";

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
  label,
  showIcon = true,
}: {
  className?: string;
  style?: React.CSSProperties;
  label?: string;
  showIcon?: boolean;
} = {}) {
  const { t } = useI18n();
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
        {label ?? t("create.button")}
      </button>

      {open && <CreatePoolModal onClose={() => setOpen(false)} />}
    </>
  );
}

function CreatePoolModal({ onClose }: { onClose: () => void }) {
  const { createPool, address } = useEvmFactory();
  const { network, family, isWalletOnSelected, selectNetwork, switching, walletConnected } = useChain();
  const { t, chainLabel, chainShort } = useI18n();
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

  const [quote, setQuote] = useState<LaunchQuote | null>(null);
  const referrer = referralForLauncher(address);

  useEffect(() => {
    captureReferralFromSearch();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (family !== "evm") {
        if (!cancelled) setQuote(null);
        return;
      }
      const q = await quoteLaunch(
        network,
        address || "0x0000000000000000000000000000000000000001",
        tier,
        referrer,
      );
      if (!cancelled) setQuote(q);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [family, network, address, tier, referrer]);

  // Treasury gating for taxes. Taxes are paid to the treasury, so they can only
  // be set once a VALID treasury address is present. A blank treasury means
  // "no treasury / no tax"; a non-empty-but-malformed value is an error we
  // surface at the top of the form.
  const treasuryTrimmed = treasury.trim();
  const tokenCheck = checkEvmAddress(token, network);
  const treasuryCheck = treasuryTrimmed
    ? checkEvmAddress(treasuryTrimmed, network)
    : { ok: true as const };
  const treasuryValid = treasuryTrimmed !== "" && !!treasuryCheck.ok;
  const treasuryInvalid = treasuryTrimmed !== "" && !treasuryCheck.ok;
  const taxesDisabled = !treasuryValid;
  const tokenInvalid = token.trim() !== "" && !tokenCheck.ok;

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
  const [createdPool, setCreatedPool] = useState<{ chainId: number; address: string; label: string } | null>(null);

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
      return { error: t("create.decimalsRange") };
    }
    const sTaxPct = Number(stakeTax);
    const uTaxPct = Number(unstakeTax);
    if (Number.isNaN(sTaxPct) || Number.isNaN(uTaxPct)) {
      return { error: t("create.taxesNumbers") };
    }
    const dur = Number(durationDays);
    if (!Number.isInteger(dur) || dur < 1 || dur > maxDuration) {
      return {
        error:
          tier === PoolTier.Bronze
            ? t("create.bronzeCap", { n: BRONZE_MAX_DURATION_DAYS })
            : t("create.durationRange", { n: maxDuration }),
      };
    }
    const inputs: CreatePoolInputs = {
      token: token.trim(),
      treasury: treasury.trim(),
      durationDays: dur,
      stakeTaxBps: Math.round(sTaxPct * 100),
      unstakeTaxBps: Math.round(uTaxPct * 100),
      fundingAmount: toBaseUnits(fundingAmount || "0", dec),
      minStake: toBaseUnits(minStake || "0", dec),
      tier,
      referrer: referrer ?? undefined,
    };
    const err = validateCreateInputs(inputs);
    if (err) return { error: err };
    return { inputs };
  }

  function feeLabel(pt: PoolTier, wei?: bigint): string {
    return formatNative(wei ?? tierFeeWei(network, pt), network.nativeSymbol);
  }

  function quotedFeeLabel(pt: PoolTier): string {
    if (quote && pt === tier) return feeLabel(pt, quote.userPays);
    return feeLabel(pt);
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
      setImageError(e instanceof Error ? e.message : t("create.imageFail"));
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
      setBannerError(e instanceof Error ? e.message : t("create.imageFail"));
    }
  }

  async function onSubmit() {
    setStatus("submitting");
    setMessage("");
    setTxHash("");
    setCreatedPool(null);
    const { inputs, error } = buildInputs();
    if (error) {
      setStatus("error");
      setMessage(error);
      return;
    }
    if (family === "solana") {
      setStatus("error");
      setMessage(t("create.switchEvm"));
      return;
    }
    if (!tokenCheck.ok) {
      setStatus("error");
      setMessage(tokenCheck.error || t("create.validToken", { short: chainShort(network.key, network.short) }));
      return;
    }
    if (treasuryTrimmed && !treasuryCheck.ok) {
      setStatus("error");
      setMessage(treasuryCheck.error || t("create.validTreasury", { short: chainShort(network.key, network.short) }));
      return;
    }
    if (!isWalletOnSelected) {
      try {
        await selectNetwork(network.key);
      } catch {
        setStatus("error");
        setMessage(
          t("create.switchChain", {
            chain: chainLabel(network.key, network.label),
            symbol: network.nativeSymbol,
          }),
        );
        return;
      }
    }
    try {
      const { txHash } = network.factory
        ? await createPool(inputs!)
        : { txHash: "" };
      if (txHash) setTxHash(txHash);

      // Persist the display-only metadata off-chain (shared backend + local
      // cache), keyed by token address. Cosmetic — never blocks creation.
      // Banner/socials only apply to branded tiers; marketing perks (verified
      // badge + a 12h trending window) only to the Marketing tier.
      const socials = canBrand
        ? sanitizeSocials({ website, twitter, telegram, discord })
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
      }, {
        chainId: network.chain.id,
        factory: network.factory,
      });

      if (txHash) {
        // Wait for the tx to be mined so the factory's poolCount/allPools/poolOf
        // actually reflect the new pool before we refresh the directory.
        setStatus("confirming");
        setMessage(t("create.waiting"));
        const mined = await waitForPoolTx(txHash, network);

        if (!mined) {
          setStatus("error");
          setMessage(t("create.reverted"));
          return;
        }
      }

      let poolAddr: string | undefined;
      try {
        poolAddr = (await resolvePoolAddress(inputs!.token, network)) ?? undefined;
      } catch {
        poolAddr = undefined;
      }

      if (poolAddr) {
        const brandedMeta = {
          nickname,
          image,
          tier,
          banner: canBrand ? banner : undefined,
          socials,
          marketing,
        };
        const loc = {
          chainId: network.chain.id,
          factory: network.factory,
          pool: poolAddr,
        };
        await setPoolMeta(inputs!.token, brandedMeta, loc);
        await setPoolMeta(poolAddr, brandedMeta, loc);
      }

      // Append a directory card immediately (local overlay + on-chain merge).
      const recorded = recordCreatedPool(inputs!, Number(decimals) || 18, nickname.trim(), network, poolAddr);

      // Announce the new pool so PoolDirectory refetches and it appears.
      emitPoolsChanged();
      setCreatedPool({
        chainId: recorded.chainId,
        address: recorded.pool,
        label: network.label,
      });
      setStatus("done");
      setMessage(t("create.created", { chain: chainLabel(network.key, network.label) }));
    } catch (e: unknown) {
      setStatus("error");
      setMessage(e instanceof Error ? e.message : t("create.failed"));
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
          <h2 className="text-lg font-semibold text-hi">{t("create.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-lo hover:text-hi text-xl leading-none"
            aria-label={t("create.close")}
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
            <span className="text-red-500 font-semibold">{t("create.treasuryInvalid")}</span>{" "}
            <span className="text-mid">
              {t("create.treasuryInvalidBody")}
            </span>
          </div>
        )}

        <p className="label-term mb-3 !normal-case !tracking-normal text-lo">
          {t("create.intro", {
            chain: chainLabel(network.key, network.label),
            symbol: network.nativeSymbol,
          })}
        </p>

        <div className="mb-4">
          <span className="label-term block mb-2">{t("create.launchOn")}</span>
          <div className="flex flex-wrap gap-1.5">
            {EVM_VISIBLE_NETWORKS.map((key) => {
              const n = EVM_NETWORKS[key];
              const active = family === "evm" && network.key === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void selectNetwork(key).catch(() => {})}
                  className={`inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-semibold border
                              ${active ? "border-[#22c55e] bg-[#22c55e]/10 text-hi" : "border-black/10 text-mid hover:border-black/20"}`}
                >
                  <ChainGlyph name={key} />
                  {chainShort(key, n.short)}
                  {key === "robinhood" && (
                    <span className="text-[8px] uppercase tracking-wide text-lo">{t("create.primary")}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {!isWalletOnSelected && family === "evm" && walletConnected && (
          <div
            className="mb-4 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
            style={{ border: "1px solid rgba(255,157,46,0.4)", background: "rgba(255,157,46,0.08)" }}
            role="status"
          >
            <span className="text-amber-neon font-semibold">{t("create.wrongNetwork")}</span>{" "}
            <span className="text-mid">
              {t("create.wrongNetworkBody", {
                chain: chainLabel(network.key, network.label),
                symbol: network.nativeSymbol,
                short: chainShort(network.key, network.short),
              })}
            </span>
            <button
              type="button"
              disabled={switching}
              onClick={() => void selectNetwork(network.key)}
              className="mt-2 block text-[11px] font-semibold text-hi underline"
            >
              {switching ? t("pool.switching") : t("create.switchTo", { chain: chainLabel(network.key, network.label) })}
            </button>
          </div>
        )}

        {/* Token-trust note (audit H-1): stakers custody the pool's token. */}
        <p
          className="mb-4 rounded-lg px-3 py-2 text-[11px] leading-relaxed"
          style={{ border: "1px solid rgba(255,157,46,0.3)", background: "rgba(255,157,46,0.06)" }}
        >
          <span className="text-amber-neon font-semibold">{t("create.note")}</span>{" "}
          <span className="text-mid">
            {t("create.tokenTrust")}
          </span>
        </p>

        {/* Tier picker */}
        <div className="mb-4">
          <span className="label-term block mb-2">{t("create.pricingTier")}</span>
          <div className="grid grid-cols-3 gap-2">
            <TierCard
              active={tier === PoolTier.Bronze}
              onClick={() => setTier(PoolTier.Bronze)}
              name={t("create.bronze")}
              fee={quotedFeeLabel(PoolTier.Bronze)}
              perks={t("create.bronzePerks")}
            />
            <TierCard
              active={tier === PoolTier.Ecosystem}
              onClick={() => setTier(PoolTier.Ecosystem)}
              name={t("create.ecosystem")}
              fee={quotedFeeLabel(PoolTier.Ecosystem)}
              perks={t("create.ecoPerks")}
            />
            <TierCard
              active={tier === PoolTier.Marketing}
              onClick={() => setTier(PoolTier.Marketing)}
              name={t("create.marketing")}
              fee={quotedFeeLabel(PoolTier.Marketing)}
              perks={t("create.mktPerks")}
            />
          </div>
          <p className="mt-2 text-[11px] text-lo">
            {t("create.selectedFee", {
              fee: quotedFeeLabel(tier),
              symbol: network.nativeSymbol,
              chain: chainShort(network.key, network.short),
              mkt: feeLabel(PoolTier.Marketing),
            })}
          </p>
          {quote && quote.discountBps > 0 && (
            <p className="mt-1 text-[11px] text-emerald-700 font-semibold">
              {t("create.holderDiscount", {
                pct: (quote.discountBps / 100).toFixed(quote.discountBps % 100 === 0 ? 0 : 1),
                symbol: TOKEN_SYMBOL,
                fee: quotedFeeLabel(tier),
              })}
            </p>
          )}
          {quote && quote.commissionBps > 0 && (
            <p className="mt-1 text-[11px] text-mid">
              {t("create.referralApplied", {
                pct: (quote.commissionBps / 100).toFixed(quote.commissionBps % 100 === 0 ? 0 : 1),
              })}
            </p>
          )}
          <p className="mt-1 text-[11px] text-lo">{t("create.holdHint", { symbol: TOKEN_SYMBOL })}</p>
        </div>

        <div className="space-y-3">
          <Field label={t("create.tokenAddress", { chain: chainShort(network.key, network.short) })}>
            <Input value={token} onChange={setToken} placeholder="0x…" />
            <span className="mt-1 block text-[10px] text-lo">{network.addressHint}</span>
            {tokenInvalid && (
              <span className="mt-1 block text-[10px] text-red-500">{tokenCheck.error}</span>
            )}
            {tokenCheck.warning && !tokenInvalid && (
              <span className="mt-1 block text-[10px] text-amber-600">{tokenCheck.warning}</span>
            )}
          </Field>

          <Field label={t("create.nickname")}>
            <Input value={nickname} onChange={setNickname} placeholder={t("create.nicknamePh")} />
          </Field>

          <Field label={t("create.image")}>
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
                  {t("create.none")}
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
                    {t("create.removeImage")}
                  </button>
                )}
              </div>
            </div>
            {imageError && (
              <span className="mt-1 block text-[10px] text-red-300">{imageError}</span>
            )}
            <span className="mt-1 block text-[10px] text-lo">
              {t("create.imageHint")}
            </span>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("create.decimals")}>
              <Input value={decimals} onChange={setDecimals} placeholder="18" inputMode="numeric" />
            </Field>
            <Field label={t("create.duration", { max: maxDuration })}>
              <Input value={durationDays} onChange={onDurationChange} placeholder={String(maxDuration)} inputMode="numeric" />
            </Field>
          </div>

          <Field label={t("create.treasury")}>
            <Input value={treasury} onChange={setTreasury} placeholder="0x…" />
            {treasuryInvalid && (
              <span className="mt-1 block text-[10px] text-red-500">
                {treasuryCheck.error ||
                  t("create.treasuryNotValid", { short: chainShort(network.key, network.short) })}
              </span>
            )}
            {treasuryCheck.warning && treasuryValid && (
              <span className="mt-1 block text-[10px] text-amber-600">{treasuryCheck.warning}</span>
            )}
            {!treasuryTrimmed && (
              <span className="mt-1.5 block text-[11px] text-amber-700 leading-snug" role="status">
                {t("create.noTreasury")}
              </span>
            )}
            {treasuryValid && (
              <span className="mt-1.5 block text-[11px] text-mid leading-snug">
                {t("create.treasuryOk")}
              </span>
            )}
          </Field>

          {/* Advisory: the treasury must be able to receive the tax transfers. */}
          <div
            className="rounded-lg px-3 py-2 text-[11px] leading-relaxed"
            style={{ border: "1px solid rgba(217,132,19,0.35)", background: "rgba(217,132,19,0.06)" }}
          >
            <span className="text-amber-neon font-semibold">{t("create.important")}</span>{" "}
            <span className="text-mid">
              {t("create.taxFlow")}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("create.stakeTax", { max: MAX_TAX_BPS / 100 })}>
              <Input value={stakeTax} onChange={setStakeTax} placeholder="0" inputMode="decimal" disabled={taxesDisabled} />
            </Field>
            <Field label={t("create.unstakeTax", { max: MAX_TAX_BPS / 100 })}>
              <Input value={unstakeTax} onChange={setUnstakeTax} placeholder="0" inputMode="decimal" disabled={taxesDisabled} />
            </Field>
          </div>
          {taxesDisabled && (
            <p className="text-[10px] text-lo -mt-1">
              {t("create.taxesNeedTreasury")}
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 items-end">
            <Field label={t("create.funding")}>
              <Input value={fundingAmount} onChange={setFundingAmount} placeholder="100000" inputMode="decimal" />
            </Field>
            <Field label={t("create.minStake")}>
              <Input value={minStake} onChange={setMinStake} placeholder="1000" inputMode="decimal" />
            </Field>
          </div>

          {/* Branded-tier features: banner + social links (Ecosystem/Marketing) */}
          {canBrand ? (
            <div className="space-y-3 rounded-xl border border-black/10 bg-black/[0.02] p-3">
              <div className="flex items-center justify-between">
                <span className="label-term">{t("create.branding")}</span>
                {isMarketing && (
                  <span className="text-[10px] text-[#22c55e]">
                    {t("create.marketingBadge")}
                  </span>
                )}
              </div>

              <Field label={t("create.banner")}>
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
                      {t("create.none")}
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
                <span className="mt-1 block text-[10px] text-lo">
                  {t("create.bannerHint")}
                </span>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label={t("create.website")}>
                  <Input value={website} onChange={setWebsite} placeholder="https://…" inputMode="text" />
                </Field>
                <Field label={t("create.twitter")}>
                  <Input value={twitter} onChange={setTwitter} placeholder="https://x.com/…" inputMode="text" />
                </Field>
                <Field label={t("create.telegram")}>
                  <Input value={telegram} onChange={setTelegram} placeholder="https://t.me/…" inputMode="text" />
                </Field>
                <Field label={t("create.discord")}>
                  <Input value={discord} onChange={setDiscord} placeholder="https://discord.gg/…" inputMode="text" />
                </Field>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-lo rounded-xl border border-dashed border-black/10 p-3">
              {t("create.brandingLocked")}
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
              <div className="mt-1 text-[10px] text-lo break-all">
                tx:{" "}
                <a
                  href={explorerTxUrl(network, txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold-neon underline"
                >
                  {txHash}
                </a>
              </div>
            )}
            {createdPool && (
              <div className="mt-2">
                <Link
                  to="/pool/$chainId/$address"
                  params={{ chainId: String(createdPool.chainId), address: createdPool.address }}
                  onClick={onClose}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-neon underline"
                  data-testid="created-pool-link"
                >
                  {t("create.openNamed", { chain: chainLabel(network.key, createdPool.label) })}
                </Link>
                <div className="mt-1 text-[10px] text-lo break-all">{createdPool.address}</div>
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
            {t("create.cancel")}
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
              ? t("create.submitting")
              : status === "confirming"
                ? t("create.confirming")
                : t("create.submit")}
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
    <label className="block">
      <span className="label-term block mb-1">{label}</span>
      {children}
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
