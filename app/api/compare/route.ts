import { ZodError } from "zod";
import { buildComparison } from "@/lib/compare-server";

/** Body: { rfx?: Rfx | null } - the active RFx from the client's localStorage, if any. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  try {
    return Response.json(buildComparison(body?.rfx));
  } catch (e) {
    if (e instanceof ZodError) return Response.json({ error: "The active RFx in this browser is malformed." }, { status: 400 });
    return Response.json({ error: e instanceof Error ? e.message : "Comparison failed" }, { status: 500 });
  }
}
