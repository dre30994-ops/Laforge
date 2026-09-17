import { useEffect, useState } from "react";
import { fetchTokenQuote, formatUsdPrice, quoteLabel, type TokenQuote } from "@/lib/tokenQuote";

export function TokenPriceChip({
  chainId,
  token,
  className,
}: {
  chainId: number;
  token: string;
  className?: string;
}) {
  const [quote, setQuote] = useState<TokenQuote | null>(null);

  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(() => {
      void fetchTokenQuote(chainId, token).then((q) => {
        if (!cancelled) setQuote(q);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [chainId, token]);

  if (!quote) return null;

  return (
    <span
      className={
        className ??
        "rounded-full px-2 py-0.5 text-[10px] font-semibold border border-black/10 text-hi bg-black/[0.03]"
      }
      title={quoteLabel(quote)}
      data-testid="token-price-chip"
    >
      {formatUsdPrice(quote.priceUsd)}
      {quote.quality === "thin" ? " · pad" : ""}
    </span>
  );
}

export function useTokenQuote(chainId?: number, token?: string): TokenQuote | null {
  const [quote, setQuote] = useState<TokenQuote | null>(null);
  useEffect(() => {
    if (!chainId || !token) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void fetchTokenQuote(chainId, token).then((q) => {
        if (!cancelled) setQuote(q);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [chainId, token]);
  return quote;
}
