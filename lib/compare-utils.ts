import type { Confidence, ExtractedLine } from "./extraction-types";

const RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * Confidence in a line's price = the weakest confidence among the fields the price depends on
 * (price, currency, unit). null when there is no price.
 */
export function priceConfidence(line: ExtractedLine): Confidence | null {
  if (line.status !== "quoted" || line.normalized?.unitPriceINR == null || line.unitPrice.confidence === null) return null;
  const parts = [line.unitPrice.confidence, line.currency.confidence, line.unit.confidence].filter((c): c is Confidence => c !== null);
  return parts.reduce((a, b) => (RANK[b] < RANK[a] ? b : a));
}

export interface BestPrice {
  /** Indices (into the vendors array) of the lowest-priced eligible vendors; empty when there is no reliable winner. */
  winners: number[];
  price: number | null;
  /** A cheaper price exists but only with low confidence, so it was not allowed to win. */
  cheaperLowConfidence: boolean;
}

/** Lowest INR price among high/medium-confidence cells only. */
export function bestPrice(lines: (ExtractedLine | undefined)[]): BestPrice {
  const eligible: { i: number; price: number }[] = [];
  const lowConf: number[] = [];
  lines.forEach((l, i) => {
    const c = l ? priceConfidence(l) : null;
    const price = l?.normalized?.unitPriceINR;
    if (c === null || price == null) return;
    if (c === "low") lowConf.push(price);
    else eligible.push({ i, price });
  });
  if (!eligible.length) return { winners: [], price: null, cheaperLowConfidence: false };
  const min = Math.min(...eligible.map((e) => e.price));
  return {
    winners: eligible.filter((e) => e.price === min).map((e) => e.i),
    price: min,
    cheaperLowConfidence: lowConf.some((p) => p < min),
  };
}
