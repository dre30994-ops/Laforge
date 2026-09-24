import { useId } from "react";
import { useI18n } from "@/components/LanguageProvider";

export function ImmutableStakeCard() {
  const { t } = useI18n();
  return (
    <section className="glass group p-6 animate-rise" data-testid="immutable-stake-card">
      <div className="flex items-center gap-4 md:gap-8">
        <div className="min-w-0 flex-1">
          <p className="label-term mb-2">{t("immutable.kicker")}</p>
          <h2 className="mt-1 text-3xl md:text-4xl font-semibold tracking-tight leading-tight hero-title-gold">
            {t("immutable.title")}
          </h2>
          <p className="mt-3 text-sm md:text-base text-mid leading-relaxed">
            {t("immutable.p1")}
          </p>
          <p className="mt-3 text-sm md:text-base text-mid leading-relaxed">
            {t("immutable.p2")}
          </p>
        </div>
        <GoldLock />
      </div>
    </section>
  );
}

function GoldLock() {
  const uid = useId().replace(/:/g, "");
  const body = `${uid}-body`;
  const shackle = `${uid}-shackle`;
  const glow = `${uid}-glow`;
  const shadow = `${uid}-shadow`;

  return (
    <div className="lock-illus shrink-0" aria-hidden>
      <svg viewBox="0 0 120 148" className="w-[4.75rem] h-auto md:w-28">
        <defs>
          <linearGradient id={body} x1="18%" y1="0%" x2="82%" y2="100%">
            <stop offset="0%" stopColor="#fff8dc" />
            <stop offset="24%" stopColor="#f3d78a" />
            <stop offset="58%" stopColor="#d4a017" />
            <stop offset="100%" stopColor="#7a560c" />
          </linearGradient>
          <linearGradient id={shackle} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fffdf6" />
            <stop offset="42%" stopColor="#e8c56a" />
            <stop offset="100%" stopColor="#a97812" />
          </linearGradient>
          <radialGradient id={glow} cx="50%" cy="46%" r="52%">
            <stop offset="0%" stopColor="#ffe08a" stopOpacity="0.55" />
            <stop offset="72%" stopColor="#ffe08a" stopOpacity="0" />
          </radialGradient>
          <filter id={shadow} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="7" stdDeviation="4.5" floodColor="#8a6410" floodOpacity="0.3" />
          </filter>
        </defs>

        <ellipse cx="60" cy="132" rx="34" ry="7" fill="#c9971a" opacity="0.16" />
        <circle className="lock-glow" cx="60" cy="78" r="50" fill={`url(#${glow})`} />

        <g className="shackle">
          <path
            d="M40 72 V48 a20 20 0 0 1 40 0 V72"
            fill="none"
            stroke={`url(#${shackle})`}
            strokeWidth="9"
            strokeLinecap="round"
          />
          <path
            d="M40 72 V48 a20 20 0 0 1 40 0 V72"
            fill="none"
            stroke="#fff8e4"
            strokeWidth="2.4"
            strokeLinecap="round"
            opacity="0.7"
          />
        </g>

        <g filter={`url(#${shadow})`}>
          <rect x="26" y="66" width="68" height="58" rx="15" fill={`url(#${body})`} />
          <path d="M30 80 h60" stroke="#fff6d4" strokeOpacity="0.45" strokeWidth="6" strokeLinecap="round" />
          <rect x="27" y="67" width="66" height="56" rx="14" fill="none" stroke="#fff6d2" strokeOpacity="0.7" strokeWidth="1.1" />
        </g>

        <circle cx="60" cy="90" r="5.5" fill="#5a3d08" />
        <path d="M57.4 93.5 h5.2 l-1.1 12.5 h-3 z" fill="#5a3d08" />
        <circle cx="58.3" cy="88.2" r="1.5" fill="#fff6d2" opacity="0.85" />
      </svg>
      <style>{`
        .lock-illus .shackle {
          transform-origin: 40px 72px;
          transform: rotate(-38deg);
          transition: transform 0.55s cubic-bezier(0.22, 1, 0.36, 1);
        }
        .group:hover .lock-illus .shackle {
          transform: rotate(0deg);
        }
        .lock-illus .lock-glow {
          opacity: 0.45;
          transition: opacity 0.55s ease;
        }
        .group:hover .lock-illus .lock-glow {
          opacity: 1;
        }
        @media (prefers-reduced-motion: reduce) {
          .lock-illus .shackle,
          .lock-illus .lock-glow { transition: none; }
        }
      `}</style>
    </div>
  );
}
