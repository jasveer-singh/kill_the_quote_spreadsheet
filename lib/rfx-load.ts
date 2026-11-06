import fs from "node:fs";
import path from "node:path";
import type { Rfx } from "./rfx-types";

/** Reads data/rfx.json, the read-only baseline RFx written by scripts/generate-dataset.ts. Kept free of extraction imports. */
export function loadRfx(): Rfx {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "rfx.json"), "utf8")) as Rfx;
}
