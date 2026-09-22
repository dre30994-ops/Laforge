import { useCallback, useEffect, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { getAddress, isAddress, type Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useChain } from "@/components/ChainProvider";
import { formatNative, readReferralDesk, STAKING_FACTORY_ABI } from "@/lib/factoryClient";
import { referralShareUrl } from "@/lib/referral";
import { useI18n } from "@/components/LanguageProvider";
import { shortAddress } from "@/lib/brand";

const ZERO = "0x0000000000000000000000000000000000000000";

export function ReferralCard({ lite = false }: { lite?: boolean } = {}) {
  const { t } = useI18n();
  const pathname = useRouter().state.location.pathname;
  const { network, family } = useChain();
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const [copied, setCopied] = useState(false);
  const [desk, setDesk] = useState<{ count: bigint; owed: bigint; parent: string } | null>(null);
  const [parentInput, setParentInput] = useState("");
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    if (!address || family !== "evm") {
      setDesk(null);
      return;
    }
    setDesk(await readReferralDesk(network, address));
  }, [address, family, network]);

  useEffect(() => {
    void load();
  }, [load]);

  if (family !== "evm") return null;

  const link =
    typeof window !== "undefined" && address && isAddress(address)
      ? referralShareUrl(window.location.origin, address)
      : "";
  const parent =
    desk?.parent && desk.parent.toLowerCase() !== ZERO ? desk.parent : "";

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  async function send(fn: "claimReferral" | "bindReferrer", args: readonly unknown[] = []) {
    if (!address || !network.factory || !isAddress(network.factory)) return;
    setStatus(fn === "claimReferral" ? t("referral.claiming") : t("referral.binding"));
    try {
      const walletClient = await getWalletClient(config, { chainId: network.chain.id });
      if (!walletClient) throw new Error("wallet");
      await walletClient.writeContract({
        account: walletClient.account,
        chain: network.chain,
        address: getAddress(network.factory) as Hex,
        abi: STAKING_FACTORY_ABI,
        functionName: fn,
        args: args as never,
      });
      setStatus("");
      setParentInput("");
      await load();
    } catch {
      setStatus("");
    }
  }

  return (
    <section className="glass p-6 animate-rise" data-testid="referral-card">
      {!lite && (
        <>
          <p className="label-term mb-2">{t("referral.title")}</p>
          <p className="text-sm text-mid leading-relaxed mb-2">{t("referral.blurb")}</p>
        </>
      )}
      {lite && <p className="label-term mb-3">{t("referral.title")}</p>}
      {pathname !== "/referral" && (
        <Link to="/referral" className="text-xs font-semibold text-gold-700 hover:text-gold-800 mb-4 inline-block">
          {t("referral.learn")}
        </Link>
      )}

      {!isConnected || !address ? (
        <p className="text-xs text-lo">{t("referral.connect")}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={link}
              className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-black/[0.03] border border-black/10 font-mono text-[11px] text-hi"
            />
            <button
              type="button"
              onClick={() => void copyLink()}
              className="h-10 px-3 rounded-lg text-xs font-semibold border border-black/10 hover:border-gold-400/50"
            >
              {copied ? t("referral.copied") : t("referral.copy")}
            </button>
          </div>

          {!lite && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-mid">{t("referral.count", { n: desk ? desk.count.toString() : "—" })}</p>
              <p className="text-xs text-mid">
                {t("referral.owed")}:{" "}
                <span className="font-semibold text-hi">
                  {desk ? formatNative(desk.owed, network.nativeSymbol) : "—"}
                </span>
              </p>
              <button
                type="button"
                disabled={!desk || desk.owed === 0n}
                onClick={() => void send("claimReferral")}
                className="h-9 px-3 rounded-lg text-xs font-semibold text-white disabled:opacity-40"
                style={{ background: "linear-gradient(180deg, #22c55e, #16a34a)" }}
              >
                {status === t("referral.claiming") ? status : t("referral.claim")}
              </button>
            </div>
          )}

          {parent ? (
            <p className="text-xs text-mid">
              {t("referral.upline")}: <span className="font-mono text-hi">{shortAddress(parent)}</span>
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={parentInput}
                onChange={(e) => setParentInput(e.target.value)}
                placeholder={t("referral.uplinePh")}
                className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-black/[0.03] border border-black/10 font-mono text-[11px] text-hi"
              />
              <button
                type="button"
                disabled={!isAddress(parentInput)}
                onClick={() => void send("bindReferrer", [getAddress(parentInput)])}
                className="h-10 px-3 rounded-lg text-xs font-semibold border border-black/10 disabled:opacity-40"
              >
                {status === t("referral.binding") ? status : t("referral.bind")}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
