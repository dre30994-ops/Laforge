import { TerminalShell } from "@/components/TerminalShell";
import { HeroMetrics } from "@/components/HeroMetrics";
import { StakingHero } from "@/components/StakingHero";
import { WorldForgeCard } from "@/components/WorldForgeCard";
import { CreatePoolButton } from "@/components/CreatePoolButton";
import { PoolDirectory } from "@/components/PoolDirectory";
import { ChainSwitch } from "@/components/ChainSwitch";
import { PoolSearch } from "@/components/PoolSearch";
import { ImmutableStakeCard } from "@/components/ImmutableStakeCard";
import { OfficialLinks } from "@/components/OfficialLinks";
import { ReferralCard } from "@/components/ReferralCard";
import { WalletButton } from "@/components/WalletButton";
import { LanguageToggle } from "@/components/LanguageToggle";
import { ThemeToggle } from "@/components/ThemeToggle";
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
                  <LanguageToggle />
                  <ThemeToggle />
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
            <section className="glass p-4 md:p-5" data-testid="dash-steps">
              <p className="label-term mb-3">{t("dash.stepsKicker")}</p>
              <div className="grid grid-cols-6 gap-2">
                {(
                  [
                    ["01", t("dash.step1"), t("dash.step1d")],
                    ["02", t("dash.step2"), t("dash.step2d")],
                    ["03", t("dash.step3"), t("dash.step3d")],
                    ["04", t("dash.step4"), t("dash.step4d")],
                    ["05", t("dash.step5"), t("dash.step5d")],
                  ] as const
                ).map(([n, title, body]) => (
                  <div key={n} className="min-w-0 rounded-xl border border-black/[0.06] bg-black/[0.02] p-2.5 md:p-3">
                    <div className="text-[10px] font-semibold tracking-[0.14em] text-gold-neon">{n}</div>
                    <div className="mt-1.5 text-xs md:text-sm font-semibold text-hi">{title}</div>
                    <p className="mt-1 text-[10px] md:text-[11px] text-mid leading-snug">{body}</p>
                  </div>
                ))}
                <div className="min-w-0 rounded-xl border border-black/[0.06] bg-black/[0.02] p-2.5 md:p-3" data-testid="dash-tenure">
                  <div className="text-[10px] font-semibold tracking-[0.14em] text-gold-neon">{t("dash.tenureKicker")}</div>
                  <div className="mt-1 text-xl md:text-2xl font-semibold leading-none tracking-tight hero-title-gold">2×</div>
                  <p className="mt-1.5 text-[10px] md:text-[11px] text-mid leading-snug">{t("dash.tenureBody")}</p>
                </div>
              </div>
            </section>

            <section className="glass p-6 md:p-8 animate-rise" data-testid="holder-rewards-card">
              <div className="flex flex-col items-center gap-6 md:flex-row md:items-center">
                <div className="min-w-0 flex-1">
                  <p className="label-term mb-2">{t("dash.holderKicker")}</p>
                  <h2 className="text-3xl md:text-4xl font-semibold tracking-tight leading-tight hero-title-gold">
                    {t("dash.holderTitle")}
                  </h2>
                  <p className="mt-3 text-sm md:text-base text-mid leading-relaxed max-w-3xl">
                    {t("dash.holderBody")}
                  </p>
                </div>
                <LaunchpadOrbit />
              </div>
            </section>

            <WorldForgeCard />

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

const LAUNCH_MARKS = [
  { src: "/launchpads/pump.svg", name: "pump.fun", plate: "#10241f" },
  { src: "/launchpads/pons.png", name: "Pons", plate: "#050505" },
  { src: "/launchpads/stonk.svg", name: "StonkFun", plate: "#071013" },
] as const;

/** pump.fun, Pons, and StonkFun orbit a pool. Each mark stays upright; its arrow keeps aiming inward. */
function LaunchpadOrbit() {
  const radius = 76;
  return (
    <div className="relative h-[220px] w-[220px] shrink-0" aria-hidden>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-black/10"
        style={{ width: radius * 2, height: radius * 2 }}
      />
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <PoolMark />
      </div>
      <div className="launch-orbit absolute inset-0">
        {LAUNCH_MARKS.map((mark, i) => {
          const angle = (i / LAUNCH_MARKS.length) * Math.PI * 2 - Math.PI / 2;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          const face = (angle * 180) / Math.PI + 90;
          return (
            <span
              key={mark.name}
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${face}deg)`,
              }}
            >
              <span className="flex flex-col items-center">
                <span className="logo-upright">
                  <span
                    className="grid h-11 w-11 place-items-center overflow-hidden rounded-xl border border-white/20 shadow-[0_8px_18px_rgba(80,50,0,0.18)]"
                    style={{ background: mark.plate, transform: `rotate(${-face}deg)` }}
                    title={mark.name}
                  >
                    <img src={mark.src} alt="" className="h-8 w-8 object-contain" />
                  </span>
                </span>
                <span
                  className="mt-1 block h-0 w-0 border-x-[5px] border-x-transparent border-t-[7px] border-t-[#d4a017]"
                />
              </span>
            </span>
          );
        })}
      </div>
      <style>{`
        .launch-orbit { animation: launch-spin 26s linear infinite; }
        .logo-upright { animation: launch-spin 26s linear infinite reverse; display: grid; }
        @keyframes launch-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .launch-orbit, .logo-upright { animation: none; }
        }
      `}</style>
    </div>
  );
}

function PoolMark() {
  const id = "holder-pool";
  return (
    <svg viewBox="0 0 88 88" className="h-16 w-16" aria-hidden>
      <defs>
        <radialGradient id={`${id}-water`} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor="#fff6d2" />
          <stop offset="45%" stopColor="#e8c56a" />
          <stop offset="100%" stopColor="#a97812" />
        </radialGradient>
        <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff4c8" />
          <stop offset="100%" stopColor="#8a6410" />
        </linearGradient>
      </defs>
      <ellipse cx="44" cy="62" rx="30" ry="8" fill="#c9971a" opacity="0.18" />
      <ellipse cx="44" cy="46" rx="28" ry="16" fill={`url(#${id}-water)`} />
      <ellipse cx="44" cy="42" rx="16" ry="7" fill="#fff8e4" opacity="0.45" />
      <ellipse cx="44" cy="46" rx="28" ry="16" fill="none" stroke={`url(#${id}-rim)`} strokeWidth="3" />
      <ellipse cx="44" cy="46" rx="20" ry="10" fill="none" stroke="#fff6d2" strokeOpacity="0.55" strokeWidth="1" />
    </svg>
  );
}
