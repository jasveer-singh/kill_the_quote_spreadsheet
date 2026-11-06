/**
 * Runs the extraction engine over every file in data/vendor-responses/ and writes
 * data/extracted/<vendor>.json. Makes live Claude API calls.
 * Run: npm run extract [-- vendor-a vendor-d]
 */
import fs from "node:fs";
import path from "node:path";
import { extractVendorQuote, loadRfx } from "../lib/extraction";

const ROOT = path.resolve(__dirname, "..");
const IN = path.join(ROOT, "data", "vendor-responses");
const OUT = path.join(ROOT, "data", "extracted");

async function main() {
  for (const f of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(path.join(ROOT, f));
    } catch {}
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env.local (see README).");
  }
  const only = process.argv.slice(2);
  const files = fs
    .readdirSync(IN)
    .filter((f) => !f.startsWith("."))
    .filter((f) => !only.length || only.includes(path.basename(f, path.extname(f))))
    .sort();
  fs.mkdirSync(OUT, { recursive: true });
  const rfx = loadRfx();

  const results = await Promise.allSettled(
    files.map(async (file) => {
      const t0 = Date.now();
      const quote = await extractVendorQuote(file, fs.readFileSync(path.join(IN, file)), { rfx });
      fs.writeFileSync(path.join(OUT, `${quote.vendorId}.json`), JSON.stringify(quote, null, 2));
      const { quoted, missing } = quote.summary;
      console.log(`${file}: ${quoted} quoted, ${missing} missing, ${quote.usage.inputTokens}/${quote.usage.outputTokens} tokens, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`${files[i]} FAILED:`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
  if (results.some((r) => r.status === "rejected")) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
