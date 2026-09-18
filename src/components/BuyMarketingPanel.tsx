import { useCallback, useState } from "react";
import { useAccount, useConnect, useConfig } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import { useChain } from "@/components/ChainProvider";
import {
  buyMarketing,
  deskConfigured,
  fetchMarketingStatus,
  formatMarketingFee,
  type MarketingStatus,
} from "@/lib/marketingDesk";
import { getPoolMeta, setPoolMeta, fileToDataUrl, type PoolMeta } from "@/lib/poolMeta";
import { sanitizeSocials } from "@/lib/sanitize";
import { emitPoolsChanged } from "@/lib/poolEvents";
import { explorerTxUrl, type EvmNetwork } from "@/lib/evmNetworks";
import type { PoolSummary } from "@/lib/factoryClient";
import { useI18n } from "@/components/LanguageProvider";

const PURPLE =
  "linear-gradient(180deg, #c084fc 0%, #a855f7 42%, #7c3aed 100%)";

export function BuyMarketingPanel({
  pool,
  network,
  meta,
  status,
  onUpdated,
  compact = false,
}: {
  pool: PoolSummary;
  network: EvmNetwork;
  meta: PoolMeta | null;
  status: MarketingStatus;
  onUpdated: () => void;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { selectNetwork, switching } = useChain();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  const feeLabel = formatMarketingFee(network);
  const addr = address?.toLowerCase();
  const isOperator =
    !!addr &&
    ((pool.operator && addr === pool.operator.toLowerCase()) ||
      (!!pool.authority && addr === pool.authority.toLowerCase()));
  const launchedMarketing = pool.tierOnChain === 2;
  const unlocked = status.unlocked || launchedMarketing;
  const trending = status.trending || (meta?.marketing?.trendingUntil ?? 0) > Date.now() / 1000;
  const walletOnChain = chainId === network.chain.id;
  const demo = !!pool.demo;

  const pay = useCallback(async () => {
    setMessage("");
    setTxHash("");
    setBusy(true);
    try {
      if (demo) {
        setMessage(t("marketing.demoMsg", { fee: feeLabel }));
        return;
      }
      if (!isConnected) {
        const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
        if (!injected) throw new Error("Connect an EVM wallet first.");
        await connectAsync({ connector: injected });
      }
      if (!walletOnChain) {
        try {
          await switchChain(config, { chainId: network.chain.id });
        } catch {
          await selectNetwork(network.key);
        }
      }
      const walletClient = await getWalletClient(config, { chainId: network.chain.id });
      if (!walletClient) throw new Error("Could not reach the wallet.");
      const { txHash: hash } = await buyMarketing(walletClient, pool.pool, network);
      setTxHash(hash);
      const onchain = await fetchMarketingStatus(pool.pool, network);
      const until = Math.max(
        onchain.trendingUntil,
        Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        status.trendingUntil,
      );
      const latest =
        (await getPoolMeta(pool.token).catch(() => null)) ??
        (await getPoolMeta(pool.pool).catch(() => null)) ??
        meta;
      const next: PoolMeta = {
        ...latest,
        tier: 2,
        marketing: {
          verifiedBadge: isOperator ? true : !!latest?.marketing?.verifiedBadge,
          trendingUntil: until,
        },
      };
      await setPoolMeta(pool.token, next);
      await setPoolMeta(pool.pool, next);
      emitPoolsChanged();
      setMessage(
        isOperator
          ? unlocked
            ? t("marketing.opExtend")
            : t("marketing.opUnlock")
          : unlocked
            ? t("marketing.boostExtend")
            : t("marketing.boostNew"),
      );
      onUpdated();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : t("marketing.failed"));
    } finally {
      setBusy(false);
    }
  }, [
    demo,
    feeLabel,
    isConnected,
    connectors,
    connectAsync,
    walletOnChain,
    config,
    network,
    selectNetwork,
    pool,
    meta,
    status.trendingUntil,
    unlocked,
    isOperator,
    onUpdated,
    t,
  ]);

  const cta = unlocked ? t("marketing.extend", { fee: feeLabel }) : t("marketing.addon", { fee: feeLabel });
  const canPay = demo || deskConfigured(network);

  const button = (
    <button
      type="button"
      disabled={busy || switching || !canPay}
      onClick={() => setConfirmOpen(true)}
      className="h-10 px-4 rounded-xl text-xs font-semibold text-white border-none disabled:opacity-40
                 whitespace-nowrap shadow-[0_8px_24px_rgba(124,58,237,0.35)]"
      style={{ background: PURPLE }}
      data-testid="marketing-addon-btn"
    >
      {busy ? t("marketing.confirmWallet") : cta}
    </button>
  );

  const confirmModal = confirmOpen ? (
    <div
      className="fixed inset-0 z-[80] grid place-items-center px-4"
      role="presentation"
      onClick={() => !busy && setConfirmOpen(false)}
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[6px]" />
      <div
        role="dialog"
        aria-labelledby="marketing-addon-title"
        className="relative w-full max-w-md rounded-2xl p-5"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,248,242,0.96))",
          border: "1px solid rgba(168, 85, 247, 0.35)",
          boxShadow: "0 22px 50px -18px rgba(60, 20, 80, 0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[10px] font-semibold tracking-[0.14em] uppercase text-mid">{t("marketing.community")}</p>
        <h3 id="marketing-addon-title" className="mt-1 text-base font-semibold text-hi">
          {unlocked ? t("marketing.extendTitle") : t("marketing.title")}
        </h3>
        <p className="mt-2 text-sm text-mid leading-relaxed">
          {t("marketing.aboutTo", { fee: feeLabel, chain: network.label })}
        </p>
        <ul className="mt-3 space-y-1.5 text-sm text-hi">
          <li>{t("marketing.slot")}</li>
          <li>{unlocked ? t("marketing.extendWindow") : t("marketing.unlock")}</li>
          <li>{t("marketing.branding")}</li>
        </ul>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirmOpen(false)}
            className="h-10 px-4 rounded-xl text-xs font-semibold text-hi border border-black/15 hover:bg-black/[0.04]"
          >
            {t("marketing.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || switching || !canPay}
            onClick={() => {
              setConfirmOpen(false);
              void pay();
            }}
            className="h-10 px-4 rounded-xl text-xs font-semibold text-white border-none"
            style={{ background: PURPLE }}
          >
            {busy ? t("marketing.confirmWallet") : t("marketing.confirm", { fee: feeLabel })}
          </button>
        </div>
      </div>
    </div>
  ) : null;

  if (compact) {
    return (
      <div className="shrink-0 flex flex-col items-stretch sm:items-end gap-1.5 min-w-[9.5rem]">
        {trending && (
          <span className="self-end rounded-full px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-500/30">
            {t("marketing.trendingLive")}
          </span>
        )}
        {canPay ? (
          button
        ) : (
          <p className="text-[10px] text-amber-700 text-right max-w-[12rem]">
            {t("marketing.deskMissing", { chain: network.short })}
          </p>
        )}
        {message && (
          <p className="text-[10px] text-mid leading-snug text-right max-w-[13rem]">
            {message}
            {txHash && (
              <>
                {" "}
                <a
                  href={explorerTxUrl(network, txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gold-neon underline"
                >
                  tx
                </a>
              </>
            )}
          </p>
        )}
        {confirmModal}
      </div>
    );
  }

  return (
    <section className="glass glass-gold p-5 space-y-3" data-testid="buy-marketing">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="label-term mb-1">{t("marketing.community")}</p>
          <h2 className="text-sm font-semibold text-hi tracking-tight">
            {unlocked ? t("marketing.privileges") : t("marketing.boostAnytime")}
          </h2>
          <p className="text-sm text-mid mt-1.5 leading-relaxed max-w-xl">
            {t("marketing.bodyLong", { fee: feeLabel, chain: network.label })}
          </p>
        </div>
        {trending && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-500/30">
            {t("marketing.trendingLive")}
          </span>
        )}
      </div>

      {!canPay ? (
        <p className="text-xs text-amber-700">
          {t("marketing.deskNotDeployed", { chain: network.label })}
        </p>
      ) : (
        button
      )}

      {message && (
        <p className="text-xs text-mid leading-relaxed">
          {message}
          {txHash && (
            <>
              {" "}
              <a
                href={explorerTxUrl(network, txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-gold-neon underline"
              >
                View transaction
              </a>
            </>
          )}
        </p>
      )}

      {unlocked && isOperator && (
        <BrandingForm pool={pool} meta={meta} marketingUnlocked onSaved={onUpdated} />
      )}
      {!unlocked && isOperator && pool.tierOnChain === 1 && (
        <BrandingForm pool={pool} meta={meta} marketingUnlocked={false} onSaved={onUpdated} />
      )}
      {unlocked && !isOperator && (
        <p className="text-[11px] text-lo">
          Only the operator can edit banner, socials, and the verified badge.
        </p>
      )}
      {confirmModal}
    </section>
  );
}

function BrandingForm({
  pool,
  meta,
  marketingUnlocked,
  onSaved,
}: {
  pool: PoolSummary;
  meta: PoolMeta | null;
  marketingUnlocked: boolean;
  onSaved: () => void;
}) {
  const [nickname, setNickname] = useState(meta?.nickname ?? "");
  const [image, setImage] = useState(meta?.image ?? "");
  const [banner, setBanner] = useState(meta?.banner ?? "");
  const [website, setWebsite] = useState(meta?.socials?.website ?? "");
  const [twitter, setTwitter] = useState(meta?.socials?.twitter ?? "");
  const [telegram, setTelegram] = useState(meta?.socials?.telegram ?? "");
  const [discord, setDiscord] = useState(meta?.socials?.discord ?? "");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);

  async function onFile(
    file: File | null,
    setter: (v: string) => void,
  ) {
    setErr("");
    if (!file) return;
    try {
      setter(await fileToDataUrl(file));
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not read the image.");
    }
  }

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const next: PoolMeta = {
        ...meta,
        nickname: nickname.trim() || undefined,
        image: image || undefined,
        banner: banner || undefined,
        tier: marketingUnlocked ? 2 : (meta?.tier ?? pool.tierOnChain ?? 1),
        socials: sanitizeSocials({ website, twitter, telegram, discord }),
        marketing: marketingUnlocked
          ? {
              verifiedBadge: true,
              trendingUntil: meta?.marketing?.trendingUntil,
            }
          : meta?.marketing,
      };
      await setPoolMeta(pool.token, next);
      await setPoolMeta(pool.pool, next);
      emitPoolsChanged();
      onSaved();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Could not save branding.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-black/10 bg-black/[0.02] p-3 space-y-3">
      <span className="label-term">Banner & socials</span>
      <p className="text-[11px] text-lo">
        Saving branding as the operator attests this pool and shows the verified badge.
      </p>
      <label className="block">
        <span className="label-term block mb-1">Nickname</span>
        <input
          className="w-full h-10 px-3 rounded-lg bg-black/[0.03] border border-black/10 text-sm"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="label-term block mb-1">Image</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void onFile(e.target.files?.[0] ?? null, setImage)} />
        </label>
        <label className="block">
          <span className="label-term block mb-1">Banner</span>
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => void onFile(e.target.files?.[0] ?? null, setBanner)} />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input className="h-10 px-3 rounded-lg bg-black/[0.03] border border-black/10 text-sm" placeholder="Website https://…" value={website} onChange={(e) => setWebsite(e.target.value)} />
        <input className="h-10 px-3 rounded-lg bg-black/[0.03] border border-black/10 text-sm" placeholder="X https://…" value={twitter} onChange={(e) => setTwitter(e.target.value)} />
        <input className="h-10 px-3 rounded-lg bg-black/[0.03] border border-black/10 text-sm" placeholder="Telegram https://…" value={telegram} onChange={(e) => setTelegram(e.target.value)} />
        <input className="h-10 px-3 rounded-lg bg-black/[0.03] border border-black/10 text-sm" placeholder="Discord https://…" value={discord} onChange={(e) => setDiscord(e.target.value)} />
      </div>
      {err && <p className="text-[11px] text-red-500">{err}</p>}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="h-9 px-4 rounded-lg text-xs font-semibold text-hi border border-black/10"
      >
        {saving ? "Saving…" : "Save branding"}
      </button>
    </div>
  );
}
