import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { useI18n } from "@/components/LanguageProvider";
import {
  BRONZE_MAX_DURATION_DAYS,
  MAX_DURATION_DAYS,
  MAX_TAX_BPS,
  TIER_FEE_WEI,
  PoolTier,
} from "@/lib/factoryClient";
import {
  EMISSION_MAX_MULT,
  EMISSION_MIN_MULT,
  EMISSION_RAMP_DAYS,
  EMISSION_STEP_SECONDS,
  PROGRAM_DAYS,
  TENURE_MAX_DAYS,
  TENURE_MAX_MULT,
  TENURE_TICK_SECONDS,
  TICKS_PER_DAY,
  TICK_SECONDS,
} from "@/lib/economics";

/**
 * Consumer-friendly documentation for The Forge staking program.
 * Plain-language explanations of how staking, rewards, multipliers, and the
 * APY calculator work — sourced from the shared economics constants so the
 * numbers here always match the live app.
 */
export default function DocsPage() {
  const { t } = useI18n();
  const tickMinutes = Math.round(TICK_SECONDS / 60);
  const tenureTickHours = Math.round(TENURE_TICK_SECONDS / 3600);
  const emissionStepHours = Math.round(EMISSION_STEP_SECONDS / 3600);

  const feeEth = (tier: PoolTier): string => {
    const wei = TIER_FEE_WEI[tier];
    const whole = wei / BigInt("1000000000000000000");
    const frac = wei % BigInt("1000000000000000000");
    const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr}` : `${whole}`;
  };
  const maxTaxPct = MAX_TAX_BPS / 100;
  const tenureTickLabel =
    tenureTickHours === 1 ? t("docs.hour") : t("docs.hours", { n: tenureTickHours });

  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[880px] mx-auto space-y-6">
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                {t("docs.back")}
              </Link>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi mt-3">
                {t("docs.title")}
              </h1>
              <p className="text-mid mt-2 leading-relaxed">
                {t("docs.subtitle")}
              </p>
            </header>

            <section className="glass glass-gold p-6 animate-rise">
              <h2 className="label-term !text-[10px] mb-3">{t("docs.tldr")}</h2>
              <ul className="space-y-2.5 text-sm text-mid leading-relaxed">
                <li className="flex gap-2.5">
                  <Dot /> {t("docs.t1", { n: tickMinutes })}
                </li>
                <li className="flex gap-2.5">
                  <Dot /> {t("docs.t2", { n: TENURE_MAX_MULT.toFixed(1) })}
                </li>
                <li className="flex gap-2.5">
                  <Dot /> {t("docs.t3")}
                </li>
                <li className="flex gap-2.5">
                  <Dot /> {t("docs.t4")}
                </li>
                <li className="flex gap-2.5">
                  <Dot /> {t("docs.t5", { n: MAX_DURATION_DAYS })}
                </li>
              </ul>
            </section>

            <Doc title={t("docs.previewTitle")}>
              <p>{t("docs.previewP")}</p>
              <p className="mt-3">
                <Link to="/preview" className="text-gold-neon hover:underline font-semibold">
                  {t("docs.previewCta")}
                </Link>
              </p>
            </Doc>

            <Doc title={t("docs.moreTitle")}>
              <p>{t("docs.moreP")}</p>
            </Doc>

            <Doc title={t("docs.whatTitle")}>
              <p>{t("docs.whatP1")}</p>
              <p>{t("docs.whatP2")}</p>
            </Doc>

            <Doc title={t("docs.createTitle")}>
              <p>{t("docs.createP1")}</p>
              <p>{t("docs.createP2", { n: MAX_DURATION_DAYS })}</p>

              <h3 className="text-sm font-semibold text-hi mt-5 mb-1">{t("docs.tiers")}</h3>
              <p className="text-sm">{t("docs.tiersP")}</p>
              <div className="grid sm:grid-cols-3 gap-3 not-prose my-2">
                <TierCard
                  name={t("status.bronze")}
                  fee={`${feeEth(PoolTier.Bronze)} ETH`}
                  duration={t("docs.bronzeDur", { n: BRONZE_MAX_DURATION_DAYS })}
                  perks={[t("docs.bronzePerk1"), t("docs.bronzePerk2"), t("docs.bronzePerk3")]}
                />
                <TierCard
                  name={t("status.ecosystem")}
                  fee={`${feeEth(PoolTier.Ecosystem)} ETH`}
                  duration={t("docs.fullDur", { n: MAX_DURATION_DAYS })}
                  perks={[t("docs.ecoPerk1"), t("docs.ecoPerk2"), t("docs.ecoPerk3"), t("docs.ecoPerk4")]}
                />
                <TierCard
                  name={t("status.marketing")}
                  fee={`${feeEth(PoolTier.Marketing)} ETH`}
                  duration={t("docs.fullDur", { n: MAX_DURATION_DAYS })}
                  perks={[t("docs.mktPerk1"), t("docs.mktPerk2"), t("docs.mktPerk3")]}
                />
              </div>
              <p className="text-lo text-sm">
                {t("docs.bronzeNote", { bronze: BRONZE_MAX_DURATION_DAYS, max: MAX_DURATION_DAYS })}
              </p>
              <p className="text-sm mt-3">
                {t("docs.missedMkt", { fee: feeEth(PoolTier.Marketing) })}
              </p>

              <h3 className="text-sm font-semibold text-hi mt-5 mb-1">{t("docs.holdTitle")}</h3>
              <p className="text-sm">{t("docs.holdP")}</p>
              <h3 className="text-sm font-semibold text-hi mt-5 mb-1">{t("docs.refTitle")}</h3>
              <p className="text-sm">{t("docs.refP")}</p>

              <h3 className="text-sm font-semibold text-hi mt-5 mb-1">{t("docs.earnTitle")}</h3>
              <p className="text-sm">{t("docs.earnP", { max: maxTaxPct })}</p>
              <ul className="space-y-2 text-sm text-mid mt-1">
                <li className="flex gap-2.5">
                  <Dot /> <span>{t("docs.earnStake", { max: maxTaxPct })}</span>
                </li>
                <li className="flex gap-2.5">
                  <Dot /> <span>{t("docs.earnUnstake", { max: maxTaxPct })}</span>
                </li>
                <li className="flex gap-2.5">
                  <Dot /> <span>{t("docs.earnBlank")}</span>
                </li>
              </ul>
              <Callout tone="warn">{t("docs.immutable")}</Callout>
            </Doc>

            <Doc title={t("docs.rewardsTitle")}>
              <p>{t("docs.rewardsP", { n: tickMinutes, ticks: TICKS_PER_DAY })}</p>
              <StatRow
                items={[
                  { k: t("docs.heartbeat"), v: t("docs.everyMin", { n: tickMinutes }) },
                  { k: t("docs.payouts"), v: `${TICKS_PER_DAY}` },
                  { k: t("docs.program"), v: t("docs.days", { n: PROGRAM_DAYS }) },
                ]}
              />
              <p>{t("docs.shareP")}</p>
            </Doc>

            <Doc title={t("docs.tenureTitle")}>
              <p>
                {t("docs.tenureP", {
                  n: tenureTickLabel,
                  days: TENURE_MAX_DAYS,
                  max: TENURE_MAX_MULT.toFixed(1),
                })}
              </p>
              <Callout tone="warn">{t("docs.unstakeReset")}</Callout>
            </Doc>

            <Doc title={t("docs.rampTitle")}>
              <p>
                {t("docs.rampP", {
                  days: EMISSION_RAMP_DAYS,
                  min: EMISSION_MIN_MULT.toFixed(1),
                  max: EMISSION_MAX_MULT.toFixed(1),
                  step: emissionStepHours,
                })}
              </p>
              <p className="text-lo text-sm">{t("docs.rampShort", { n: EMISSION_RAMP_DAYS })}</p>
            </Doc>

            <Doc title={t("docs.doTitle")}>
              <div className="grid sm:grid-cols-3 gap-3 not-prose">
                <MiniCard title={t("docs.doStake")} desc={t("docs.doStakeD")} />
                <MiniCard title={t("docs.doClaim")} desc={t("docs.doClaimD")} />
                <MiniCard title={t("docs.doUnstake")} desc={t("docs.doUnstakeD")} />
              </div>
            </Doc>

            <Doc title={t("docs.behaveTitle")}>
              <p>{t("docs.behaveP", { n: MAX_DURATION_DAYS })}</p>
              <Callout tone="info">{t("docs.onePool")}</Callout>
            </Doc>

            <Doc title={t("docs.readTitle")}>
              <p>{t("docs.readP")}</p>
              <dl className="space-y-3 not-prose">
                <Field term={t("docs.fStake")} def={t("docs.fStakeD")} />
                <Field
                  term={t("docs.fTenure")}
                  def={t("docs.fTenureD", { max: TENURE_MAX_MULT.toFixed(1), days: TENURE_MAX_DAYS })}
                />
                <Field term={t("docs.fHorizon")} def={t("docs.fHorizonD")} />
              </dl>
              <p className="mt-4">{t("docs.then")}</p>
              <dl className="space-y-3 not-prose">
                <Field term={t("docs.fApy")} def={t("docs.fApyD")} />
                <Field term={t("docs.fApr")} def={t("docs.fAprD")} />
                <Field term={t("docs.fRewards")} def={t("docs.fRewardsD")} />
                <Field term={t("docs.fDaily")} def={t("docs.fDailyD")} />
                <Field term={t("docs.fShare")} def={t("docs.fShareD")} />
              </dl>
              <Callout tone="info">{t("docs.projections")}</Callout>
            </Doc>

            <Doc title={t("docs.moveTitle")}>
              <StatRow
                items={[
                  { k: t("docs.longer"), v: t("docs.longerV") },
                  { k: t("docs.more"), v: t("docs.moreV") },
                  { k: t("docs.ramp"), v: t("docs.rampV") },
                ]}
              />
              <ul className="space-y-2 text-sm text-mid mt-2">
                <li className="flex gap-2.5"><Dot /> <span>{t("docs.higher")}</span></li>
                <li className="flex gap-2.5"><Dot /> <span>{t("docs.lower")}</span></li>
              </ul>
            </Doc>

            <section className="glass p-6 text-center animate-rise">
              <h2 className="text-lg font-semibold text-hi tracking-tight">{t("docs.ready")}</h2>
              <p className="text-mid text-sm mt-1.5">{t("docs.readyP")}</p>
              <Link to="/calculator" className="inline-block mt-4">
                <span className="btn-neon !inline-block !w-auto !px-6">{t("docs.openCalc")}</span>
              </Link>
            </section>

            <footer className="pt-2 pb-4 text-center">
              <p className="label-term !tracking-normal !normal-case text-lo">
                {t("docs.risk")}
              </p>
            </footer>
          </div>
        </main>
    </TerminalShell>
  );
}

function Doc({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="glass p-6 animate-rise">
      <h2 className="text-lg font-semibold text-hi tracking-tight mb-3">{title}</h2>
      <div className="space-y-3 text-sm text-mid leading-relaxed [&_p]:leading-relaxed">
        {children}
      </div>
    </section>
  );
}

function Dot() {
  return (
    <span
      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
    />
  );
}

function StatRow({ items }: { items: { k: string; v: string }[] }) {
  return (
    <div className="grid grid-cols-3 gap-3 my-4 not-prose">
      {items.map((it) => (
        <div key={it.k} className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-3 text-center">
          <div className="mono text-base font-bold text-gold-neon leading-tight">{it.v}</div>
          <div className="label-term !text-[9px] !tracking-normal !normal-case mt-1">{it.k}</div>
        </div>
      ))}
    </div>
  );
}

function MiniCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-4">
      <div className="text-sm font-semibold text-gold-neon">{title}</div>
      <p className="text-xs text-mid mt-1.5 leading-relaxed">{desc}</p>
    </div>
  );
}

function TierCard({
  name,
  fee,
  duration,
  perks,
}: {
  name: string;
  fee: string;
  duration: string;
  perks: string[];
}) {
  return (
    <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-4 flex flex-col">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold text-gold-neon">{name}</div>
        <div className="mono text-xs text-hi">{fee}</div>
      </div>
      <div className="label-term !text-[9px] !tracking-normal !normal-case mt-1">{duration}</div>
      <ul className="mt-2.5 space-y-1.5">
        {perks.map((p) => (
          <li key={p} className="flex gap-2 text-xs text-mid leading-snug">
            <Dot /> <span>{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ term, def }: { term: string; def: string }) {
  return (
    <div className="rounded-lg border border-black/[0.06] bg-black/[0.02] p-3">
      <dt className="text-sm font-semibold text-hi">{term}</dt>
      <dd className="text-sm text-mid mt-1 leading-relaxed">{def}</dd>
    </div>
  );
}

function Callout({ tone, children }: { tone: "warn" | "info"; children: React.ReactNode }) {
  const border = tone === "warn" ? "rgba(255,157,46,0.3)" : "rgba(20,18,10,0.1)";
  return (
    <div
      className="rounded-xl p-4 text-sm text-mid leading-relaxed mt-1"
      style={{ border: `1px solid ${border}`, background: "rgba(20,18,10,0.02)" }}
    >
      {children}
    </div>
  );
}
