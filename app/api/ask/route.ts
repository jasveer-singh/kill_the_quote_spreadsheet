import { z } from "zod";
import { answerQuestion } from "@/lib/ask";
import { buildComparison, type ComparisonPayload } from "@/lib/compare-server";

const Body = z.object({
  question: z.string().min(1).max(2000),
  history: z.array(z.object({ question: z.string().max(2000), answer: z.string().max(8000) })).max(10).optional(),
  rfx: z.unknown().optional(),
});

/** Body: { question, history?, rfx? } where rfx is the active RFx from the client's localStorage, if any. */
export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  let comparison: ComparisonPayload;
  try {
    comparison = buildComparison(body.data.rfx);
  } catch (e) {
    if (e instanceof z.ZodError) return Response.json({ error: "The active RFx in this browser is malformed." }, { status: 400 });
    return Response.json({ error: e instanceof Error ? e.message : "Could not load comparison data" }, { status: 500 });
  }
  try {
    return Response.json(await answerQuestion(body.data.question, comparison, { history: body.data.history }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Could not answer" }, { status: 500 });
  }
}
