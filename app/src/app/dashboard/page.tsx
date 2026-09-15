"use client";

import { Sidebar } from "@/components/Sidebar";
import { HeroMetrics } from "@/components/HeroMetrics";
import { StakingHero } from "@/components/StakingHero";
import { RewardChart } from "@/components/RewardChart";
import { ApyCalculator } from "@/components/ApyCalculator";
import { PositionStrip } from "@/components/PositionStrip";
import { CreatePoolButton } from "@/components/CreatePoolButton";
import { PoolDirectory } from "@/components/PoolDirectory";
import { TickerCarousel } from "@/components/TickerCarousel";
import { PoolSearchProvider, PoolSearchBar } from "@/components/PoolSearchContext";

export default function Home() {
  return (
    <div className="terminal-root terminal-grid">
      <div className="relative z-[1] flex min-h-screen">
        {/* Sidebar */}
        <div className="hidden lg:block w-[248px] shrink-0 p-4 sticky top-0 h-screen">
          <Sidebar />
        </div>

        {/* Main feed */}
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[1600px] mx-auto space-y-6">
            <PoolSearchProvider>
            {/* Top bar (mobile brand + tagline) */}
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-hi">
                  Staking Terminal
                </h1>
                <p className="label-term mt-1">
                  One pool · emissions ramp 1.0x→2.0x over 1d · tenure grows hourly
                </p>
              </div>
              <div className="flex items-center gap-3">
                <PoolSearchBar />
                <CreatePoolButton />
                <div className="hidden md:flex items-center gap-2">
                  <span className="pulse-dot" />
                  <span className="label-term">Mainnet feed · live</span>
                </div>
              </div>
            </div>

            {/* Staking hero: value prop + CTAs, encircled mark */}
            <StakingHero />

            {/* Thin scrolling highlights carousel (below Create Stake) */}
            <TickerCarousel />

            {/* Hero metrics */}
            <HeroMetrics />

            {/* Chart + calculator */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
              <div className="xl:col-span-2">
                <RewardChart />

                {/* Locked tokens explainer — sits directly below the reward
                    growth chart. Gold-gradient heading; concise note on the
                    immutability of funded stakes. */}
                <div className="glass p-6 md:p-8 mt-6">
                  <h3
                    className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight
                               bg-clip-text text-transparent animate-gradient-move"
                    style={{
                      backgroundImage:
                        "linear-gradient(90deg, #b8860b 0%, #ffcf4d 35%, #fff6d6 70%, #ffffff 100%)",
                      backgroundSize: "200% auto",
                    }}
                  >
                    Immutable stakes and Locked tokens
                  </h3>
                  <p className="text-base md:text-lg text-mid mt-4 leading-relaxed">
                    Stakes are immutable. Once a stake is funded, those tokens are
                    locked — the only way they flow back out is through{" "}
                    <span className="text-hi">emissions earned by staking</span>.
                    Stake creators don’t withdraw the pool; instead they can choose
                    to collect the <span className="text-hi">stake and unstake
                    tax</span> as fees, which rewards them for keeping holders
                    staked over time.
                  </p>
                </div>
              </div>
              <div className="xl:col-span-1">
                <ApyCalculator />
              </div>
            </div>

            {/* Position + quick actions */}
            <PositionStrip />

            {/* Pool directory (all pools launched on the factory) */}
            <PoolDirectory />

            <footer className="pt-4 pb-2 text-center">
              <p className="label-term !tracking-normal !normal-case text-lo">
                Tenure resets on unstake · rate can rise if the operator tops up
              </p>
            </footer>
            </PoolSearchProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
