import { z } from "zod";
import { draftRfx } from "@/lib/draft-rfx";

const Body = z.object({
  input: z.string().min(1).max(4000),
  clarification: z.object({ question: z.string().max(2000), answer: z.string().min(1).max(4000) }).optional(),
});

export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "Invalid request" }, { status: 400 });
  try {
    return Response.json(await draftRfx(body.data.input, { clarification: body.data.clarification }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Drafting failed" }, { status: 500 });
  }
}
