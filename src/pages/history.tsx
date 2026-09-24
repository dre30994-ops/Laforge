import { Link } from "@tanstack/react-router";
import { useAccount } from "wagmi";
import { WalletButton } from "@/components/WalletButton";
import { TerminalShell } from "@/components/TerminalShell";
import { useConnectedAccount } from "@/hooks/useConnectedAccount";
import { useUserLedger } from "@/hooks/useUserLedger";
import { sanitizeImageSrc } from "@/lib/sanitize";
import { networkByChainId } from "@/lib/evmNetworks";
import type { ActivityItem, ActivityKind } from "@/lib/userLedger";
import { useI18n } from "@/components/LanguageProvider";

const ACTION_META: Record<
  ActivityKind,
  { color: string; sign: "+" | "-" }
> = {
  stake: { color: "var(--pos)", sign: "+" },
  unstake: { color: "var(--amber)", sign: "-" },
  claim: { color: "var(--neon-gold)", sign: "+" },
};

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function HistoryPage() {
  const { t } = useI18n();
  const { address: selected, connected: selectedOn } = useConnectedAccount();
  const evm = useAccount();
  const address = evm.address ?? (selectedOn ? selected : null);
  const connected = Boolean(address);
  const { activity, loading } = useUserLedger(address);

  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[1000px] mx-auto space-y-6">
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                {t("common.back")}
              </Link>
              <div className="flex items-end justify-between flex-wrap gap-3 mt-3">
                <div>
                  <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi">
                    {t("historyPage.title")}
                  </h1>
                  <p className="text-mid mt-2 leading-relaxed">
                    {t("historyPage.intro")}
                  </p>
                </div>
                {connected && address && (
                  <div className="glass !rounded-xl px-4 py-2.5">
                    <div className="label-term !text-[9px]">{t("historyPage.account")}</div>
                    <div className="mono text-sm text-gold-neon">
                      {address.slice(0, 6)}…{address.slice(-4)}
                    </div>
                  </div>
                )}
              </div>
            </header>

            {!connected ? (
              <ConnectPrompt />
            ) : loading && activity.length === 0 ? (
              <p className="glass p-8 text-center text-sm text-mid">{t("historyPage.loading")}</p>
            ) : activity.length === 0 ? (
              <EmptyState />
            ) : (
              <ActivityLog events={activity} />
            )}
          </div>
        </main>
    </TerminalShell>
  );
}

function ConnectPrompt() {
  const { t } = useI18n();
  return (
    <section className="glass glass-gold p-10 text-center animate-rise">
      <h2 className="text-lg font-semibold text-hi tracking-tight">{t("historyPage.connect")}</h2>
      <p className="text-mid text-sm mt-1.5 max-w-sm mx-auto leading-relaxed">
        {t("historyPage.connectBody")}
      </p>
      <div className="mt-5 flex justify-center">
        <WalletButton />
      </div>
    </section>
  );
}

function EmptyState() {
  const { t } = useI18n();
  return (
    <section className="glass p-10 text-center animate-rise">
      <h2 className="text-lg font-semibold text-hi tracking-tight">{t("historyPage.empty")}</h2>
      <p className="text-mid text-sm mt-1.5">
        {t("historyPage.emptyBody")}
      </p>
      <Link to="/pools" className="inline-block mt-5">
        <span className="btn-neon !inline-block !w-auto !px-6">{t("historyPage.browse")}</span>
      </Link>
    </section>
  );
}

function ActivityLog({ events }: { events: ActivityItem[] }) {
  const { t } = useI18n();
  return (
    <section className="glass p-4 sm:p-5 animate-rise" data-testid="history-list">
      <div className="flex items-center justify-between mb-3 px-1">
        <h2 className="text-sm font-semibold text-hi tracking-tight">{t("historyPage.timeline")}</h2>
        <span className="label-term">{t("historyPage.events", { n: events.length })}</span>
      </div>

      <ul className="divide-y divide-black/[0.06]">
        {events.map((e) => {
          const meta = ACTION_META[e.kind];
          const title = e.name?.trim() || e.symbol || t("historyPage.token");
          const net = networkByChainId(e.chainId);
          const img = sanitizeImageSrc(e.image);
          return (
            <li key={e.id} className="flex items-center gap-3 px-2 py-3">
              {img ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={img}
                  alt=""
                  className="h-10 w-10 rounded-xl object-cover border border-black/10 shrink-0"
                />
              ) : (
                <div
                  className="h-10 w-10 rounded-xl shrink-0 grid place-items-center text-[11px] font-bold text-[#0a0c0f]"
                  style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
                >
                  {(e.symbol || "?").slice(0, 2).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold text-hi truncate">{title}</span>
                  <span className="text-[11px] font-semibold" style={{ color: meta.color }}>
                    {t(`historyPage.${e.kind}`)}
                  </span>
                </div>
                <div className="label-term !text-[9px] !tracking-normal !normal-case truncate mt-0.5">
                  {e.at > 0 ? fmtDateTime(e.at) : "—"}
                  {net ? ` · ${net.short}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="mono text-sm font-semibold" style={{ color: meta.color }}>
                  {meta.sign}
                  {e.amount}
                </div>
                {e.symbol && <div className="label-term !text-[8px]">{e.symbol}</div>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
