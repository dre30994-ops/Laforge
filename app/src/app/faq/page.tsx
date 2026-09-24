"use client";

import Link from "next/link";
import { Sidebar } from "@/components/Sidebar";

/**
 * FAQ / troubleshooting page. Grounded in Forge's real, sometimes
 * counter-intuitive behavior (hourly reward checkpoints, min-stake gating,
 * the permissionless crank, USD price fallbacks, the exit tax, etc.) so
 * users can self-serve the issues that actually come up in the live flow.
 *
 * Grouped into sections; each item is a native <details> accordion so no
 * client state is needed and it stays keyboard/screen-reader friendly.
 */

type Faq = { q: string; a: React.ReactNode };
type FaqGroup = { title: string; items: Faq[] };

const GROUPS: FaqGroup[] = [
  {
    title: "Rewards & claiming",
    items: [
      {
        q: "I clicked Claim and signed, but no tokens arrived. Why?",
        a: (
          <>
            Rewards settle at <strong>hourly checkpoints</strong>, not
            continuously. The live “Pending (est.)” figure is a projection that
            ticks up every second, but the amount actually claimable only
            advances once the pool crosses an hourly boundary. If you claim
            before the first checkpoint since your deposit, the transaction
            succeeds but has nothing to transfer. Wait for the “Claimable now”
            state on the Claim tab — it shows a countdown to the next checkpoint —
            then claim.
          </>
        ),
      },
      {
        q: "The Claim button is greyed out.",
        a: (
          <>
            The button only enables when a claim will actually pay out — i.e.
            there’s settled reward on-chain, or an hourly checkpoint has passed
            since the last update. If it’s disabled, the Claim tab will show
            “Projected (not yet claimable)” with a countdown to when it unlocks.
          </>
        ),
      },
      {
        q: "What does “Sync rewards” do?",
        a: (
          <>
            It <em>cranks</em> the pool — a permissionless call that advances the
            pool’s emissions across any hourly boundaries that have passed, so
            pending rewards move from the projection into the settled on-chain
            balance. You only pay gas. Claiming already cranks for you when
            needed, so you rarely need this button directly.
          </>
        ),
      },
      {
        q: "My “Pending (est.)” looks higher than what I actually claimed.",
        a: (
          <>
            The estimate projects continuously to the current second; the
            settled amount only counts fully-elapsed hourly checkpoints. They
            converge right after each checkpoint. The “settled on-chain” line
            under the claimable figure always shows the real, claimable-right-now
            number.
          </>
        ),
      },
      {
        q: "Can I claim automatically?",
        a: (
          <>
            Yes — toggle <strong>Auto-claim</strong> on the Claim tab. Because the
            contract can’t push tokens to you, each auto-claim still needs a
            wallet signature and gas; it just prompts you periodically instead of
            you watching the checkpoint clock.
          </>
        ),
      },
    ],
  },
  {
    title: "Staking & unstaking",
    items: [
      {
        q: "My stake transaction was rejected or won’t go through.",
        a: (
          <>
            Common causes: (1) the amount is below the pool’s{" "}
            <strong>minimum stake</strong> — the input shows the minimum and
            flags amounts under it; (2) you haven’t approved the token yet — the
            first stake sends an ERC-20 approval before the stake itself, so
            you’ll see two prompts; (3) the pool needed a crank first — the app
            cranks automatically when the pool is stale before staking.
          </>
        ),
      },
      {
        q: "Why is there a tax when I unstake?",
        a: (
          <>
            Unstaking applies an <strong>exit tax</strong> (shown as a percentage
            on the Unstake tab) and resets your tenure multiplier back to 1.00x.
            The longer you stay staked, the higher your tenure multiplier grows
            (up to the cap), so unstaking early forfeits that boost.
          </>
        ),
      },
      {
        q: "What is the “tenure multiplier”?",
        a: (
          <>
            A bonus that grows the longer your stake stays in the pool, ramping
            from 1.00x up to a 2.00x cap over the tenure ramp window. It
            increases your share of emissions. Unstaking resets it to 1.00x.
          </>
        ),
      },
    ],
  },
  {
    title: "Wallet & network",
    items: [
      {
        q: "My wallet won’t connect.",
        a: (
          <>
            Use the wallet button (bottom of the sidebar) to open the picker and
            choose your wallet. For the EVM (Robinhood) chain, make sure your
            wallet is unlocked and set to the correct network. If a connector
            doesn’t appear, refresh the page so the extension re-injects.
          </>
        ),
      },
      {
        q: "How do I switch between chains?",
        a: (
          <>
            Use the <strong>chain toggle</strong> in the sidebar to flip between
            Solana and the Robinhood (EVM) chain. Pools and balances shown are
            specific to the selected chain.
          </>
        ),
      },
      {
        q: "A transaction is stuck on “Confirming…”.",
        a: (
          <>
            The app is waiting for the transaction receipt. Give it a few blocks;
            if your wallet shows the tx as dropped or replaced, close the prompt
            and retry. Avoid submitting the same action twice while one is still
            confirming.
          </>
        ),
      },
    ],
  },
  {
    title: "Pool info & pricing",
    items: [
      {
        q: "Pool value (USD) shows “—”. Is something broken?",
        a: (
          <>
            No — “—” just means no USD price source is configured or available
            for that token yet. The resolver tries Chainlink first, then
            Uniswap V4/V3/V2 pools. On testnet these feeds are intentionally
            disabled, so “—” is expected there.
          </>
        ),
      },
      {
        q: "What is the “Undistributed” figure on a pool?",
        a: (
          <>
            Tokens the pool has been funded with that haven’t been emitted yet,
            minus rewards already emitted but not yet claimed. It reflects
            what’s left to distribute over the remaining program.
          </>
        ),
      },
      {
        q: "What is the Marketing Add-on?",
        a: (
          <>
            An optional paid boost for pool creators that features the pool in the
            trending carousel for a limited window. It’s purchased from the pool
            detail page and paid in the chain’s native token.
          </>
        ),
      },
    ],
  },
];

export default function FaqPage() {
  return (
    <div className="terminal-root terminal-grid">
      <div className="relative z-[1] flex min-h-screen">
        {/* Sidebar */}
        <div className="hidden lg:block w-[248px] shrink-0 p-4 sticky top-0 h-screen">
          <Sidebar />
        </div>

        {/* FAQ feed */}
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[880px] mx-auto space-y-6">
            {/* Header */}
            <header className="animate-rise">
              <Link href="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                ← Back to dashboard
              </Link>
              <div className="mt-3">
                <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi">
                  FAQ &amp; Troubleshooting
                </h1>
                <p className="text-mid mt-2 leading-relaxed">
                  Quick answers to the issues that come up most often when staking,
                  claiming, and managing pools on Forge.
                </p>
              </div>
            </header>

            {/* Groups */}
            {GROUPS.map((group) => (
              <section key={group.title} className="glass p-6 animate-rise">
                <h2 className="text-lg font-semibold tracking-tight text-hi mb-3">
                  {group.title}
                </h2>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <details
                      key={item.q}
                      className="group rounded-xl border border-black/[0.06] bg-black/[0.02]
                                 px-4 py-3 open:bg-black/[0.03] transition-colors"
                    >
                      <summary
                        className="flex items-center justify-between gap-3 cursor-pointer
                                   list-none text-sm font-medium text-hi select-none"
                      >
                        <span>{item.q}</span>
                        <svg
                          viewBox="0 0 24 24"
                          className="w-4 h-4 shrink-0 text-mid transition-transform
                                     group-open:rotate-180"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </summary>
                      <p className="text-sm text-mid mt-2.5 leading-relaxed">
                        {item.a}
                      </p>
                    </details>
                  ))}
                </div>
              </section>
            ))}

            {/* Still stuck */}
            <section className="glass p-6 animate-rise text-center">
              <h2 className="text-base font-semibold tracking-tight text-hi">
                Still stuck?
              </h2>
              <p className="text-sm text-mid mt-1.5 leading-relaxed">
                Check the{" "}
                <Link href="/docs" className="text-gold-neon hover:underline">
                  Docs
                </Link>{" "}
                for deeper detail, or review your recent activity on the{" "}
                <Link href="/history" className="text-gold-neon hover:underline">
                  History
                </Link>{" "}
                page to confirm what actually landed on-chain.
              </p>
            </section>

            <footer className="pt-2 pb-4 text-center">
              <p className="label-term !tracking-normal !normal-case text-lo">
                Answers reflect current on-chain behavior and may change as the
                protocol evolves.
              </p>
            </footer>
          </div>
        </main>
      </div>
    </div>
  );
}
