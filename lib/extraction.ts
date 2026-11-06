import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { BASE_CURRENCY, BASE_PRICE_BASIS, DEFAULT_FX_RATES_TO_INR, DEFAULT_MODEL } from "./config";
import type {
  ExtractedField,
  ExtractedLine,
  ExtractedUnit,
  ExtractedVendorQuote,
  Flag,
  FlagType,
  QuoteDiscount,
} from "./extraction-types";
import { normalizePrice } from "./normalize";
import { loadRawContent, type RawContent } from "./raw-content";
import type { Rfx } from "./rfx-types";

// ---------- structured output schema ----------
const Confidence = z.enum(["high", "medium", "low"]);
type Confidence = z.infer<typeof Confidence>;
const Snippet = z.string().nullable();

const field = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ value: value.nullable(), confidence: Confidence, sourceSnippet: Snippet });

const ModelLine = z.object({
  itemCode: z.string(),
  status: z.enum(["quoted", "missing"]),
  quantity: field(z.number()),
  unit: z.object({
    value: z.string().nullable(),
    unitsPerPricedUnit: z.number().nullable(),
    confidence: Confidence,
    sourceSnippet: Snippet,
  }),
  unitPrice: field(z.number()),
  currency: field(z.string()),
  notes: z.array(z.object({ text: z.string(), sourceSnippet: Snippet })),
  flags: z.array(
    z.object({
      type: z.enum(["missing_line", "unit_mismatch", "currency_mismatch"]),
      reason: z.string(),
    }),
  ),
});

const ModelOutput = z.object({
  vendorName: z.string().nullable(),
  quoteNotes: z.array(z.object({ text: z.string(), sourceSnippet: Snippet })),
  discounts: z.array(
    z.object({
      description: z.string(),
      percent: z.number().nullable(),
      appliesTo: z.enum(["whole_quote", "specific_lines", "unclear"]),
      conditions: z.string().nullable(),
      confidence: Confidence,
      sourceSnippet: Snippet,
    }),
  ),
  lines: z.array(ModelLine),
});
type ModelOutput = z.infer<typeof ModelOutput>;

// ---------- prompt ----------
const SYSTEM_PROMPT = `You extract vendor price quotes for a procurement team. You are given an RFx (a list of requested line items) and one vendor's reply in whatever format it arrived. Report exactly what the vendor wrote, mapped onto the RFx lines.

Rules:
- Return one entry per RFx line, using the RFx itemCode, for every line in the RFx and no others. Vendors may omit the item code, reorder lines, reword descriptions or write prices in prose; match by meaning (description, specification) and use your judgment, lowering confidence when the match or the number is uncertain.
- Never fill a value from the RFx or from your own knowledge. If the vendor did not state a quantity, unit, price or currency for a line, set that value to null.
- unitPrice.value is the number exactly as the vendor stated it, with no arithmetic, no currency conversion and no division by pack size. Write "1,02,600" as 102600.
- unit.value describes what the price is quoted per, in the vendor's words (e.g. "per unit", "per box of 100"). unit.unitsPerPricedUnit is how many RFx units one priced unit contains (1 for per-unit pricing, 100 for "per box of 100"). If the vendor never says, set both to null rather than assuming.
- currency.value is the ISO 4217 code of the vendor's price (INR for Rs., Rs, INR or a rupee sign; USD for $ or US dollars). Null if not stated.
- quantity.value is the quantity the vendor wrote for the line. It is null if the vendor stated none.
- Every non-null value needs a sourceSnippet: a short verbatim excerpt of the document containing that value. For text documents copy characters exactly as they appear. For images, transcribe the visible text of the relevant row or sentence as faithfully as you can. A snippet that identifies the line and the number is better than one that holds only the number.
- confidence applies only to non-null values: high = value stated plainly; medium = needed interpretation (prose, abbreviation like "17.4k", fuzzy line match); low = guessed, blurry or ambiguous.
- status "missing" means the vendor gave no price for that line, including when the vendor only refers to it loosely (for example "rest same as last year"), in which case put that remark in notes with its snippet. Missing lines have null values.
- flags (a line may have several): missing_line when the line is missing; unit_mismatch when the unit the price is quoted per differs from per RFx unit, for example per box or per pack; currency_mismatch when the currency is not ${BASE_CURRENCY}. Explain each in reason.
- notes: line-specific remarks from the vendor (lead time, freight, taxes, warranty, conditions).
- quoteNotes: remarks that apply to the whole quote (taxes, freight, validity, payment terms).
- discounts: every discount the vendor states anywhere, including small print and footnotes. Give the percentage, whether it applies to the whole quote, to specific lines or unclear, its conditions, and a snippet. Do not apply discounts to unitPrice.value.`;

function describeRfx(rfx: Rfx): string {
  const rows = rfx.items.map((i) => `${i.itemCode} | ${i.description} | ${i.spec} | qty ${i.quantity} | unit ${i.unit}`);
  return `RFx ${rfx.rfxId} - ${rfx.title}\nBase currency: ${BASE_CURRENCY}. Expected pricing basis: per single RFx unit.\nLines (itemCode | description | specification | quantity | unit):\n${rows.join("\n")}`;
}

function buildUserContent(rfx: Rfx, raw: RawContent): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [];
  if (raw.image) {
    blocks.push({ type: "image", source: { type: "base64", media_type: raw.image.mediaType, data: raw.image.base64 } });
  }
  if (raw.pdfBase64) {
    blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: raw.pdfBase64 } });
  }
  const parts = [`<rfx>\n${describeRfx(rfx)}\n</rfx>`];
  if (raw.text !== null) {
    parts.push(
      `<vendor_response format="${raw.source}">\n${raw.text}\n</vendor_response>`,
      raw.imageOnlyPages.length
        ? `Pages ${raw.imageOnlyPages.join(", ")} of the attached PDF have no extractable text; read them from the PDF itself.`
        : "",
    );
  } else {
    parts.push("The vendor's response is the attached image.");
  }
  parts.push("Extract the vendor's quote against every RFx line.");
  blocks.push({ type: "text", text: parts.filter(Boolean).join("\n\n") });
  return blocks;
}

// ---------- verification ----------
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** true/false when the snippet can be checked against document text; null when it cannot. */
function verifySnippet(snippet: string | null, raw: RawContent): boolean | null {
  if (snippet === null || raw.text === null) return null;
  const needle = squash(snippet);
  if (needle.length < 3) return null;
  const found = squash(raw.text).includes(needle);
  // With image-only PDF pages the snippet may legitimately come from the pixels.
  if (!found && raw.pdfBase64) return null;
  return found;
}

/** A null value carries no confidence: "confident in a missing value" is meaningless. */
const verifiedField = <T>(f: { value: T | null; confidence: Confidence; sourceSnippet: string | null }, raw: RawContent): ExtractedField<T> => ({
  ...f,
  confidence: f.value === null ? null : f.confidence,
  snippetVerified: f.value === null ? null : verifySnippet(f.sourceSnippet, raw),
});

// ---------- public API ----------
export interface ExtractionOptions {
  rfx: Rfx;
  client?: Anthropic;
  model?: string;
  /** INR per 1 unit of currency. Defaults to DEFAULT_FX_RATES_TO_INR. */
  fxRatesToINR?: Record<string, number>;
  /** Used for vendorId in the result; defaults to the file name without extension. */
  vendorId?: string;
}

/** Extracts and normalizes one vendor's quote. Makes a live Claude API call. */
export async function extractVendorQuote(
  fileName: string,
  data: Buffer,
  options: ExtractionOptions,
): Promise<ExtractedVendorQuote> {
  const { rfx } = options;
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const fxRates = options.fxRatesToINR ?? DEFAULT_FX_RATES_TO_INR;
  const client = options.client ?? new Anthropic();

  const raw = await loadRawContent(fileName, data);

  const stream = client.messages.stream({
    model,
    max_tokens: 32000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserContent(rfx, raw) }],
    output_config: { format: zodOutputFormat(ModelOutput) },
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error(`Claude declined to process ${fileName} (${message.stop_details?.category ?? "no category"})`);
  }
  if (message.stop_reason === "max_tokens") {
    throw new Error(`Extraction for ${fileName} was cut off at max_tokens; output is incomplete`);
  }
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = ModelOutput.parse(JSON.parse(text));

  return assemble(fileName, parsed, raw, {
    rfx,
    model,
    fxRates,
    vendorId: options.vendorId ?? path.basename(fileName, path.extname(fileName)),
    usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
  });
}

// ---------- assembly + normalization ----------
function assemble(
  fileName: string,
  out: ModelOutput,
  raw: RawContent,
  ctx: { rfx: Rfx; model: string; fxRates: Record<string, number>; vendorId: string; usage: { inputTokens: number; outputTokens: number } },
): ExtractedVendorQuote {
  const { rfx, fxRates } = ctx;

  const discounts: QuoteDiscount[] = out.discounts.map((d) => ({
    ...d,
    snippetVerified: verifySnippet(d.sourceSnippet, raw),
    applied: d.appliesTo === "whole_quote" && d.percent !== null && d.percent > 0,
  }));
  const wholeQuotePercents = discounts.filter((d) => d.applied).map((d) => d.percent as number);

  const byCode = new Map<string, ModelOutput["lines"][number]>();
  for (const l of out.lines) if (!byCode.has(l.itemCode)) byCode.set(l.itemCode, l);

  const lines: ExtractedLine[] = rfx.items.map((item) => {
    const m = byCode.get(item.itemCode);
    const flags: Flag[] = [];
    const addEngine = (type: FlagType, reason: string) => {
      if (!flags.some((f) => f.type === type)) flags.push({ type, reason, source: "engine" });
    };

    if (!m) {
      addEngine("not_returned_by_model", "Claude's response had no entry for this RFx line; treated as missing.");
      addEngine("missing_line", "No price found for this line.");
      const empty = <T,>(): ExtractedField<T> => ({ value: null, confidence: null, sourceSnippet: null, snippetVerified: null });
      return {
        itemCode: item.itemCode,
        rfxDescription: item.description,
        rfxQuantity: item.quantity,
        rfxUnit: item.unit,
        status: "missing",
        quantity: empty(),
        unit: { ...empty<string>(), unitsPerPricedUnit: null },
        unitPrice: empty(),
        currency: empty(),
        notes: [],
        flags,
        normalized: null,
      };
    }

    flags.push(...m.flags.map((f) => ({ ...f, source: "model" as const })));
    const quantity = verifiedField(m.quantity, raw);
    const unit: ExtractedUnit = { ...verifiedField(m.unit, raw), unitsPerPricedUnit: m.unit.unitsPerPricedUnit };
    if (unit.value === null && unit.unitsPerPricedUnit !== null) unit.confidence = m.unit.confidence;
    const unitPrice = verifiedField(m.unitPrice, raw);
    const currency = verifiedField(m.currency, raw);

    const priced = m.status === "quoted" && unitPrice.value !== null;
    const status: ExtractedLine["status"] = priced ? "quoted" : "missing";
    if (m.status === "quoted" && !priced) addEngine("missing_line", "Marked quoted but no unit price was extracted.");
    if (status === "missing") addEngine("missing_line", "Vendor gave no price for this line.");

    for (const [label, f] of [["quantity", quantity], ["unit", unit], ["unitPrice", unitPrice], ["currency", currency]] as const) {
      if (f.snippetVerified === false) addEngine("snippet_unverified", `The ${label} source snippet was not found in the extracted document text.`);
    }

    let normalized: ExtractedLine["normalized"] = null;
    if (priced) {
      const cur = currency.value ?? BASE_CURRENCY;
      if (currency.value === null) {
        addEngine("currency_assumed", `No currency stated; assumed ${BASE_CURRENCY}.`);
      } else if (cur.toUpperCase() !== BASE_CURRENCY) {
        addEngine("currency_mismatch", `Quoted in ${cur.toUpperCase()}, base currency is ${BASE_CURRENCY}.`);
      }
      if (unit.unitsPerPricedUnit !== null && unit.unitsPerPricedUnit !== 1) {
        addEngine("unit_mismatch", `Priced per ${unit.value ?? `pack of ${unit.unitsPerPricedUnit}`}, RFx expects per ${item.unit}.`);
      }
      normalized = normalizePrice({
        amount: unitPrice.value as number,
        currency: cur,
        unitText: unit.value,
        unitsPerPricedUnit: unit.unitsPerPricedUnit,
        fxRatesToINR: fxRates,
        discountPercents: wholeQuotePercents,
      });
      if (normalized.fxRate.source === "missing") addEngine("fx_rate_missing", `No FX rate configured for ${normalized.fxRate.from}.`);
      if (normalized.packSize.assumed) addEngine("unit_assumed", "No pack size stated; assumed price is per single unit.");
      if (normalized.discountPercent > 0) addEngine("discount_applied", `${normalized.discountPercent}% quote-level discount applied to the normalized price.`);
    }
    if (status === "missing") normalized = null;

    return {
      itemCode: item.itemCode,
      rfxDescription: item.description,
      rfxQuantity: item.quantity,
      rfxUnit: item.unit,
      status,
      quantity,
      unit,
      unitPrice,
      currency,
      notes: m.notes,
      flags,
      normalized,
    };
  });

  const flagCounts: Partial<Record<FlagType, number>> = {};
  for (const l of lines) for (const f of l.flags) flagCounts[f.type] = (flagCounts[f.type] ?? 0) + 1;
  const quoted = lines.filter((l) => l.status === "quoted").length;

  return {
    vendorId: ctx.vendorId,
    sourceFile: fileName,
    extractedAt: new Date().toISOString(),
    model: ctx.model,
    rfxId: rfx.rfxId,
    baseCurrency: BASE_CURRENCY,
    basePriceBasis: BASE_PRICE_BASIS,
    rawContent: {
      source: raw.source,
      characters: raw.text?.length ?? null,
      sentAsImage: !!raw.image,
      sentAsPdfDocument: !!raw.pdfBase64,
      imageOnlyPages: raw.imageOnlyPages,
    },
    assumptions: { fxRatesToINR: fxRates },
    vendorName: out.vendorName,
    quoteNotes: out.quoteNotes,
    discounts,
    summary: { lines: lines.length, quoted, missing: lines.length - quoted, flagCounts },
    usage: ctx.usage,
    lines,
  };
}
