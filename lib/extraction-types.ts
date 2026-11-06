export type Confidence = "high" | "medium" | "low";

/** Flags Claude raises, plus ones the engine adds when cross-checking or normalizing. */
export type FlagType =
  | "missing_line"
  | "unit_mismatch"
  | "currency_mismatch"
  | "discount_applied"
  | "snippet_unverified"
  | "fx_rate_missing"
  | "unit_assumed"
  | "currency_assumed"
  | "not_returned_by_model";

export interface Flag {
  type: FlagType;
  reason: string;
  source: "model" | "engine";
}

export interface ExtractedField<T> {
  value: T | null;
  /** null whenever value is null: nothing was extracted, so there is nothing to be confident about. */
  confidence: Confidence | null;
  /** Text the value was read from. For images, the model's transcription of the visible text. */
  sourceSnippet: string | null;
  /** true/false = checked against the extracted document text; null = not checkable (image/vision input, or no snippet). */
  snippetVerified: boolean | null;
}

export interface ExtractedUnit extends ExtractedField<string> {
  /** Units contained in one priced unit, e.g. 100 for "per box of 100"; 1 for "per unit". */
  unitsPerPricedUnit: number | null;
}

export interface Note {
  text: string;
  sourceSnippet: string | null;
}

export interface NormalizationStep {
  step: "pack_size" | "currency" | "discount";
  description: string;
  input: number;
  output: number;
}

export interface NormalizedPrice {
  /** Final per-unit INR price after any whole-quote discount. */
  unitPriceINR: number | null;
  /** Per-unit INR price before discount. */
  listUnitPriceINR: number | null;
  currency: "INR";
  basis: "per_unit";
  original: { amount: number; currency: string; basis: string | null };
  packSize: { value: number; assumed: boolean };
  fxRate: { value: number; from: string; source: "identity" | "config" | "missing" };
  discountPercent: number;
  steps: NormalizationStep[];
  assumptions: string[];
}

export interface ExtractedLine {
  itemCode: string;
  rfxDescription: string;
  rfxQuantity: number;
  rfxUnit: string;
  status: "quoted" | "missing";
  quantity: ExtractedField<number>;
  unit: ExtractedUnit;
  unitPrice: ExtractedField<number>;
  currency: ExtractedField<string>;
  notes: Note[];
  flags: Flag[];
  normalized: NormalizedPrice | null;
}

export interface QuoteDiscount {
  description: string;
  percent: number | null;
  appliesTo: "whole_quote" | "specific_lines" | "unclear";
  conditions: string | null;
  confidence: Confidence;
  sourceSnippet: string | null;
  snippetVerified: boolean | null;
  /** Whether the engine applied it to normalized prices. */
  applied: boolean;
}

export interface ExtractedVendorQuote {
  vendorId: string;
  sourceFile: string;
  extractedAt: string;
  model: string;
  rfxId: string;
  baseCurrency: string;
  basePriceBasis: string;
  rawContent: {
    source: string;
    characters: number | null;
    sentAsImage: boolean;
    sentAsPdfDocument: boolean;
    imageOnlyPages: number[];
  };
  assumptions: { fxRatesToINR: Record<string, number> };
  vendorName: string | null;
  quoteNotes: Note[];
  discounts: QuoteDiscount[];
  summary: {
    lines: number;
    quoted: number;
    missing: number;
    flagCounts: Partial<Record<FlagType, number>>;
  };
  usage: { inputTokens: number; outputTokens: number };
  lines: ExtractedLine[];
}
