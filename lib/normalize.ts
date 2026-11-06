import { BASE_CURRENCY } from "./config";
import type { NormalizationStep, NormalizedPrice } from "./extraction-types";

export interface NormalizeInput {
  amount: number;
  currency: string;
  /** Pricing unit as the vendor wrote it, e.g. "per box of 100". */
  unitText: string | null;
  unitsPerPricedUnit: number | null;
  fxRatesToINR: Record<string, number>;
  /** Whole-quote discount percentages to apply (e.g. [5]). */
  discountPercents: number[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

/**
 * Converts a quoted price to INR per unit. Order: divide by pack size, convert currency, apply discount.
 * Every assumption (pack size, FX rate, discount) is returned alongside the number.
 */
export function normalizePrice(input: NormalizeInput): NormalizedPrice {
  const currency = input.currency.trim().toUpperCase();
  const steps: NormalizationStep[] = [];
  const assumptions: string[] = [];
  let value = input.amount;

  const packAssumed = !(input.unitsPerPricedUnit && input.unitsPerPricedUnit > 0);
  const pack = packAssumed ? 1 : (input.unitsPerPricedUnit as number);
  if (packAssumed) assumptions.push("No pack size found in the document; assumed the price is per single unit (pack size 1).");
  if (pack !== 1) {
    const next = value / pack;
    steps.push({
      step: "pack_size",
      description: `${fmt(value)} ${currency} (${input.unitText ?? `pack of ${pack}`}) / ${pack} units per pack`,
      input: value,
      output: next,
    });
    assumptions.push(`Priced per pack of ${pack} units (from "${input.unitText ?? ""}"); divided by ${pack} for a per-unit price.`);
    value = next;
  }

  let fxValue = 1;
  let fxSource: NormalizedPrice["fxRate"]["source"] = "identity";
  let fxMissing = false;
  if (currency !== BASE_CURRENCY) {
    const rate = input.fxRatesToINR[currency];
    if (rate === undefined) {
      fxMissing = true;
      fxSource = "missing";
      assumptions.push(`No FX rate configured for ${currency}; cannot convert to ${BASE_CURRENCY}.`);
    } else {
      fxValue = rate;
      fxSource = "config";
      const next = value * rate;
      steps.push({ step: "currency", description: `${fmt(value)} ${currency} x ${rate} ${BASE_CURRENCY}/${currency}`, input: value, output: next });
      assumptions.push(`Assumed exchange rate 1 ${currency} = ${rate} ${BASE_CURRENCY} (configured assumption, not a market rate).`);
      value = next;
    }
  }

  const list = fxMissing ? null : value;
  let discountPercent = 0;
  if (!fxMissing) {
    for (const pct of input.discountPercents) {
      const next = value * (1 - pct / 100);
      steps.push({ step: "discount", description: `${fmt(value)} x (1 - ${pct}%)`, input: value, output: next });
      assumptions.push(`Applied whole-quote discount of ${pct}% as stated in the document; any conditions attached to it are assumed to be met.`);
      value = next;
      discountPercent = 100 * (1 - (1 - discountPercent / 100) * (1 - pct / 100));
    }
  }

  return {
    unitPriceINR: fxMissing ? null : round2(value),
    listUnitPriceINR: list === null ? null : round2(list),
    currency: "INR",
    basis: "per_unit",
    original: { amount: input.amount, currency, basis: input.unitText },
    packSize: { value: pack, assumed: packAssumed },
    fxRate: { value: fxValue, from: currency, source: fxSource },
    discountPercent: round2(discountPercent),
    steps,
    assumptions,
  };
}
