import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { formatUnits } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { TerminalShell } from "@/components/TerminalShell";
import { ChainBadge } from "@/components/PoolDirectory";
import { ChainSwitch } from "@/components/ChainSwitch";
import { useChain } from "@/components/ChainProvider";
import { useI18n } from "@/components/LanguageProvider";
import { displayTier, fetchPoolSummary, poolStatus, sweepPoolTreasury, type PoolSummary } from "@/lib/factoryClient";
import { getPoolMeta, type PoolMeta } from "@/lib/poolMeta";
import { readLocalPools } from "@/lib/localPools";
import { getMockPool, isMockPoolAddress } from "@/lib/mockPools";
import { networkByChainId, explorerAddressUrl, type EvmNetwork } from "@/lib/evmNetworks";
import { shortAddress } from "@/lib/brand";
import { sanitizeHttpUrl, sanitizeImageSrc } from "@/lib/sanitize";
import { ClaimableTicker } from "@/components/ClaimableTicker";
import { BuyMarketingPanel } from "@/components/BuyMarketingPanel";
import { fetchMarketingStatus, type MarketingStatus } from "@/lib/marketingDesk";
import { PoolVaultStats } from "@/components/PoolVaultStats";
import { PoolActionStrip } from "@/components/PoolActionStrip";
import { ApyCalculator } from "@/components/ApyCalculator";
import { RewardChart } from "@/components/RewardChart";
import { HeroMetrics } from "@/components/HeroMetrics";
import { poolToStats } from "@/lib/poolStats";
import { SampleDashboardsBanner } from "@/components/SampleDashboards";

const EMPTY_DESK: MarketingStatus = { unlocked: false, trending: false, trendingUntil: 0 };

export default function PoolDashboardPage() {
  const { t } = useI18n();
  const { chainId, address } = useParams({ from: "/pool/$chainId/$address" });
  const { selectNetwork, switching, walletConnected, walletChainId } = useChain();
  const network = networkByChainId(Number(chainId));
  const [pool, setPool] = useState<PoolSummary | null>(null);
  const [meta, setMeta] = useState<PoolMeta | null>(null);
  const [desk, setDesk] = useState<MarketingStatus>(EMPTY_DESK);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (silent = false) => {
      if (!network || !address) {
        setError(t("pool.unknownChain"));
        setLoading(false);
        return;
      }
      if (!silent) setLoading(true);
      try {
        let summary: PoolSummary | null = null;
        if (isMockPoolAddress(address)) {
          summary = getMockPool(address, network.chain.id) ?? getMockPool(address);
        } else {
          try {
            summary = await fetchPoolSummary(address, network);
          } catch {
            summary =
              readLocalPools().find(
                (p) =>
                  p.chainId === network.chain.id &&
                  p.pool.toLowerCase() === address.toLowerCase(),
              ) ?? null;
          }
        }
        if (!summary) {
          setError(t("pool.notFoundChain"));
          setLoading(false);
          return;
        }
        const [tokenMeta, poolMeta, deskStatus] = await Promise.all([
          getPoolMeta(summary.token).catch(() => null),
          getPoolMeta(address).catch(() => null),
          summary.demo
            ? Promise.resolve(EMPTY_DESK)
            : fetchMarketingStatus(address, network).catch(() => EMPTY_DESK),
        ]);
        setPool(summary);
        setMeta(tokenMeta ?? poolMeta);
        setDesk(deskStatus);
        setError("");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t("pool.loadFail"));
      } finally {
        setLoading(false);
      }
    },
    [address, network],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  const tier = pool ? displayTier(pool, meta) : (meta?.tier ?? 0);
  const branded = tier === 1 || tier === 2;
  const marketing = tier === 2 || desk.unlocked || !!pool?.marketingUnlocked;
  const title =
    meta?.nickname?.trim() ||
    (pool?.symbol ? t("pool.named", { symbol: pool.symbol }) : t("pool.stakingPool"));
  const banner = sanitizeImageSrc(meta?.banner);
  const image = sanitizeImageSrc(meta?.image);
  const staked = pool
    ? Number(formatUnits(pool.stakeVaultBalance, pool.decimals || 18))
    : 0;
  const status = pool ? poolStatus(pool) : "pending";
  const walletOnPoolChain = !!network && walletChainId === network.chain.id;
  const deskStatus: MarketingStatus = {
    unlocked: desk.unlocked || !!pool?.marketingUnlocked,
    trending: desk.trending || (meta?.marketing?.trendingUntil ?? 0) > Date.now() / 1000,
    trendingUntil: Math.max(desk.trendingUntil, meta?.marketing?.trendingUntil ?? 0),
  };
  const stats = useMemo(
    () => (pool ? poolToStats(pool) : null),
    [pool],
  );
  const tierLabel =
    tier === 2 ? t("status.marketing") : tier === 1 ? t("status.ecosystem") : t("status.bronze");

  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[1200px] mx-auto space-y-6">
            <div className="lg:hidden">
              <ChainSwitch compact />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Link
                to={pool?.demo ? "/preview" : "/pools"}
                className="text-xs font-semibold text-lo hover:text-hi"
              >
                {pool?.demo ? t("pool.sampleDash") : t("pool.allPools")}
              </Link>
              {network && <ChainBadge chainKey={network.key} />}
            </div>

            {loading ? (
              <div className="glass !rounded-2xl p-8 animate-pulse h-64" />
            ) : error || !pool || !network ? (
              <div className="glass !rounded-2xl p-8 text-sm text-red-300">{error || t("pool.notFound")}</div>
            ) : (
              <>
                {pool.demo && <SampleDashboardsBanner />}
                {branded && banner && (
                  <img
                    src={banner}
                    alt=""
                    className="w-full h-40 object-cover rounded-2xl border border-black/10"
                    data-testid="pool-banner"
                  />
                )}

                <header className="glass !rounded-2xl p-6">
                  <div className="flex items-start gap-4 flex-wrap sm:flex-nowrap">
                    {image ? (
                      <img
                        src={image}
                        alt=""
                        className="h-16 w-16 rounded-2xl object-cover border border-black/10 shrink-0"
                        data-testid="pool-image"
                      />
                    ) : (
                      <div
                        className="h-16 w-16 rounded-2xl grid place-items-center text-lg font-bold shrink-0"
                        style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))", color: "#0a0c0f" }}
                      >
                        {(pool.symbol || "?").slice(0, 2)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h1 className="text-2xl font-semibold text-hi truncate">{title}</h1>
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold bg-black/[0.06] text-lo">
                          {tierLabel}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            status === "live"
                              ? "bg-green-500/15 text-green-300"
                              : status === "paused"
                                ? "bg-amber-500/15 text-amber-300"
                                : "bg-black/[0.08] text-lo"
                          }`}
                        >
                          {t(`status.${status}`)}
                        </span>
                        {pool.demo && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold border border-black/10 text-lo">
                            {t("status.demo")}
                          </span>
                        )}
                        {marketing && (meta?.marketing?.verifiedBadge || pool.tierOnChain === 2) && (
                          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-[#22c55e] border border-[#22c55e]/30">
                            {t("status.verified")}
                          </span>
                        )}
                      </div>
                      <p className="label-term mt-1 !normal-case">
                        {pool.symbol ? `$${pool.symbol}` : pool.token} · {network.label} · {t("common.daysShort", { n: pool.durationDays })}
                      </p>
                      {!pool.demo && (
                        <a
                          href={explorerAddressUrl(network, pool.pool)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-gold-neon hover:underline"
                        >
                          {t("pool.viewExplorer", { chain: network.short })}
                        </a>
                      )}
                      {pool.treasury &&
                        pool.treasury !== "0x0000000000000000000000000000000000000000" && (
                          <p className="mt-1.5 text-xs text-mid">
                            {t("pool.taxTreasury")}{" "}
                            <a
                              href={explorerAddressUrl(network, pool.treasury)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-hi hover:text-gold-700 hover:underline"
                              title={pool.treasury}
                            >
                              {shortAddress(pool.treasury)}
                            </a>
                          </p>
                        )}
                      {branded && (
                        <PoolHeaderSocials socials={meta?.socials} />
                      )}
                    </div>
                    <BuyMarketingPanel
                      compact
                      pool={pool}
                      network={network}
                      meta={meta}
                      status={deskStatus}
                      onUpdated={() => void load(true)}
                    />
                  </div>

                  {walletConnected && !walletOnPoolChain && !pool.demo && (
                    <button
                      type="button"
                      disabled={switching}
                      onClick={() => void selectNetwork(network.key)}
                      className="mt-4 h-10 px-4 rounded-xl text-xs font-semibold text-[#0a0c0f]"
                      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
                    >
                      {switching ? t("pool.switching") : t("pool.switchWallet", { chain: network.label })}
                    </button>
                  )}
                </header>

                <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Stat k={t("pool.totalStaked")} v={formatCompact(staked)} />
                  <Stat k={t("pool.duration")} v={t("common.daysShort", { n: pool.durationDays })} />
                  <Stat k={t("pool.stakeTax")} v={`${(pool.stakeTaxBps / 100).toFixed(2)}%`} />
                  <Stat k={t("pool.unstakeTax")} v={`${(pool.unstakeTaxBps / 100).toFixed(2)}%`} />
                </section>

                <TreasuryRelease pool={pool} network={network} onUpdated={() => void load(true)} />

                {branded ? (
                  <>
                    <PoolVaultStats pool={pool} />
                    <PoolActionStrip pool={pool} network={network} onUpdated={() => void load(true)} />
                    {stats && <HeroMetrics stats={stats} compact />}
                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
                      <div className="xl:col-span-1">
                        <ApyCalculator stats={stats ?? undefined} />
                      </div>
                      <div className="xl:col-span-2">{stats && <RewardChart stats={stats} />}</div>
                    </div>
                  </>
                ) : (
                  <>
                    <PoolVaultStats pool={pool} />
                    <PoolActionStrip pool={pool} network={network} onUpdated={() => void load(true)} />
                  </>
                )}

                {!pool.demo && (
                  <ClaimableTicker
                    pool={pool.pool}
                    chainId={pool.chainId}
                    symbol={pool.symbol}
                  />
                )}

                {tier === 0 && !marketing && (
                  <section className="glass !rounded-2xl p-5">
                    <h2 className="text-sm font-semibold text-hi">{t("pool.bronzeTitle")}</h2>
                    <p className="text-sm text-mid mt-1">
                      {t("pool.bronzeBody")}
                    </p>
                  </section>
                )}

                {!pool.demo && (
                  <a
                    href={explorerAddressUrl(network, pool.pool)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex text-xs font-semibold text-gold-neon"
                  >
                    {t("pool.viewOn", { chain: network.short })}
                  </a>
                )}
              </>
            )}
          </div>
        </main>
    </TerminalShell>
  );
}

function PoolHeaderSocials({ socials }: { socials?: PoolMeta["socials"] }) {
  const { t } = useI18n();
  const items = [
    { href: sanitizeHttpUrl(socials?.website), kind: "website", label: t("common.website") },
    { href: sanitizeHttpUrl(socials?.twitter), kind: "twitter", label: "X" },
    { href: sanitizeHttpUrl(socials?.telegram), kind: "telegram", label: t("common.telegram") },
    { href: sanitizeHttpUrl(socials?.discord), kind: "discord", label: t("common.discord") },
  ].filter((i): i is { href: string; kind: string; label: string } => !!i.href);

  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 mt-3" data-testid="pool-header-socials" aria-label="Pool socials">
      {items.map((item) => (
        <a
          key={item.kind}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          title={item.label}
          aria-label={item.label}
          data-testid={`pool-social-${item.kind}`}
          className="h-8 w-8 rounded-lg grid place-items-center text-hi border border-black/10
                     bg-black/[0.03] hover:bg-black/[0.07] hover:border-black/20 transition-colors"
        >
          <SocialGlyph kind={item.kind} />
        </a>
      ))}
    </div>
  );
}

function SocialGlyph({ kind }: { kind: string }) {
  const common = {
    viewBox: "0 0 24 24",
    width: 14,
    height: 14,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (kind === "twitter") {
    return (
      <svg {...common}>
        <path d="M4 4l11.5 16h4.5L8.5 4H4z" />
        <path d="M4 20l7.5-8.5" />
        <path d="M12.5 12.5L20 4" />
      </svg>
    );
  }
  if (kind === "telegram") {
    return (
      <svg {...common}>
        <path d="M22 3L2 10.5l6.5 2L20 6 11 14.5 20.5 21 22 3z" />
      </svg>
    );
  }
  if (kind === "discord") {
    return (
      <svg {...common}>
        <path d="M7 7.5C8.2 6.6 9.6 6 11 6h2c1.4 0 2.8.6 4 1.5" />
        <path d="M17 16.5c-1.2.9-2.6 1.5-4 1.5h-2c-1.4 0-2.8-.6-4-1.5" />
        <circle cx="9" cy="12" r="1" fill="currentColor" />
        <circle cx="15" cy="12" r="1" fill="currentColor" />
        <path d="M8 18l-1.5 3" />
        <path d="M16 18l1.5 3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 010 18" />
      <path d="M12 3a14 14 0 000 18" />
    </svg>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="glass !rounded-2xl p-4">
      <div className="mono text-lg font-bold text-gold-neon">{v}</div>
      <div className="label-term !normal-case mt-1">{k}</div>
    </div>
  );
}

function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function TreasuryRelease({
  pool,
  network,
  onUpdated,
}: {
  pool: PoolSummary;
  network: EvmNetwork;
  onUpdated: () => void;
}) {
  const { t } = useI18n();
  const config = useConfig();
  const { isConnected, chainId } = useAccount();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState("");
  const owed = pool.owedToTreasury ?? 0n;
  const treasury = pool.treasury;
  if (
    pool.demo ||
    owed === 0n ||
    !treasury ||
    treasury === "0x0000000000000000000000000000000000000000"
  ) {
    return null;
  }

  const amount = formatUnits(owed, pool.decimals || 18);
  const symbol = pool.symbol || "tokens";
  const dest = shortAddress(treasury);
  const taxesBody = t("pool.taxesBody", { amount, symbol, dest });
  const destIdx = taxesBody.indexOf(dest);

  async function send() {
    setBusy(true);
    setMessage("");
    try {
      const wallet = await getWalletClient(config, { chainId: network.chain.id });
      if (!wallet) throw new Error(t("pool.connectWalletTaxes"));
      const hash = await sweepPoolTreasury(wallet, pool, network);
      setMessage(hash ? t("pool.sent", { dest }) : t("pool.nothing"));
      onUpdated();
    } catch (e: unknown) {
      setMessage(e instanceof Error ? e.message : t("pool.sendFail"));
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div className="glass !rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-hi">{t("pool.taxesWaiting")}</p>
        <p className="text-xs text-mid mt-1 leading-relaxed">
          {destIdx >= 0 ? (
            <>
              {taxesBody.slice(0, destIdx)}
              <a
                href={explorerAddressUrl(network, treasury)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-hi hover:underline"
                title={treasury}
              >
                {dest}
              </a>
              {taxesBody.slice(destIdx + dest.length)}
            </>
          ) : (
            taxesBody
          )}
        </p>
        {message ? <p className="text-[11px] text-mid mt-1">{message}</p> : null}
      </div>
      <button
        type="button"
        disabled={busy || !isConnected || chainId !== network.chain.id}
        onClick={() => setConfirmOpen(true)}
        className="h-10 px-4 rounded-xl text-xs font-semibold text-white shrink-0"
        style={{ background: "linear-gradient(180deg, #22c55e, #16a34a)" }}
      >
        {busy ? t("pool.sending") : t("pool.sendTaxes")}
      </button>
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-[80] grid place-items-center px-4"
          role="presentation"
          onClick={() => !busy && setConfirmOpen(false)}
        >
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[6px]" />
          <div
            role="dialog"
            aria-labelledby="treasury-release-title"
            className="relative w-full max-w-md rounded-2xl p-5 bg-white border border-black/10"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="treasury-release-title" className="text-base font-semibold text-hi">
              {t("pool.confirmTitle")}
            </h3>
            <p className="mt-2 text-sm text-mid leading-relaxed">
              {t("pool.confirmBody", { amount, symbol })}
            </p>
            <a
              href={explorerAddressUrl(network, treasury)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 block font-mono text-xs text-hi break-all hover:underline"
            >
              {treasury}
            </a>
            <p className="mt-2 text-[11px] text-lo leading-relaxed">
              {t("pool.confirmNote")}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
                className="h-10 px-4 rounded-xl text-xs font-semibold text-hi border border-black/15 hover:bg-black/[0.04]"
              >
                {t("pool.cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void send()}
                className="h-10 px-4 rounded-xl text-xs font-semibold text-white"
                style={{ background: "linear-gradient(180deg, #22c55e, #16a34a)" }}
              >
                {busy ? t("pool.sending") : t("pool.confirm", { dest })}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
