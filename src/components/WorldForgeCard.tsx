import { useMemo } from "react";
import { useI18n } from "@/components/LanguageProvider";
import { LAND } from "@/lib/land";

/** Multichain intro. The globe turns on its axis and holds still on hover. */
export function WorldForgeCard() {
  const { t } = useI18n();
  return (
    <section className="glass p-6 md:p-8 animate-rise group" data-testid="world-forge">
      <div className="flex items-center gap-6 md:gap-10">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl md:text-4xl font-semibold tracking-tight hero-title-gold">
            {t("dash.worldTitle")}
          </h2>
          <p className="mt-3 text-sm md:text-base text-mid leading-relaxed max-w-2xl">
            {t("dash.worldBody")}
          </p>
        </div>
        <Globe />
      </div>
    </section>
  );
}

function coastPath(): string {
  let d = "";
  for (const ring of LAND) {
    let drawing = false;
    let prevLon = 0;
    for (let i = 0; i < ring.length; i += 2) {
      const lon = ring[i];
      const lat = ring[i + 1];
      const jump = drawing && Math.abs(lon - prevLon) > 35;
      prevLon = lon;
      const x = (lon + 180).toFixed(2);
      const y = (90 - lat).toFixed(2);
      if (!drawing || jump) {
        d += `M${x} ${y}`;
        drawing = true;
      } else {
        d += `L${x} ${y}`;
      }
    }
  }
  return d;
}

/** First globe: a map sliding across a round window. Coastlines are real. */
function Globe() {
  const d = useMemo(coastPath, []);
  return (
    <div className="world-globe shrink-0" aria-hidden>
      <div className="world-globe-spin">
        <Coast d={d} />
        <Coast d={d} />
      </div>
      <span className="world-shine" />
      <style>{`
        .world-globe {
          position: relative;
          width: 112px;
          height: 112px;
          flex: 0 0 112px;
          border-radius: 50%;
          overflow: hidden;
          background: #050505;
          box-shadow:
            inset -16px -8px 22px rgba(0, 0, 0, 0.65),
            inset 6px 4px 12px rgba(255, 244, 210, 0.08),
            0 0 0 1px rgba(212, 160, 23, 0.55),
            0 12px 28px rgba(0, 0, 0, 0.28);
        }
        .world-globe-spin {
          position: absolute;
          top: 0;
          left: 0;
          display: flex;
          width: 448px;
          height: 112px;
          animation: world-spin 22s linear infinite;
        }
        .group:hover .world-globe-spin { animation-play-state: paused; }
        .world-map { width: 224px; height: 112px; flex: none; display: block; }
        .world-shine {
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: radial-gradient(circle at 30% 28%, rgba(255, 248, 220, 0.16), transparent 36%);
          pointer-events: none;
        }
        @keyframes world-spin {
          from { transform: translateX(0); }
          to { transform: translateX(-224px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .world-globe-spin { animation: none; }
        }
      `}</style>
    </div>
  );
}

function Coast({ d }: { d: string }) {
  return (
    <svg className="world-map" viewBox="0 0 360 180">
      <path d={d} fill="none" stroke="#e8c56a" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
