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
  const config = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { selectNetwork, switching } = useChain();
  const [busy, setBusy] = useState(false);
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
        setMessage(`Demo add-on. Live pools pay ${feeLabel} to unlock a 12h trending slot.`);
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
            ? "Trending window extended. Banner and socials stay live."
            : "Marketing unlocked. Add a banner and socials below."
          : unlocked
            ? "Boost received. Trending extended 12 hours. This was not a stake."
            : "Boost received. This pool is trending for 12 hours. Banner, socials, and verified stay with the operator. This was not a stake.",
      );
      onUpdated();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : "Payment failed.");
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
  ]);

  const cta = unlocked ? `Extend · ${feeLabel}` : `Add-on · ${feeLabel}`;
  const canPay = demo || deskConfigured(network);

  const button = (
    <button
      type="button"
      disabled={busy || switching || !canPay}
      onClick={() => void pay()}
      className="h-10 px-4 rounded-xl text-xs font-semibold text-white border-none disabled:opacity-40
                 whitespace-nowrap shadow-[0_8px_24px_rgba(124,58,237,0.35)]"
      style={{ background: PURPLE }}
      data-testid="marketing-addon-btn"
    >
      {busy ? "Confirm in wallet…" : cta}
    </button>
  );

  if (compact) {
    return (
      <div className="shrink-0 flex flex-col items-stretch sm:items-end gap-1.5 min-w-[9.5rem]">
        {trending && (
          <span className="self-end rounded-full px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-500/30">
            Trending live
          </span>
        )}
        {canPay ? (
          button
        ) : (
          <p className="text-[10px] text-amber-700 text-right max-w-[12rem]">
            Desk not live on {network.short} yet.
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
      </div>
    );
  }

  return (
    <section className="glass glass-gold p-5 space-y-3" data-testid="buy-marketing">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="label-term mb-1">Community boost</p>
          <h2 className="text-sm font-semibold text-hi tracking-tight">
            {unlocked ? "Marketing privileges" : "Boost this pool anytime"}
          </h2>
          <p className="text-sm text-mid mt-1.5 leading-relaxed max-w-xl">
            Anyone can pay {feeLabel} on {network.label} to unlock Marketing on this pool and put
            it in a 12-hour trending slot. Pay again to extend. This is a boost, not a stake —
            it does not deposit tokens. Banner, socials, and the verified badge stay with the
            operator. Launch tier on the pool contract does not change.
          </p>
        </div>
        {trending && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-500/30">
            Trending live
          </span>
        )}
      </div>

      {!canPay ? (
        <p className="text-xs text-amber-700">
          The Marketing desk for {network.label} is not deployed yet. Launch fees still work; the
          anytime boost will light up as soon as the desk address is set.
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
