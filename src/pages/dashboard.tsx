import { TerminalShell } from "@/components/TerminalShell";
import { HeroMetrics } from "@/components/HeroMetrics";
import { StakingHero } from "@/components/StakingHero";
import { PositionStrip } from "@/components/PositionStrip";
import { CreatePoolButton } from "@/components/CreatePoolButton";
import { PoolDirectory } from "@/components/PoolDirectory";
import { ChainSwitch } from "@/components/ChainSwitch";
import { PoolSearch } from "@/components/PoolSearch";
import { ImmutableStakeCard } from "@/components/ImmutableStakeCard";
import { OfficialLinks } from "@/components/OfficialLinks";
import { ReferralCard } from "@/components/ReferralCard";
import { ConnectWithX } from "@/components/ConnectWithX";
import { WalletButton } from "@/components/WalletButton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useI18n } from "@/components/LanguageProvider";

export default function Home() {
  const { t } = useI18n();
  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[1600px] mx-auto space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-xl font-semibold tracking-tight text-hi">
                  {t("dash.title")}
                </h1>
                <p className="label-term mt-1" data-testid="protocol-tvl-caption">
                  {t("dash.caption")}
                </p>
              </div>
              <div className="flex items-center gap-2 sm:gap-3 shrink-0 flex-wrap lg:pr-[7.5rem]">
                <div className="flex items-center gap-1.5">
                  <ConnectWithX />
                  <LanguageToggle />
                </div>
                <WalletButton />
                <CreatePoolButton />
                <div className="hidden md:flex items-center gap-2">
                  <span className="pulse-dot" />
                  <span className="label-term">{t("dash.live")}</span>
                </div>
              </div>
            </div>

            <PoolSearch />

            <div className="lg:hidden">
              <ChainSwitch compact />
            </div>

            <StakingHero />

            <ImmutableStakeCard />

            <HeroMetrics hideTvl />

            {/* Previous row: RewardChart (wide) + ApyCalculator (side). Restore those two to bring the graph back. */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
              <div className="xl:col-span-2">
                <section className="glass p-6 min-h-[220px]" data-testid="dash-steps">
                  <p className="label-term mb-4">{t("dash.stepsKicker")}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {(
                      [
                        ["01", t("dash.step1"), t("dash.step1d")],
                        ["02", t("dash.step2"), t("dash.step2d")],
                        ["03", t("dash.step3"), t("dash.step3d")],
                      ] as const
                    ).map(([n, title, body]) => (
                      <div key={n} className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-4">
                        <div className="text-[11px] font-semibold tracking-[0.16em] text-gold-neon">{n}</div>
                        <div className="mt-2 text-sm font-semibold text-hi">{title}</div>
                        <p className="mt-1 text-xs text-mid leading-relaxed">{body}</p>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
              <section className="glass p-6 min-h-[220px] flex flex-col" data-testid="dash-tenure">
                <p className="label-term">{t("dash.tenureKicker")}</p>
                <div className="mt-3 text-5xl font-semibold tracking-tight hero-title-gold">2×</div>
                <p className="mt-3 text-sm text-mid leading-relaxed">{t("dash.tenureBody")}</p>
              </section>
            </div>

            <section className="glass p-6 md:p-8 animate-rise" data-testid="holder-rewards-card">
              <p className="label-term mb-2">{t("dash.holderKicker")}</p>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight hero-title-gold">
                {t("dash.holderTitle")}
              </h2>
              <p className="mt-3 text-sm md:text-base text-mid leading-relaxed max-w-3xl">
                {t("dash.holderBody")}
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                {["pump.fun", "Pons", "StonkFun"].map((name) => (
                  <span
                    key={name}
                    className="rounded-full border border-black/10 bg-black/[0.03] px-3.5 py-1.5 text-xs font-semibold tracking-wide text-hi"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </section>

            <PositionStrip />

            <PoolDirectory />

            <ReferralCard />

            <OfficialLinks />

            <footer className="pt-4 pb-2 text-center">
              <p className="label-term !tracking-normal !normal-case text-lo">
                {t("dash.footer")}
              </p>
            </footer>
          </div>
        </main>
    </TerminalShell>
  );
}
