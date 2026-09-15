"use client";

import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";
import { ApyCalculator } from "@/components/ApyCalculator";

/**
 * Dedicated APY calculator page: the projector on its own, plus a short,
 * plain-language walkthrough of how to read it. Reached from the sidebar's
 * "Calculator" entry (/calculator).
 */
export default function CalculatorPage() {
  return (
    <div className="terminal-root terminal-grid">
      <div className="relative z-[1] flex min-h-screen">
        {/* Sidebar */}
        <div className="hidden lg:block w-[248px] shrink-0 p-4 sticky top-0 h-screen">
          <Sidebar />
        </div>

        {/* Feed */}
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[560px] mx-auto space-y-6">
            {/* Header */}
            <header className="animate-rise">
              <Link href="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                ← Back to dashboard
              </Link>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi mt-3">
                APY Calculator
              </h1>
              <p className="text-mid mt-2 leading-relaxed">
                Project your yield before you stake. Enter an amount, set how long
                you&rsquo;ve held, and pick a horizon to see estimated APY, APR, and rewards.
              </p>
            </header>

            {/* The calculator, on its own */}
            <ApyCalculator />

            {/* Brief usage example */}
            <section className="glass p-6 animate-rise">
              <h2 className="label-term !text-[10px] mb-3">How to use it — a quick example</h2>

              <ol className="space-y-3 text-sm text-mid leading-relaxed">
                <li className="flex gap-3">
                  <Step n={1} />
                  <span>
                    <span className="text-hi">Enter your stake.</span> Say you plan to stake{" "}
                    <span className="mono text-gold-neon">100,000</span> tokens — type that
                    into <span className="text-hi">Stake amount</span>.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Step n={2} />
                  <span>
                    <span className="text-hi">Set your tenure.</span> Drag the{" "}
                    <span className="text-hi">Tenure · hold time</span> slider to how many days
                    you expect to hold. Longer holds ramp your multiplier from{" "}
                    <span className="mono text-gold-neon">1.00x</span> up to{" "}
                    <span className="mono text-gold-neon">2.00x</span> — so at{" "}
                    <span className="mono">4d</span> you might see about{" "}
                    <span className="mono text-gold-neon">1.57x</span>.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Step n={3} />
                  <span>
                    <span className="text-hi">Pick a horizon.</span> Choose{" "}
                    <span className="mono">1d</span>, <span className="mono">7d</span>,{" "}
                    <span className="mono">14d</span>, or <span className="mono">30d</span> to
                    set the projection window for the rewards figure.
                  </span>
                </li>
                <li className="flex gap-3">
                  <Step n={4} />
                  <span>
                    <span className="text-hi">Read the results.</span>{" "}
                    <span className="text-gold-neon">Est. APY</span> is your compounded annual
                    yield; <span className="text-gold-neon">Est. APR</span> is the simple
                    (non-compounded) rate. <span className="text-pos">Rewards</span> shows what
                    you&rsquo;d earn over the chosen horizon, and{" "}
                    <span className="text-pos">Daily yield</span> is the per-day estimate. The{" "}
                    <span className="text-hi">Share of emissions</span> bar shows how much of
                    the pool&rsquo;s output your position captures.
                  </span>
                </li>
              </ol>

              <p className="label-term !text-[9px] !tracking-normal !normal-case mt-5 leading-snug text-lo">
                These are estimates. Real yield moves with total value locked, the emission
                ramp, and operator top-ups — so the numbers shift as the pool changes. For the
                full mechanics, see the{" "}
                <Link href="/docs" className="text-gold-neon hover:underline">
                  docs
                </Link>
                .
              </p>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      className="mono shrink-0 grid place-items-center w-6 h-6 rounded-lg text-[11px] font-bold text-[#0a0c0f]"
      style={{ background: "linear-gradient(180deg, var(--neon-gold), var(--amber))" }}
    >
      {n}
    </span>
  );
}
