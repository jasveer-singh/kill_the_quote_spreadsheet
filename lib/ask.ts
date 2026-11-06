import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { bestPrice, priceConfidence } from "./compare-utils";
import type { ComparisonPayload } from "./compare-server";
import { DEFAULT_MODEL } from "./config";
import type { ExtractedVendorQuote } from "./extraction-types";

const ModelAnswer = z.object({
  answer: z.string(),
  answerable: z.enum(["yes", "partly", "no"]),
  limitations: z.array(z.string()),
  citations: z.array(z.object({ vendorId: z.string().nullable(), itemCode: z.string() })),
});

export interface AskCitation {
  vendorId: string | null;
  vendorName: string | null;
  itemCode: string;
  description: string;
  /** Looked up from the extracted data, never taken from the model. */
  priceINR: number | null;
  confidence: "high" | "medium" | "low" | null;
}

export interface AskResult {
  answer: string;
  answerable: "yes" | "partly" | "no";
  limitations: string[];
  citations: AskCitation[];
}

export interface AskTurn {
  question: string;
  answer: string;
}

const MAX_SNIPPET = 200;
const trim = (s: string | null) => (s && s.length > MAX_SNIPPET ? `${s.slice(0, MAX_SNIPPET)}...` : s);

/** Compact JSON view of the comparison for the model: everything on the compare screen, nothing else. */
export function buildAskContext(c: ComparisonPayload): string {
  const qty = new Map(c.rfx.items.map((i) => [i.itemCode, i.quantity]));
  const vendorData = (v: ExtractedVendorQuote) => {
    let lineCostSum = 0;
    let quoted = 0;
    let reliable = 0;
    const lines = v.lines.map((l) => {
      const price = l.normalized?.unitPriceINR ?? null;
      const conf = priceConfidence(l);
      if (price !== null) {
        quoted++;
        lineCostSum += price * (qty.get(l.itemCode) ?? 0);
        if (conf === "high" || conf === "medium") reliable++;
      }
      return {
        code: l.itemCode,
        status: l.status,
        priceINR: price,
        listPriceINR: l.normalized?.listUnitPriceINR ?? null,
        original: l.normalized ? { amount: l.normalized.original.amount, currency: l.normalized.original.currency, basis: l.normalized.original.basis } : null,
        confidence: conf,
        flags: l.flags.map((f) => `${f.type}: ${f.reason}`),
        notes: l.notes.map((n) => n.text),
        snippet: trim(l.unitPrice.sourceSnippet),
      };
    });
    return {
      vendorId: v.vendorId,
      name: v.vendorName,
      sourceFile: v.sourceFile,
      quoteNotes: v.quoteNotes.map((n) => n.text),
      discounts: v.discounts.map((d) => ({ description: d.description, percent: d.percent, appliesTo: d.appliesTo, conditions: d.conditions, appliedToPrices: d.applied })),
      fxRatesToINR: v.assumptions.fxRatesToINR,
      totals: {
        linesQuoted: quoted,
        linesMissing: v.lines.length - quoted,
        linesWithReliablePrice: reliable,
        costOfQuotedLinesAtRfxQuantitiesINR: Math.round(lineCostSum * 100) / 100,
      },
      lines,
    };
  };
  return JSON.stringify({
    rfx: {
      rfxId: c.rfx.rfxId,
      title: c.rfx.title,
      lines: c.rfx.items.map((i) => ({ code: i.itemCode, description: i.description, spec: i.spec, quantity: i.quantity, unit: i.unit })),
    },
    activeRfxNote: c.activeRfxMismatch
      ? `The buyer's active RFx (${c.activeRfxMismatch.activeRfxId}) has no vendor quotes; this data is for ${c.activeRfxMismatch.answeredRfxId}.`
      : null,
    bestPricePerLine: c.rfx.items.map((i) => {
      const b = bestPrice(c.vendors.map((v) => v.lines.find((l) => l.itemCode === i.itemCode)));
      return { code: i.itemCode, winners: b.winners.map((idx) => c.vendors[idx].vendorId), priceINR: b.price, cheaperLowConfidencePriceExists: b.cheaperLowConfidence };
    }),
    vendors: c.vendors.map(vendorData),
  });
}

const SYSTEM_PROMPT = `You are a procurement analyst assistant. A buyer is comparing vendor quotes for an RFx and asks you questions. All the data you may use is in <comparison_data> below. It is the same data shown on the buyer's comparison screen.

Rules:
- Answer using ONLY <comparison_data>. Use no general knowledge about products, vendors, markets or prices, and invent no figures. You may do arithmetic on the data.
- Prices are INR per unit after normalization. "original" shows what the vendor actually wrote (amount, currency, unit basis) and flags explain conversions and assumptions (currency converted at an assumed FX rate, pack price divided down, a quote-level discount applied, units or currency assumed). Use these to explain why numbers differ.
- "totals" and "bestPricePerLine" are computed by the app from the same data. bestPricePerLine only considers high and medium confidence prices. Vendor totals only cover lines the vendor quoted, so they are not comparable between vendors unless the same lines are covered; say so when you compare totals.
- State plainly when data is missing (a vendor did not quote a line), low confidence, assumed (FX rate, pack size, currency, discount conditions) or when the question cannot be answered from this data. Never guess to fill a gap. Put each such caveat in "limitations", one short sentence each, and mention the important ones in the answer.
- Reference evidence inline in the answer as (see LAP-001) or (see vendor-b, MON-001): the RFx item code, with the vendor id when the claim is about one vendor. List every reference you used in "citations" (vendorId null for a claim about a line in general). Only cite item codes and vendor ids that exist in the data.
- Be concise and direct, analyst style: lead with the answer in the first sentence, then the key reasoning in at most 4 short sentences or bullets (about 120 words in total). No preamble, no restating the question, no long essay.
- Put inline (see ...) references only on the specific figures or claims they support. When you list many lines, name the codes once in the list instead of repeating a reference after each.
- "limitations": at most 3 items, only caveats that could change the buyer's decision, each under 20 words.
- answerable: "yes" if fully answered from the data, "partly" if some of it could not be, "no" if it cannot be answered from this data.`;

/** Answers a buyer's question from the comparison data. Makes a live Claude call. */
export async function answerQuestion(
  question: string,
  comparison: ComparisonPayload,
  options: { history?: AskTurn[]; client?: Anthropic; model?: string } = {},
): Promise<AskResult> {
  const q = question.trim();
  if (!q) throw new Error("Ask a question about the comparison.");
  const client = options.client ?? new Anthropic();
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  const messages: Anthropic.MessageParam[] = [];
  for (const t of options.history ?? []) {
    messages.push({ role: "user", content: t.question }, { role: "assistant", content: t.answer });
  }
  messages.push({ role: "user", content: q });

  const message = await client.messages
    .stream({
      model,
      max_tokens: 8000,
      system: [
        { type: "text", text: SYSTEM_PROMPT },
        // identical for every question in a session, so cache it
        { type: "text", text: `<comparison_data>\n${buildAskContext(comparison)}\n</comparison_data>`, cache_control: { type: "ephemeral" } },
      ],
      messages,
      output_config: { format: zodOutputFormat(ModelAnswer) },
    })
    .finalMessage();

  if (message.stop_reason === "refusal") throw new Error("Claude declined to answer this question.");
  if (message.stop_reason === "max_tokens") throw new Error("The answer was cut off; try a narrower question.");
  const parsed = ModelAnswer.parse(JSON.parse(message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("")));

  // Look every citation up in the real data; drop any the model made up.
  const limitations = [...parsed.limitations];
  const seen = new Set<string>();
  const citations: AskCitation[] = [];
  let dropped = 0;
  for (const c of parsed.citations) {
    const key = `${c.vendorId}|${c.itemCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item = comparison.rfx.items.find((i) => i.itemCode === c.itemCode);
    const vendor = c.vendorId === null ? null : comparison.vendors.find((v) => v.vendorId === c.vendorId);
    if (!item || (c.vendorId !== null && !vendor)) {
      dropped++;
      continue;
    }
    const line = vendor?.lines.find((l) => l.itemCode === c.itemCode);
    citations.push({
      vendorId: vendor?.vendorId ?? null,
      vendorName: vendor?.vendorName ?? null,
      itemCode: item.itemCode,
      description: item.description,
      priceINR: line?.normalized?.unitPriceINR ?? null,
      confidence: line ? priceConfidence(line) : null,
    });
  }
  if (dropped) limitations.push(`${dropped} reference(s) in the answer did not match the comparison data and were removed.`);

  return { answer: parsed.answer, answerable: parsed.answerable, limitations, citations };
}
