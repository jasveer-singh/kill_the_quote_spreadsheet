import fs from "node:fs";
import path from "node:path";
import type { ExtractedVendorQuote } from "./extraction-types";
import { loadRfx } from "./rfx-load";
import { resolveRfx } from "./rfx-resolve";
import type { Rfx } from "./rfx-types";

export interface ComparisonPayload {
  /** The RFx the table rows come from: the one the vendor quotes actually answer. */
  rfx: Rfx;
  /** Set when the active RFx is not the one the vendors answered, so the buyer sees why rows differ. */
  activeRfxMismatch: { activeRfxId: string; activeTitle: string; answeredRfxId: string } | null;
  vendors: ExtractedVendorQuote[];
}

// statically scoped to data/extracted so the deploy trace stays small
const EXTRACTED_DIR = path.join(process.cwd(), "data", "extracted");

export function loadExtractedVendors(): ExtractedVendorQuote[] {
  const files = fs.existsSync(EXTRACTED_DIR) ? fs.readdirSync(EXTRACTED_DIR).filter((f) => f.endsWith(".json")).sort() : [];
  if (!files.length) throw new Error("No extracted vendor files found in data/extracted/. Run `npm run extract` first.");
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(EXTRACTED_DIR, f), "utf8")) as ExtractedVendorQuote);
}

/**
 * Active RFx resolution reuses resolveRfx (client-supplied RFx, else the baseline). The extracted quotes
 * answer one specific RFx; if the active RFx is a different one, rows come from the baseline instead.
 */
export function buildComparison(fromClient?: unknown): ComparisonPayload {
  const active = resolveRfx(fromClient);
  const vendors = loadExtractedVendors();
  const answeredRfxId = vendors[0].rfxId;
  if (active.rfxId === answeredRfxId) return { rfx: active, activeRfxMismatch: null, vendors };
  return {
    rfx: loadRfx(),
    activeRfxMismatch: { activeRfxId: active.rfxId, activeTitle: active.title, answeredRfxId },
    vendors,
  };
}
