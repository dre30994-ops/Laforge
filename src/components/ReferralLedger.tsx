import { useCallback, useEffect, useState } from "react";
import { getAddress, isAddress, type Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useChain } from "@/components/ChainProvider";
import {
  formatNative,
  readReferralDesk,
  STAKING_FACTORY_ABI,
  REF_STEP_CAP,
  type ReferralDesk,
} from "@/lib/factoryClient";
import { fetchEthSolRate, formatSol, weiEthToSol, type EthSolRate } from "@/lib/ethSolRate";
import { shortAddress } from "@/lib/brand";
import { useI18n } from "@/components/LanguageProvider";

type Unit = "ETH" | "SOL";
const UNIT_KEY = "laforge.ref.unit";

function readUnit(): Unit {
  if (typeof window === "undefined") return "ETH";
  try {
    const raw = window.localStorage.getItem(UNIT_KEY);
    if (raw === "ETH" || raw === "SOL") return raw;
  } catch {
    /* ignore */
  }
  return "ETH";
}

export function ReferralLedger() {
  const { t } = useI18n();
  const { network, family } = useChain();
  const { address, isConnected } = useAccount();
  const config = useConfig();
  const [desk, setDesk] = useState<ReferralDesk | null>(null);
  const [status, setStatus] = useState("");
  const [unit, setUnit] = useState<Unit>("ETH");
  const [rate, setRate] = useState<EthSolRate | null>(null);

  useEffect(() => {
    setUnit(readUnit());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchEthSolRate().then((r) => {
      if (!cancelled && r) setRate(r);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  function pick(next: Unit) {
    setUnit(next);
    try {
      window.localStorage.setItem(UNIT_KEY, next);
    } catch {
      /* ignore */
    }
  }

  function money(wei: bigint): string {
    if (unit === "SOL") {
      if (!rate) return "—";
      return formatSol(weiEthToSol(wei, rate.solPerEth));
    }
    return formatNative(wei, "ETH");
  }

  async function claim() {
    if (!address || !network.factory || !isAddress(network.factory) || !desk || desk.owed === 0n) {
      return;
    }
    setStatus(t("referral.claiming"));
    try {
      const walletClient = await getWalletClient(config, { chainId: network.chain.id });
      if (!walletClient) throw new Error("wallet");
      await walletClient.writeContract({
        account: walletClient.account,
        chain: network.chain,
        address: getAddress(network.factory) as Hex,
        abi: STAKING_FACTORY_ABI,
        functionName: "claimReferral",
      });
      setStatus("");
      await load();
    } catch {
      setStatus("");
    }
  }

  const count = desk ? Number(desk.count) : 0;
  const cap = REF_STEP_CAP;
  const filled = Math.min(100, Math.round((count / cap) * 100));
  const splitPct = desk ? (desk.splitBps / 100).toFixed(desk.splitBps % 100 === 0 ? 0 : 1) : "10";

  return (
    <section className="space-y-4 animate-rise" data-testid="referral-ledger">
      <div className="glass glass-gold p-5 md:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <p className="label-term">{t("refPage.totalLabel")}</p>
          <div
            className="inline-flex rounded-lg border border-black/10 p-0.5"
            role="group"
            aria-label={t("refPage.unitLabel")}
          >
            {(["ETH", "SOL"] as const).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => pick(u)}
                aria-pressed={unit === u}
                className={`h-8 min-w-12 px-3 rounded-md text-xs font-semibold tracking-wide ${
                  unit === u ? "bg-gold-400 text-gold-950" : "text-mid hover:text-hi"
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="mt-0 font-mono text-3xl md:text-4xl font-semibold tracking-tight text-hi">
              {!isConnected ? "—" : money(desk?.lifetime ?? 0n)}
            </p>
            <p className="mt-1 text-xs text-mid">
              {t("refPage.unclaimed")}:{" "}
              <span className="font-semibold text-hi">
                {!isConnected ? "—" : money(desk?.owed ?? 0n)}
              </span>
            </p>
          </div>

          <div className="flex-1 min-w-0 md:max-w-sm">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="label-term">{t("refPage.progressLabel")}</p>
              <p className="font-mono text-xs text-mid">
                {t("refPage.progressCount", { n: isConnected ? count : 0, cap })}
              </p>
            </div>
            <div
              className="h-2.5 rounded-full bg-black/[0.08] overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={cap}
              aria-valuenow={isConnected ? count : 0}
            >
              <div
                className="h-full rounded-full bg-gold-400 transition-[width] duration-300"
                style={{ width: `${isConnected ? filled : 0}%` }}
              />
            </div>
            <p className="mt-3 text-sm text-mid">
              {t("refPage.splitNow")}{" "}
              <span className="font-mono font-semibold text-hi">{isConnected ? `${splitPct}%` : "—"}</span>
            </p>
          </div>

          <button
            type="button"
            disabled={!isConnected || !desk || desk.owed === 0n}
            onClick={() => void claim()}
            className="h-11 px-5 rounded-xl text-sm font-semibold text-white shrink-0 disabled:opacity-40"
            style={{ background: "linear-gradient(180deg, #22c55e, #16a34a)" }}
          >
            {status || t("referral.claim")}
          </button>
        </div>
      </div>

      <div className="glass overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-black/[0.06]">
          <p className="label-term">{t("refPage.listLabel")}</p>
          <p className="text-[11px] text-lo">{t("refPage.listHint")}</p>
        </div>
        {!isConnected ? (
          <p className="px-5 py-8 text-sm text-mid">{t("referral.connect")}</p>
        ) : !desk || desk.rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-mid">{t("refPage.listEmpty")}</p>
        ) : (
          <ul className="max-h-80 overflow-y-auto divide-y divide-black/[0.06]">
            {desk.rows.map((row) => (
              <li key={row.address} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-hi">{shortAddress(row.address)}</span>
                  <span className="font-mono text-mid">{money(row.earned)}</span>
                </div>
                {row.hop2.length > 0 && (
                  <ul className="mt-2 space-y-1.5 border-l border-black/10 ml-2 pl-3">
                    {row.hop2.map((hop) => (
                      <li key={hop.address} className="flex items-center justify-between gap-3 text-xs">
                        <span className="min-w-0">
                          <span className="label-term !text-[9px] text-gold-700">{t("refPage.hop2row")}</span>
                          <span className="font-mono text-mid ml-2">{shortAddress(hop.address)}</span>
                        </span>
                        <span className="font-mono text-mid shrink-0">{money(hop.earned)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
