"use client";

import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";

/** A single roadmap milestone. */
type Checkpoint = {
  n: number;
  title: string;
  blurb: string;
  status: "done" | "active" | "upcoming";
  /** Emoji/short label placeholder until final artwork is dropped in. */
  icon: string;
};

/**
 * Product roadmap for Laforge. Six sequential checkpoints from token launch
 * through the public release of Laforge World. Status drives the visual state
 * of each node — completed, in-progress, or upcoming.
 */
const CHECKPOINTS: Checkpoint[] = [
  {
    n: 1,
    title: "Deploy Laforge native token",
    icon: "/icon2_nobg.png",
    blurb:
      "Mint and launch the Laforge native token — the reward asset that powers every staking pool.",
    status: "done",
  },
  {
    n: 2,
    title: "Robinhood EVM staking",
    icon: "/roadmap/Robinhood--Streamline-Simple-Icons.svg",
    blurb:
      "Ship the EVM staking path so holders can stake on the Robinhood (EVM) chain.",
    status: "done",
  },
  {
    n: 3,
    title: "Solana program deployment",
    icon: "/roadmap/Solana--Streamline-Simple-Icons.svg",
    blurb:
      "Deploy the on-chain staking program to Solana, bringing the pool mechanics to a second chain.",
    status: "upcoming",
  },
  {
    n: 4,
    title: "Laforge World play test",
    icon: "🎮",
    blurb:
      "Open an internal play test of Laforge World to validate core gameplay and integrations.",
    status: "upcoming",
  },
  {
    n: 5,
    title: "Laforge World beta test",
    icon: "🧪",
    blurb:
      "Expand to a public beta — wider access, load testing, and community feedback before launch.",
    status: "upcoming",
  },
  {
    n: 6,
    title: "Laforge World goes live",
    icon: "🚀",
    blurb:
      "Full public launch of Laforge World for everyone.",
    status: "upcoming",
  },
];

export default function RoadmapPage() {
  const doneCount = CHECKPOINTS.filter((c) => c.status === "done").length;

  return (
    <div className="terminal-root terminal-grid">
      <div className="relative z-[1] flex min-h-screen">
        {/* Sidebar */}
        <div className="hidden lg:block w-[248px] shrink-0 p-4 sticky top-0 h-screen">
          <Sidebar />
        </div>

        {/* Roadmap feed */}
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[880px] mx-auto space-y-6">
            {/* Header */}
            <header className="animate-rise">
              <Link href="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                ← Back to dashboard
              </Link>
              <div className="flex items-end justify-between flex-wrap gap-3 mt-3">
                <div>
                  <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi">
                    Roadmap
                  </h1>
                  <p className="text-mid mt-2 leading-relaxed">
                    The path from token launch to Laforge World going live — six checkpoints,
                    shipped in order.
                  </p>
                </div>
                <div className="glass !rounded-xl px-4 py-2.5 text-center">
                  <div className="label-term !text-[9px]">Progress</div>
                  <div className="mono text-sm text-[#22c55e]">
                    {doneCount} / {CHECKPOINTS.length}
                  </div>
                </div>
              </div>
            </header>

            {/* Timeline */}
            <section className="glass p-6 animate-rise">
              <ol className="relative">
                {CHECKPOINTS.map((c, i) => (
                  <CheckpointRow key={c.n} c={c} last={i === CHECKPOINTS.length - 1} />
                ))}
              </ol>
            </section>

            <footer className="pt-2 pb-4 text-center">
              <p className="label-term !tracking-normal !normal-case text-lo">
                Roadmap items are directional and may shift as development progresses.
              </p>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}

/* ── Presentational helpers ── */

function CheckpointRow({ c, last }: { c: Checkpoint; last: boolean }) {
  const done = c.status === "done";
  const active = c.status === "active";

  // Node + connector colors keyed off status. Completed and active checkpoints
  // are highlighted green; upcoming ones stay muted.
  const nodeBorder = done || active ? "#22c55e" : "var(--hairline)";
  const nodeBg = done ? "#22c55e" : "rgba(20,18,10,0.02)";
  const numberColor = done ? "#0a0c0f" : active ? "#22c55e" : "var(--mid)";
  const titleColor = done || active ? "text-[#22c55e]" : "text-hi";

  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      {/* Connector line (skipped on the last item) */}
      {!last && (
        <span
          aria-hidden
          className="absolute left-[15px] top-8 bottom-0 w-px"
          style={{ background: done ? "#22c55e" : "var(--hairline)" }}
        />
      )}

      {/* Node */}
      <span
        className="relative z-[1] grid place-items-center w-8 h-8 rounded-full shrink-0 mono text-xs font-bold"
        style={{
          border: `1.5px solid ${nodeBorder}`,
          background: nodeBg,
          color: numberColor,
        }}
      >
        {done ? <CheckIcon /> : c.n}
      </span>

      {/* Content */}
      <div className="min-w-0 pt-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Icon placeholder — swap the emoji for final artwork later.
              Paths (starting with "/") render as an image; anything else
              is treated as an emoji/text glyph. */}
          <span
            className="grid place-items-center w-7 h-7 rounded-lg shrink-0 overflow-hidden text-sm"
            style={{
              background: "rgba(20,18,10,0.03)",
              border: "1px solid var(--hairline)",
            }}
            aria-hidden
          >
            {c.icon.startsWith("/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.icon} alt="" className="w-[18px] h-[18px] object-contain" />
            ) : (
              c.icon
            )}
          </span>
          <h3 className={`text-base font-semibold tracking-tight ${titleColor}`}>{c.title}</h3>
          <StatusPill status={c.status} />
        </div>
        <p className="text-sm text-mid mt-1.5 leading-relaxed">{c.blurb}</p>
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: Checkpoint["status"] }) {
  const map = {
    done: { label: "Complete", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
    active: { label: "In progress", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
    upcoming: { label: "Upcoming", color: "var(--mid)", bg: "rgba(20,18,10,0.04)" },
  } as const;
  const s = map[status];
  return (
    <span
      className="mono text-[9px] uppercase tracking-wide px-2 py-0.5 rounded-full"
      style={{ color: s.color, background: s.bg, border: `1px solid ${s.color === "var(--mid)" ? "var(--hairline)" : "rgba(34,197,94,0.3)"}` }}
    >
      {s.label}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}
