import { Link } from "@tanstack/react-router";
import { TerminalShell } from "@/components/TerminalShell";

const FAQS: { q: string; a: string }[] = [
  {
    q: "My wallet won’t connect",
    a: "Use an injected EVM wallet (MetaMask, Rabby, Coinbase Wallet). Click Connect Wallet in the sidebar, approve the prompt, and refresh if the wallet extension was installed after this tab opened.",
  },
  {
    q: "I’m on the wrong network",
    a: "Open Switch Network and pick Robinhood or Ethereum. Your wallet will ask you to switch. Pools are created on the chain that’s selected — you cannot pay one chain’s fee from another.",
  },
  {
    q: "The token or treasury address is rejected",
    a: "Paste a 0x address with 40 hex characters. Solana-style addresses will not work here. A checksum warning is safe to read; a red error means the address is not valid on the selected chain.",
  },
  {
    q: "I left treasury blank",
    a: "That’s allowed, but you will not receive any stake or unstake tax. Tax fields stay locked at 0% until a valid treasury is set. The treasury is where those taxes are sent.",
  },
  {
    q: "I can’t set a long duration on Bronze",
    a: "Bronze is capped at 2 days. Typing a larger number snaps down to 2. Ecosystem and Marketing go up to 30 days and also snap down if you type more.",
  },
  {
    q: "My pool image was rejected",
    a: "Use PNG, JPEG, WebP, or GIF — no SVG. The file must be under 15 MB and at least 1000×1000 pixels. Banners follow the same rules and only apply to Ecosystem and Marketing.",
  },
  {
    q: "I can’t find my pool",
    a: "Use the contract-address search at the top of the dashboard. Paste the pool or token 0x address. You can also open Pools and filter by the chain badge.",
  },
  {
    q: "Can I add Marketing after I already launched?",
    a: "Yes. Anyone can open the pool page and pay the Marketing fee (0.06 ETH on Robinhood / Ethereum, or that chain’s equivalent). That is a boost, not a stake — it does not deposit tokens. It unlocks banner and socials for the operator and a 12-hour trending slot. Pay again to extend trending. Only the operator can edit branding or the verified badge.",
  },
  {
    q: "Social links or the banner don’t show",
    a: "Those render on Ecosystem and Marketing pools, including pools that unlocked Marketing after launch. Links must be http or https. Marketing also gets a 12-hour trending slot on the directory.",
  },
  {
    q: "The create transaction failed",
    a: "Confirm you are on the same chain as the selected network, that the launch fee is in that chain’s native token, and that you approved the factory to spend the funding tokens.",
  },
];

export default function FaqsPage() {
  return (
    <TerminalShell>
        <main className="flex-1 min-w-0 px-4 md:px-6 lg:px-8 py-6">
          <div className="max-w-[880px] mx-auto space-y-6">
            <header className="animate-rise">
              <Link to="/dashboard" className="label-term hover:text-gold-neon transition-colors">
                ← Back to dashboard
              </Link>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-hi mt-3">
                FAQs
              </h1>
              <p className="text-mid mt-2 leading-relaxed">
                Short troubleshooting for wallets, addresses, taxes, and pool creation.
              </p>
            </header>

            <div className="space-y-3">
              {FAQS.map((item) => (
                <section key={item.q} className="glass p-5 animate-rise">
                  <h2 className="text-sm font-semibold text-hi">{item.q}</h2>
                  <p className="text-sm text-mid mt-2 leading-relaxed">{item.a}</p>
                </section>
              ))}
            </div>
          </div>
        </main>
    </TerminalShell>
  );
}
