import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { DEFAULT_MODEL } from "./config";
import type { Rfx } from "./rfx-types";

const DraftBody = z.object({
  title: z.string(),
  buyer: z.string().nullable(),
  deliveryLocation: z.string().nullable(),
  responseDueBy: z.string().nullable(),
  items: z.array(
    z.object({
      itemCode: z.string(),
      description: z.string(),
      spec: z.string(),
      quantity: z.number(),
      unit: z.string(),
    }),
  ),
});

// First round: Claude either asks one question or drafts.
const FirstRound = z.object({
  action: z.enum(["ask", "draft"]),
  question: z.string().nullable(),
  rfx: DraftBody.nullable(),
});
// Second round: drafting is the only option.
const SecondRound = z.object({ rfx: DraftBody });

export interface Clarification {
  question: string;
  answer: string;
}

export type DraftResult =
  | { status: "needs_clarification"; question: string }
  | { status: "drafted"; rfx: Rfx };

export interface DraftOptions {
  /** The buyer's answer to the one clarifying question. When present Claude must draft. */
  clarification?: Clarification;
  client?: Anthropic;
  model?: string;
  now?: Date;
}

const SYSTEM_PROMPT = `You help a procurement buyer turn a rough need into a structured RFx (request for quotation) that vendors will answer line by line.

Draft one line item per distinct product the buyer needs. For each line give:
- itemCode: a short category prefix, a hyphen and a three-digit number, e.g. LAP-001, MON-001, CAB-001. Codes must be unique.
- description: a concise product name, e.g. Business Laptop 14".
- spec: the technical requirements as one line of comma-separated specs. Include any delivery-timing or budget constraints the buyer mentioned in the spec of the lines they affect (for example "delivery by 31 Dec 2026", "cost-effective model").
- quantity: a positive whole number taken from the buyer's words. Never invent a quantity.
- unit: "Nos" unless the product is naturally sold otherwise (e.g. "Set").

title is a short name for the RFx. buyer, deliveryLocation and responseDueBy: fill them only when the buyer stated them (responseDueBy as YYYY-MM-DD), otherwise null. Do not add products the buyer did not ask for. Fill reasonable standard specs only where they follow directly from what the buyer said.`;

const FIRST_ROUND_RULES = `You may ask the buyer at most ONE clarifying question, and only if the input is too vague to draft a reasonable RFx, meaning a product category or a quantity is missing for what they need. Put everything you need to know into that single question. If the input is detailed enough, draft instead.
Respond with action "ask" and a question (rfx null), or action "draft" and an rfx (question null).`;

const SECOND_ROUND_RULES = `The buyer has answered your clarifying question. You must now draft the RFx; do not ask anything further. Where information is still missing, make the most reasonable minimal choice and keep the spec generic.`;

function toRfx(body: z.infer<typeof DraftBody>, now: Date): Rfx {
  const seen = new Set<string>();
  for (const i of body.items) {
    if (seen.has(i.itemCode)) throw new Error(`Claude returned a duplicate item code: ${i.itemCode}`);
    seen.add(i.itemCode);
    if (!Number.isInteger(i.quantity) || i.quantity <= 0) {
      throw new Error(`Claude returned an invalid quantity for ${i.itemCode}: ${i.quantity}`);
    }
  }
  if (!body.items.length) throw new Error("Claude returned an RFx with no line items");
  return {
    rfxId: `RFX-${now.getFullYear()}-${String(Math.floor(1000 + Math.random() * 9000))}`,
    title: body.title,
    buyer: body.buyer ?? "",
    issuedOn: now.toISOString().slice(0, 10),
    responseDueBy: body.responseDueBy ?? "",
    deliveryLocation: body.deliveryLocation ?? "",
    items: body.items,
  };
}

/**
 * Drafts an RFx from a buyer's plain-language need. Makes a live Claude call.
 * Round 1 (no clarification): returns either one clarifying question or a draft.
 * Round 2 (clarification supplied): always returns a draft.
 */
export async function draftRfx(input: string, options: DraftOptions = {}): Promise<DraftResult> {
  const need = input.trim();
  if (!need) throw new Error("Describe what you need to buy.");
  const now = options.now ?? new Date();
  const client = options.client ?? new Anthropic();
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const second = options.clarification !== undefined;

  const userText = second
    ? `Today's date: ${now.toISOString().slice(0, 10)}\n\nBuyer's need:\n${need}\n\nYour clarifying question:\n${options.clarification!.question}\n\nBuyer's answer:\n${options.clarification!.answer}`
    : `Today's date: ${now.toISOString().slice(0, 10)}\n\nBuyer's need:\n${need}`;

  const message = await client
    .messages.stream({
      model,
      max_tokens: 16000,
      system: `${SYSTEM_PROMPT}\n\n${second ? SECOND_ROUND_RULES : FIRST_ROUND_RULES}`,
      messages: [{ role: "user", content: userText }],
      output_config: { format: zodOutputFormat(second ? SecondRound : FirstRound) },
    })
    .finalMessage();

  if (message.stop_reason === "refusal") throw new Error("Claude declined to draft this request.");
  if (message.stop_reason === "max_tokens") throw new Error("The draft was cut off; try a shorter description.");
  const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const json: unknown = JSON.parse(text);

  if (second) return { status: "drafted", rfx: toRfx(SecondRound.parse(json).rfx, now) };

  const first = FirstRound.parse(json);
  if (first.action === "ask") {
    if (!first.question?.trim()) throw new Error("Claude chose to ask but returned no question.");
    return { status: "needs_clarification", question: first.question.trim() };
  }
  if (!first.rfx) throw new Error("Claude chose to draft but returned no RFx.");
  return { status: "drafted", rfx: toRfx(first.rfx, now) };
}
