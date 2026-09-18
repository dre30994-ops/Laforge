import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";
import { EthereumMark, GoldQuestionMark, RobinhoodFeather, SolanaMark } from "@/components/BrandMarks";
import { useI18n } from "@/components/LanguageProvider";

/** A single roadmap milestone. */
type Checkpoint = {
  n: number;
  title: string;
  blurb: string;
  status: "done" | "active" | "upcoming";
  icon:
    | "laforge"
    | "robinhood"
    | "ethereum"
    | "question"
    | "solana"
    | "play"
    | "beta"
    | "live";
};

const CHECKPOINTS: Checkpoint[] = [
  {
    n: 1,
    title: "Deploy Laforge native token",
    icon: "laforge",
    blurb:
      "Mint and launch the Laforge native token — the reward asset that powers every staking pool.",
    status: "done",
  },
  {
    n: 2,
    title: "Robinhood EVM staking",
    icon: "robinhood",
    blurb:
      "Ship the EVM staking path so holders can stake on the Robinhood (EVM) chain.",
    status: "done",
  },
  {
    n: 3,
    title: "Ethereum ERC-20 Staking",
    icon: "ethereum",
    blurb: "Same factory, same math — ERC-20 pools live on Ethereum mainnet.",
    status: "done",
  },
  {
    n: 4,
    title: "Coming soon",
    icon: "question",
    blurb: "Announcement incoming",
    status: "upcoming",
  },
  {
    n: 5,
    title: "Coming soon",
    icon: "question",
    blurb: "Announcement incoming",
    status: "upcoming",
  },
  {
    n: 6,
    title: "Solana program deployment",
    icon: "solana",
    blurb:
      "Deploy the on-chain staking program to Solana, bringing the pool mechanics to a second chain.",
    status: "upcoming",
  },
  {
    n: 7,
    title: "Coming soon",
    icon: "question",
    blurb: "Announcement incoming",
    status: "upcoming",
  },
  {
    n: 8,
    title: "Laforge World play test",
    icon: "play",
    blurb:
      "Open an internal play test of Laforge World to validate core gameplay and integrations.",
    status: "upcoming",
  },
  {
    n: 9,
    title: "Laforge World beta test",
    icon: "beta",
    blurb:
      "Expand to a public beta — wider access, load testing, and community feedback before launch.",
    status: "upcoming",
  },
  {
    n: 10,
    title: "Laforge World goes live",
    icon: "live",
    blurb: "Full public launch of Laforge World for everyone.",
    status: "upcoming",
  },
];

function CheckpointIcon({ kind }: { kind: Checkpoint["icon"] }) {
  if (kind === "laforge") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/icon2_nobg.png" alt="" className="w-[18px] h-[18px] object-contain" />
    );
  }
  if (kind === "robinhood") {
    return <RobinhoodFeather size={22} />;
  }
  if (kind === "ethereum") return <EthereumMark size={22} />;
  if (kind === "question") return <GoldQuestionMark size={18} />;
  if (kind === "solana") {
    return <SolanaMark size={22} />;
  }
  if (kind === "play") return <>🎮</>;
  if (kind === "beta") return <>🧪</>;
  return <>🚀</>;
}

export default function RoadmapPage() {
  const { t, tList } = useI18n();
  const copy = tList<{ title: string; blurb: string }>("roadmap.items");
  const doneCount = CHECKPOINTS.filter((c) => c.status === "done").length;

  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[880px] mx-auto space-y-6">
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                {t("common.back")}
              </Link>
              <div className="flex items-end justify-between flex-wrap gap-3 mt-3">
                <div>
                  <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi">
                    {t("roadmap.title")}
                  </h1>
                  <p className="text-mid mt-2 leading-relaxed">
                    {t("roadmap.intro")}
                  </p>
                </div>
                <div className="glass !rounded-xl px-4 py-2.5 text-center">
                  <div className="label-term !text-[9px]">{t("roadmap.progress")}</div>
                  <div className="mono text-sm text-[#22c55e]">
                    {doneCount} / {CHECKPOINTS.length}
                  </div>
                </div>
              </div>
            </header>

            <section className="glass p-6 animate-rise">
              <ol className="relative">
                {CHECKPOINTS.map((c, i) => (
                  <CheckpointRow
                    key={c.n}
                    c={{ ...c, title: copy[i]?.title ?? c.title, blurb: copy[i]?.blurb ?? c.blurb }}
                    last={i === CHECKPOINTS.length - 1}
                  />
                ))}
              </ol>
            </section>

            <footer className="pt-2 pb-4 text-center">
              <p className="label-term !tracking-normal !normal-case text-lo">
                {t("roadmap.disclaimer")}
              </p>
            </footer>
          </div>
        </main>
    </TerminalShell>
  );
}

function CheckpointRow({ c, last }: { c: Checkpoint; last: boolean }) {
  const done = c.status === "done";
  const active = c.status === "active";

  const nodeBorder = done || active ? "#22c55e" : "var(--hairline)";
  const nodeBg = done ? "#22c55e" : "rgba(20,18,10,0.02)";
  const numberColor = done ? "#0a0c0f" : active ? "#22c55e" : "var(--mid)";
  const titleColor = done || active ? "text-[#22c55e]" : "text-hi";

  return (
    <li className="relative flex gap-4 pb-8 last:pb-0">
      {!last && (
        <span
          aria-hidden
          className="absolute left-[15px] top-8 bottom-0 w-px"
          style={{ background: done ? "#22c55e" : "var(--hairline)" }}
        />
      )}

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

      <div className="min-w-0 pt-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="grid place-items-center w-8 h-8 rounded-lg shrink-0 overflow-hidden text-sm"
            style={{
              background: "rgba(20,18,10,0.03)",
              border: "1px solid var(--hairline)",
            }}
            aria-hidden
          >
            {c.icon && <CheckpointIcon kind={c.icon} />}
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
  const { t } = useI18n();
  const map = {
    done: { label: t("roadmap.done"), color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
    active: { label: t("roadmap.active"), color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
    upcoming: { label: t("roadmap.upcoming"), color: "var(--mid)", bg: "rgba(20,18,10,0.04)" },
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
