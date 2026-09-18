import { Link } from "@tanstack/react-router";
import { CreatePoolButton } from "@/components/CreatePoolButton";
import { EthereumMark, GoldQuestionMark, RobinhoodFeather } from "@/components/BrandMarks";
import { useI18n } from "@/components/LanguageProvider";

/**
 * Dashboard hero band.
 *
 * Left column: a short value-proposition about staking, a primary
 * "Create Stake" call-to-action, and a secondary "How it works" link that
 * routes to the docs page.
 *
 * Right column: the Laforge mark (icon2_nobg.png) centered inside a slowly
 * rotating ring — Robinhood + Ethereum plus four gold question marks for
 * networks still in the forge.
 */
export function StakingHero() {
  const { t } = useI18n();
  return (
    <section className="glass glass-gold p-6 md:p-8 animate-rise overflow-hidden">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
        <div className="min-w-0">
          <span className="label-term text-pos">{t("hero.kicker")}</span>
          <h2 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight leading-tight hero-title-gold">
            {t("hero.title")}
          </h2>
          <p className="mt-3 text-sm md:text-base text-mid leading-relaxed max-w-md">
            {t("hero.body")}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <CreatePoolButton label={t("nav.createStake")} />
            <Link
              to="/docs"
              className="inline-flex items-center justify-center gap-2 h-10 px-5 rounded-xl
                         text-sm font-semibold text-hi border border-black/15
                         hover:border-black/25 hover:bg-black/[0.04] transition-colors"
              style={{ fontFamily: "var(--font-mono, monospace)" }}
            >
              {t("hero.how")}
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M5 12h14" />
                <path d="M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </div>

        <div className="grid place-items-center">
          <OrbitMark />
        </div>
      </div>
    </section>
  );
}

const ORBIT_KEYS = ["robinhood", "ethereum", "q1", "q2", "q3", "q4"] as const;

function OrbitIcon({ name }: { name: (typeof ORBIT_KEYS)[number] }) {
  if (name === "robinhood") return <RobinhoodFeather size={22} />;
  if (name === "ethereum") return <EthereumMark size={22} />;
  return <GoldQuestionMark size={22} />;
}

function OrbitMark() {
  const radius = 118;
  const count = ORBIT_KEYS.length;

  return (
    <div className="relative w-[300px] h-[300px] max-w-full grid place-items-center">
      <div
        aria-hidden
        className="absolute w-40 h-40 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(255,207,77,0.22) 0%, rgba(255,207,77,0) 70%)",
        }}
      />

      <div
        aria-hidden
        className="absolute rounded-full border border-dashed border-black/10"
        style={{ width: radius * 2, height: radius * 2 }}
      />

      <div
        aria-hidden
        className="absolute inset-0"
        style={{ animation: "hero-orbit 40s linear infinite" }}
      >
        {ORBIT_KEYS.map((key, i) => {
          const angle = (i / count) * 2 * Math.PI - Math.PI / 2;
          const x = Math.cos(angle) * radius;
          const y = Math.sin(angle) * radius;
          return (
            <span
              key={key}
              className="absolute left-1/2 top-1/2 grid place-items-center w-10 h-10 rounded-xl
                         select-none overflow-hidden"
              style={{
                transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
                background: "rgba(20,18,10,0.04)",
                border: "1px solid var(--hairline)",
                backdropFilter: "blur(6px)",
              }}
            >
              <span
                className="grid place-items-center"
                style={{ animation: "hero-orbit-counter 40s linear infinite" }}
              >
                <OrbitIcon name={key} />
              </span>
            </span>
          );
        })}
      </div>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon2_nobg.png"
        alt="Laforge"
        className="relative z-[1] w-28 h-28 md:w-32 md:h-32 object-contain drop-shadow-[0_0_28px_rgba(255,207,77,0.35)]"
      />

      <style>{`
        @keyframes hero-orbit {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes hero-orbit-counter {
          from { transform: rotate(0deg); }
          to { transform: rotate(-360deg); }
        }
        @media (prefers-reduced-motion: reduce) {
          .absolute[style] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
