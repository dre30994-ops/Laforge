import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
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
  const tickMinutes = Math.round(TICK_SECONDS / 60);
  const tenureTickHours = Math.round(TENURE_TICK_SECONDS / 3600);
  const emissionStepHours = Math.round(EMISSION_STEP_SECONDS / 3600);

  // wei -> ETH string (up to 4 decimals, trimmed) for the launch-fee copy.
  const feeEth = (t: PoolTier): string => {
    const wei = TIER_FEE_WEI[t];
    const whole = wei / BigInt("1000000000000000000");
    const frac = wei % BigInt("1000000000000000000");
    const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
    return fracStr ? `${whole}.${fracStr}` : `${whole}`;
  };
  const maxTaxPct = MAX_TAX_BPS / 100;

  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[880px] mx-auto space-y-6">
            {/* Header */}
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                ← Back to dashboard
              </Link>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi mt-3">
                How The Forge works
              </h1>
              <p className="text-mid mt-2 leading-relaxed">
                A plain-English guide to staking on The Forge — how you earn, why holding
                longer pays more, and how to read the APY calculator. No jargon required.
              </p>
            </header>

            {/* TL;DR */}
            <section className="glass glass-gold p-6 animate-rise">
              <h2 className="label-term !text-[10px] mb-3">The 30-second version</h2>
              <ul className="space-y-2.5 text-sm text-mid leading-relaxed">
                <li className="flex gap-2.5">
                  <Dot /> You lock (&ldquo;stake&rdquo;) your tokens into a shared pool and earn rewards
                  every {tickMinutes} minutes.
                </li>
                <li className="flex gap-2.5">
                  <Dot /> The longer you keep them staked, the bigger your rewards grow — up to{" "}
                  <span className="text-gold-neon">{TENURE_MAX_MULT.toFixed(1)}×</span>.
                </li>
                <li className="flex gap-2.5">
                  <Dot /> Rewards are split among everyone in the pool by their share, so your
                  cut depends on how much you stake and how long you&rsquo;ve held.
                </li>
                <li className="flex gap-2.5">
                  <Dot /> The APY calculator lets you test &ldquo;what if I staked X for Y days?&rdquo;
                  before committing.
                </li>
                <li className="flex gap-2.5">
                  <Dot /> Anyone can spin up their own staking contract — you pick the token, the
                  tier, and the stake length (up to {MAX_DURATION_DAYS} days), and LaForge deploys a
                  dedicated pool for it.
                </li>
              </ul>
            </section>

            <Doc title="Preview a pool dashboard">
              <p>
                Live listings only show pools that have actually launched. If you want to see how
                Bronze, Ecosystem, and Marketing dashboards read — banners, socials, vault stats,
                and the add-on — open the sample walkthrough. Those screens are labeled sample
                data and are not a stake.
              </p>
              <p className="mt-3">
                <Link to="/preview" className="text-gold-neon hover:underline font-semibold">
                  Preview sample dashboards →
                </Link>
              </p>
            </Doc>

            <Doc title="More chains are on the way">
              <p>
                Creating a pool from the terminal is live on Robinhood and Ethereum today. More
                networks are being forged for the create picker and will appear there when
                they&rsquo;re ready — same app, same pools, no new download.
              </p>
            </Doc>

            {/* What is staking */}
            <Doc title="What does staking mean here?">
              <p>
                Staking is simply <span className="text-hi">parking your tokens</span> in the
                program so they earn rewards. While staked, your tokens aren&rsquo;t spent or sent
                anywhere — they&rsquo;re held in the pool and count toward your share of the rewards.
                You can unstake and take them back at any time.
              </p>
              <p>
                Think of it like a shared reward jar: everyone drops tokens in, the program adds
                fresh reward tokens on a schedule, and each person takes a slice sized to their
                contribution.
              </p>
            </Doc>

            {/* Create stakes — tiers + creator economics (near the top per request) */}
            <Doc title="Create stakes">
              <p>
                Anyone can be a <span className="text-hi">Stake Creator</span>. Inside LaForge you
                pick a reward token and launch a dedicated staking pool for it in one transaction —
                no code or deployment scripts. You become the pool&rsquo;s{" "}
                <span className="text-hi">operator and admin</span>, and other people stake into
                the pool you created.
              </p>

              <p>
                <span className="text-hi">You choose the stake length.</span> As the Stake Creator
                you set the pool&rsquo;s duration, and it can run for up to{" "}
                <span className="text-gold-neon">{MAX_DURATION_DAYS} days</span>. Choose any whole
                number of days from 1 up to that {MAX_DURATION_DAYS}-day maximum (the Bronze tier is
                capped lower — see below). Duration and taxes are locked in at launch, so pick them
                deliberately.
              </p>

              <h3 className="text-sm font-semibold text-hi mt-5 mb-1">Staking tiers</h3>
              <p className="text-sm">
                The launch fee and available features depend on the tier you pick when creating the
                pool:
              </p>
              <div className="grid sm:grid-cols-3 gap-3 not-prose my-2">
                <TierCard
                  name="Bronze"
                  fee={`${feeEth(PoolTier.Bronze)} ETH`}
                  duration={`Up to ${BRONZE_MAX_DURATION_DAYS} days (48h)`}
                  perks={["Core staking mechanics", "No banner or social links", "Best for quick, short campaigns"]}
                />
                <TierCard
                  name="Ecosystem"
                  fee={`${feeEth(PoolTier.Ecosystem)} ETH`}
                  duration={`Up to ${MAX_DURATION_DAYS} days`}
                  perks={["Everything in Bronze", "Custom banner image", "Website + social links", "Full pool dashboard"]}
                />
                <TierCard
                  name="Marketing"
                  fee={`${feeEth(PoolTier.Marketing)} ETH`}
                  duration={`Up to ${MAX_DURATION_DAYS} days`}
                  perks={["Everything in Ecosystem", "12h featured trending slot", "Verified-safe badge"]}
                />
              </div>
              <p className="text-lo text-sm">
                Bronze is capped at {BRONZE_MAX_DURATION_DAYS} days; Ecosystem and Marketing can run
                the full {MAX_DURATION_DAYS} days. Branding (banner + social links) is available on
                the Ecosystem and Marketing tiers only.
              </p>
              <p className="text-sm mt-3">
                Missed Marketing at launch? Anyone can pay the Marketing fee (
                {feeEth(PoolTier.Marketing)} ETH on Robinhood / Ethereum) anytime on the pool page.
                That is a community boost, not a stake. It unlocks banner and socials for the
                operator and a 12-hour trending slot. Paying again extends trending. The verified
                badge stays with the operator. The original on-chain launch tier does not change.
              </p>

              <h3 className="text-sm font-semibold text-hi mt-5 mb-1">How Stake Creators earn</h3>
              <p className="text-sm">
                Creators earn from <span className="text-hi">stake and unstake taxes</span> they
                set at launch. Each side can be configured up to{" "}
                <span className="text-gold-neon">{maxTaxPct}%</span>, and the collected tax is
                routed to the treasury address you choose:
              </p>
              <ul className="space-y-2 text-sm text-mid mt-1">
                <li className="flex gap-2.5">
                  <Dot /> <span><span className="text-hi">Stake tax</span> — a percentage taken when
                  someone stakes into your pool (up to {maxTaxPct}%), sent to your treasury.</span>
                </li>
                <li className="flex gap-2.5">
                  <Dot /> <span><span className="text-hi">Unstake tax</span> — a percentage taken
                  when someone withdraws (up to {maxTaxPct}%), sent to your treasury.</span>
                </li>
                <li className="flex gap-2.5">
                  <Dot /> <span>Leave the treasury blank to run a{" "}
                  <span className="text-hi">zero-tax pool</span> — friendlier to stakers, no fee
                  income for the creator.</span>
                </li>
              </ul>
              <Callout tone="warn">
                <span className="text-amber-neon">Immutable at launch:</span> the duration and both
                tax rates are fixed when the pool is created and can&rsquo;t be changed afterward.
                Funding the pool with reward tokens is a one-time deposit made at creation.
              </Callout>
            </Doc>

            {/* How rewards accrue */}
            <Doc title="How you earn rewards">
              <p>
                The pool releases a batch of reward tokens on a fixed heartbeat — once every{" "}
                <span className="text-hi">{tickMinutes} minutes</span>. That&rsquo;s{" "}
                <span className="text-gold-neon">{TICKS_PER_DAY} payouts a day</span>. Every payout
                is divided among stakers according to their share of the pool.
              </p>
              <StatRow
                items={[
                  { k: "Reward heartbeat", v: `every ${tickMinutes} min` },
                  { k: "Payouts per day", v: `${TICKS_PER_DAY}` },
                  { k: "Program length", v: `${PROGRAM_DAYS} days` },
                ]}
              />
              <p>
                Your share of each payout is based on your{" "}
                <span className="text-hi">reward weight</span> = the amount you staked ×
                your loyalty multiplier (explained next). The higher your weight compared to
                everyone else, the bigger your slice.
              </p>
            </Doc>

            {/* Tenure multiplier */}
            <Doc title="Why holding longer pays more (the loyalty multiplier)">
              <p>
                The Forge rewards patience. The moment you stake, your{" "}
                <span className="text-hi">tenure multiplier</span> starts at{" "}
                <span className="text-gold-neon">1.0×</span> and grows a little every{" "}
                {tenureTickHours === 1 ? "hour" : `${tenureTickHours} hours`} you stay staked. After{" "}
                <span className="text-gold-neon">{TENURE_MAX_DAYS} days</span> it reaches its
                maximum of <span className="text-gold-neon">{TENURE_MAX_MULT.toFixed(1)}×</span> —
                meaning your rewards are worth twice as much per token as someone who just joined.
              </p>
              <Callout tone="warn">
                <span className="text-amber-neon">Heads up:</span> if you unstake, your loyalty
                multiplier resets back to 1.0×. When you stake again, it starts climbing from the
                beginning. So frequent in-and-out staking works against you.
              </Callout>
            </Doc>

            {/* Emission ramp */}
            <Doc title="The early-days bonus (emissions ramp)">
              <p>
                On top of your personal loyalty multiplier, the whole program starts with a
                warm-up bonus. In the first{" "}
                <span className="text-gold-neon">{EMISSION_RAMP_DAYS} days</span>, the pool&rsquo;s
                reward output ramps up from{" "}
                <span className="text-hi">{EMISSION_MIN_MULT.toFixed(1)}×</span> to{" "}
                <span className="text-gold-neon">{EMISSION_MAX_MULT.toFixed(1)}×</span> (stepping up
                every {emissionStepHours} hours), then holds steady at the top for the rest of the
                program.
              </p>
              <p className="text-lo text-sm">
                In short: rewards start smaller and grow to full strength over the first{" "}
                {EMISSION_RAMP_DAYS} days, so early stakers see their yield climb as the ramp
                completes.
              </p>
            </Doc>

            {/* Actions */}
            <Doc title="What you can do">
              <div className="grid sm:grid-cols-3 gap-3 not-prose">
                <MiniCard title="Stake" desc="Lock tokens in and start earning. Your loyalty clock begins ticking." />
                <MiniCard title="Claim" desc="Collect the rewards you've earned without touching your staked balance." />
                <MiniCard title="Unstake" desc="Withdraw your tokens. Note: this resets your loyalty multiplier to 1.0×." />
              </div>
            </Doc>

            {/* Create your own pool — mechanics detail */}
            <Doc title="How your launched pool behaves">
              <p>
                Each token gets its own self-contained pool with the same mechanics described on
                this page — the reward heartbeat, loyalty multiplier, and emissions ramp all apply
                automatically. The pool runs for the length you set at creation (up to{" "}
                <span className="text-gold-neon">{MAX_DURATION_DAYS} days</span>). Once it&rsquo;s
                live, you can share it and let others stake into the pool you created.
              </p>
              <Callout tone="info">
                One pool is created per token: the first person to launch a pool for a given token
                establishes it, and everyone else stakes into that same shared pool for the token.
                See <span className="text-hi">&ldquo;Create stakes&rdquo;</span> above for tiers,
                fees, and how creators earn.
              </Callout>
            </Doc>

            {/* APY calculator */}
            <Doc title="Reading the APY calculator">
              <p>
                The calculator answers one question:{" "}
                <span className="text-hi">&ldquo;If I stake this much for this long, what might I earn?&rdquo;</span>{" "}
                Punch in a few numbers and it projects your rewards instantly. Here&rsquo;s what
                each field means:
              </p>
              <dl className="space-y-3 not-prose">
                <Field term="Stake amount" def="How many tokens you'd put in. Bigger stakes earn a bigger slice of every payout." />
                <Field term="Tenure · hold time" def={`How long you plan to stay staked. Drag it up to see your loyalty multiplier climb toward ${TENURE_MAX_MULT.toFixed(1)}× at ${TENURE_MAX_DAYS} days.`} />
                <Field term="Horizon" def="The window you want to project over (a day, a week, etc.). Longer horizons show more total rewards." />
              </dl>
              <p className="mt-4">Then it shows you:</p>
              <dl className="space-y-3 not-prose">
                <Field term="Est. APY" def="Your annualized return if rewards were reinvested and compounded daily. It's rounded down to two decimals, so it never overstates what you'd get." />
                <Field term="Est. APR" def="The simpler annualized rate without compounding. APY will usually look higher than APR because it assumes you keep reinvesting." />
                <Field term="Rewards / horizon" def="The actual number of reward tokens you'd collect over the window you chose." />
                <Field term="Daily yield" def="Roughly how many reward tokens you'd earn per day at the current rate." />
                <Field term="Share of emissions" def="Your slice of the whole pool's rewards, as a percentage. If more people join or stake more, your share shrinks." />
              </dl>
              <Callout tone="info">
                These are <span className="text-hi">projections, not promises.</span> They assume
                today&rsquo;s reward rate and pool size stay the same. Real results move as the pool&rsquo;s
                total size changes, as the early-days ramp completes, and if the operator adds more
                rewards.
              </Callout>
            </Doc>

            {/* What moves your APY */}
            <Doc title="What makes your APY go up or down">
              <StatRow
                items={[
                  { k: "Stake longer", v: "APY ↑" },
                  { k: "More people join", v: "APY ↓" },
                  { k: "Ramp completes", v: "APY ↑" },
                ]}
              />
              <ul className="space-y-2 text-sm text-mid mt-2">
                <li className="flex gap-2.5"><Dot /> <span><span className="text-pos">Higher</span> when your loyalty multiplier grows, or the emissions ramp pushes rewards to full strength.</span></li>
                <li className="flex gap-2.5"><Dot /> <span><span className="text-amber-neon">Lower</span> when the pool&rsquo;s total staked value rises (more people sharing the same rewards) or after you unstake and reset.</span></li>
              </ul>
            </Doc>

            {/* CTA */}
            <section className="glass p-6 text-center animate-rise">
              <h2 className="text-lg font-semibold text-hi tracking-tight">Ready to try the numbers?</h2>
              <p className="text-mid text-sm mt-1.5">
                Open the calculator and experiment with the live APY numbers.
              </p>
              <Link to="/calculator" className="inline-block mt-4">
                <span className="btn-neon !inline-block !w-auto !px-6">Open the calculator</span>
              </Link>
            </section>

            <footer className="pt-2 pb-4 text-center">
              <p className="label-term !tracking-normal !normal-case text-lo">
                Staking involves risk. Only stake what you can afford to lock up. This page is
                informational, not financial advice.
              </p>
            </footer>
          </div>
        </main>
    </TerminalShell>
  );
}

/* ── Small presentational helpers ── */

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
