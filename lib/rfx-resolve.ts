import { loadRfx } from "./extraction";
import { RfxSchema } from "./rfx-schema";
import type { Rfx } from "./rfx-types";

/**
 * Server side: picks the RFx for a request. Clients send the active RFx from localStorage in the
 * request body; when they have none, falls back to the read-only baseline data/rfx.json.
 * A supplied but malformed RFx throws rather than silently falling back.
 */
export function resolveRfx(fromClient?: unknown): Rfx {
  if (fromClient === undefined || fromClient === null) return loadRfx();
  return RfxSchema.parse(fromClient) as Rfx;
}
