import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { WalletButton } from "@/components/WalletButton";
import { ChainBadge } from "@/components/PoolDirectory";
import { useConnectedAccount } from "@/hooks/useConnectedAccount";
import { useUserLedger } from "@/hooks/useUserLedger";
import { sanitizeImageSrc } from "@/lib/sanitize";
import { networkByChainId } from "@/lib/evmNetworks";
import { ClaimableTicker } from "@/components/ClaimableTicker";
import type { UserStake } from "@/lib/userLedger";
import { useI18n } from "@/components/LanguageProvider";

/**
 * Stake tab: every active and inactive position for the connected wallet.
 */
export default function StakePage() {
  const { t } = useI18n();
  const { address, connected } = useConnectedAccount();
  const { stakes } = useUserLedger(address);
  const active = stakes.filter((s) => s.active);
  const inactive = stakes.filter((s) => !s.active);

  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[900px] mx-auto space-y-6">
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                {t("common.back")}
              </Link>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi mt-3">
                {t("stakePage.title")}
              </h1>
              <p className="text-mid mt-2 leading-relaxed">
                {t("stakePage.intro")}
              </p>
            </header>

            <div
              className="animate-rise rounded-xl p-4 text-sm leading-relaxed"
              style={{
                border: "1px solid rgba(255,157,46,0.3)",
                background: "rgba(255,157,46,0.06)",
              }}
              role="note"
            >
              <span className="text-amber-neon font-semibold">{t("stakePage.trust")}</span>{" "}
              <span className="text-mid">
                {t("stakePage.trustBody")}
              </span>
            </div>

            {!connected ? (
              <ConnectPrompt />
            ) : stakes.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <StakeGroup title={t("stakePage.active")} testId="active" count={active.length} items={active} empty={t("stakePage.noActive")} />
                <StakeGroup
                  title={t("stakePage.inactive")}
                  testId="inactive"
                  count={inactive.length}
                  items={inactive}
                  empty={t("stakePage.noInactive")}
                />
              </>
            )}
          </div>
        </main>
    </TerminalShell>
  );
}

function StakeGroup({
  title,
  testId,
  count,
  items,
  empty,
}: {
  title: string;
  testId: string;
  count: number;
  items: UserStake[];
  empty: string;
}) {
  return (
    <section className="glass p-5 animate-rise" data-testid={`stake-group-${testId}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-hi tracking-tight">{title}</h2>
        <span className="label-term">{count}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-mid">{empty}</p>
      ) : (
        <ul className="divide-y divide-black/[0.06]">
          {items.map((s) => (
            <StakeRow key={s.id} stake={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function StakeRow({ stake }: { stake: UserStake }) {
  const { t } = useI18n();
  const title = stake.name?.trim() || stake.symbol || t("historyPage.token");
  const img = sanitizeImageSrc(stake.image);
  const net = networkByChainId(stake.chainId);
  const when = new Date(stake.updatedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li>
      <Link
        to="/pool/$chainId/$address"
        params={{ chainId: String(stake.chainId), address: stake.pool }}
        className="flex items-center gap-3 py-3 hover:bg-black/[0.02] rounded-lg px-1 -mx-1"
      >
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
            {(stake.symbol || "?").slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-hi truncate">{title}</span>
            {net && <ChainBadge chainKey={net.key} />}
          </div>
          <div className="label-term !text-[9px] !tracking-normal !normal-case mt-0.5">
            {t("stakePage.updated", { when })}
          </div>
        </div>
        <div className="text-right shrink-0">
          {stake.active ? (
            <ClaimableTicker
              pool={stake.pool}
              chainId={stake.chainId}
              symbol={stake.symbol}
              compact
            />
          ) : (
            <>
              <div className="mono text-sm font-semibold text-hi">{stake.amount}</div>
              <div className="label-term !text-[8px]">{t("stakePage.inactive")}</div>
            </>
          )}
          {stake.active && (
            <div className="mono text-[11px] text-mid mt-1">{stake.amount} {t("position.staked")}</div>
          )}
        </div>
      </Link>
    </li>
  );
}

function ConnectPrompt() {
  const { t } = useI18n();
  return (
    <section className="glass glass-gold p-10 text-center animate-rise">
      <h2 className="text-lg font-semibold text-hi tracking-tight">{t("stakePage.connectTitle")}</h2>
      <p className="text-mid text-sm mt-1.5 max-w-sm mx-auto leading-relaxed">
        {t("stakePage.connectBody")}
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
      <h2 className="text-lg font-semibold text-hi tracking-tight">{t("stakePage.emptyTitle")}</h2>
      <p className="text-mid text-sm mt-1.5">
        {t("stakePage.emptyBody")}
      </p>
      <Link to="/pools" className="inline-block mt-5">
        <span className="btn-neon !inline-block !w-auto !px-6">{t("stakePage.browse")}</span>
      </Link>
    </section>
  );
}
