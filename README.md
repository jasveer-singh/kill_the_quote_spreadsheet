# Kill the Quote Spreadsheet

An AI-native procurement assistant prototype, built for Aerchain's SPM assignment "Kill the Quote Spreadsheet". It drafts an RFx from a plain-language need, extracts and normalizes messy vendor quotes in five different formats, compares them with the source of every number visible, and answers questions about the comparison from the same structured data.

## Live demo

**URL:** https://killthequotespreadsheet.vercel.app/

| Screen | What it does |
| --- | --- |
| `/draft` | Describe a need in plain English. Claude asks at most one clarifying question if the need is too vague, then drafts a structured RFx you can edit line by line and confirm. |
| `/compare` | Table of RFx lines against five vendors, in normalized INR per unit. Click any cell for its provenance: confidence, original value, conversion steps, source snippet and flags. Lowest price per line is highlighted. |
| `/ask` | Chat about the comparison ("which vendor is cheapest for laptops?", "which lines does vendor E not quote?"). Answers cite vendors and line items and say when data is missing or low confidence. |

`/compare` and `/ask` read pre-extracted JSON committed in `data/extracted/`, so they work without re-running extraction.

## Run locally

Requires Node 20.12 or later.

```bash
git clone <repo-url>
cd <repo>
npm install
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local    # gitignored
npm run dev                                          # http://localhost:3000
```

`/compare` needs no API key. `/draft` and `/ask` call Claude, so they do. To deploy on Vercel, set `ANTHROPIC_API_KEY` in the project's environment variables.

**Dataset generation** (deterministic, seeded): fabricates the RFx and five vendor response files.

```bash
npm run generate:dataset
```

This writes `data/rfx.json`, `data/rfx-template.xlsx`, `data/ground-truth.json` and the five files in `data/vendor-responses/`. Regenerating overwrites them.

**Extraction** (live Claude calls, writes `data/extracted/<vendor>.json`):

```bash
npm run extract                  # all five vendors
npm run extract -- vendor-e      # one vendor (vendor-a ... vendor-e)
```

The default model is `claude-sonnet-5-5`; override with `ANTHROPIC_MODEL`.

## Architecture

```
scripts/generate-dataset.ts        fabricated RFx + 5 vendor files (xlsx, pdf, docx, png, txt)
        |
lib/raw-content.ts                 raw text/pixels per file type, no interpretation
lib/extraction.ts                  Claude call (structured output) matched to the RFx lines
lib/normalize.ts                   to INR per unit, keeping original value and assumptions
        |
data/extracted/*.json              per-vendor lines: original, normalized, confidence, snippet, flags
        |
lib/draft-rfx.ts  ---------------> /draft  -> active RFx in browser localStorage
        |
lib/compare-server.ts              resolves the RFx (lib/rfx-resolve.ts) and loads extracted JSON
        |-> /api/compare -> /compare   comparison table with provenance
        |-> lib/ask.ts   -> /api/ask -> /ask   grounded Q&A over the same data
```

- **Extraction.** Each file type is read as-is (exceljs for xlsx, pdf-parse for PDF, mammoth for docx, plain text for txt). The PNG goes to Claude as an image. PDF pages with no extractable text would be sent to Claude's vision input, but the sample PDF has a text layer, so that path was not exercised. Claude returns, per RFx line, quantity, unit, unit price, currency and notes. Each value carries a confidence level and the exact snippet it came from, plus flags for missing lines, unit mismatches and non-INR currency. The engine checks snippets against the document text and adds its own flags where Claude's output disagrees with the rules.
- **Normalization.** Divide by pack size, convert currency, apply any quote-level discount. Every line keeps the original amount, currency and unit, the steps taken and the assumptions made.
- **Comparison.** A cell's confidence is the weakest of its price, currency and unit confidence. Only high and medium confidence prices can win a line. If none qualify, the row says there is no reliable winner.
- **Q&A.** Claude receives a compact JSON view of the comparison and is instructed to answer only from it. Citations in the response are looked up in the real data; any that do not match a vendor and line are dropped and reported.

## Key design decisions

- **Fixed FX rate (83 INR/USD).** It lives in `lib/config.ts` and can be overridden through the `fxRatesToINR` option. Every converted line records the rate it used. A live lookup would make the demo non-deterministic and harder to test, and a rate that moves would change the comparison between runs.
- **Vendor B's footnote discount is applied.** The 5% discount appears only in small print. It is captured with its snippet and applied to normalized prices, and the line is flagged `discount_applied`. The list price is kept alongside. Showing the undiscounted price would make the comparison less accurate, not more honest. The discount's condition (order confirmed within 15 days) is recorded as an assumption that is treated as met, and the column header shows it.
- **The comparison renders against the RFx the quotes answer.** All extracted quotes answer RFX-2026-0417. If the buyer's confirmed RFx is a different one, the table still shows RFX-2026-0417 and a banner explains why. Matching by item code instead would risk showing a price against a line with a different spec.
- **Active RFx is stored in the browser (localStorage).** The first version wrote `data/active-rfx.json` on the server. Vercel's serverless filesystem is read-only at runtime, so this was replaced during the build with client-side storage. Routes that need the RFx receive it in the request body and fall back to the baseline `data/rfx.json` when the client has none. `data/rfx.json` is never modified.
- **Totals and per-line winners are computed by the app.** `lib/ask.ts` gives Claude each vendor's total at RFx quantities (quoted lines only, labelled as such) and the best price per line, using the same logic as the comparison table, so those figures cannot be hallucinated. Claude is still allowed to do arithmetic on the data, for example subtotals for one category, and those ad hoc figures are not independently checked.

## Debugging notes

- **Wrong flag name.** Inspecting the first real extraction output showed currency assumptions ("No currency stated; assumed INR") labelled `unit_assumed`. It is now a separate `currency_assumed` flag, and `unit_assumed` is used only for pack-size or unit assumptions. The fix is in the extraction engine, so it applies to every vendor.
- **Confidence without a value.** Fields where nothing was extracted were reported as `"high"` confidence, which is contradictory. Confidence is now `null` whenever the value is `null`. It is enforced in code after parsing the model output, so it holds even if the model returns a confidence for a missing value. Re-running vendor E took the count of such fields from 95 to 0.
- **Deploy-time crash: "DOMMatrix is not defined".** `/api/compare` imported `loadRfx` from `lib/extraction.ts`, which imports `lib/raw-content.ts`, which imported `pdf-parse` (and so `pdfjs-dist`, which needs browser globals) at the top. A route that only reads JSON was loading the PDF library. `loadRfx` now lives in `lib/rfx-load.ts`, and `pdf-parse` is loaded with a dynamic `import()` only when a PDF is parsed. The production build's traces for `/api/compare`, `/api/ask` and `/api/draft` contain no PDF libraries.

## Known limitations

- **The FX rate is a fixed assumption.** It is not a market rate, and Vendor C's prices (USD, ex-works Dubai, excluding freight and import duties) are only comparable to the INR vendors under it.
- **Drafting and comparison are not fully connected.** Vendor quotes exist only for the baseline fabricated RFx, so a freshly drafted RFx has no vendor data behind it. In production, confirming a draft would distribute the RFx to vendors and trigger fresh extraction as quotes arrive.
- **Single demo dataset.** The five vendor files are fabricated, not live vendor integrations.
- **Extraction accuracy has not been measured.** `data/ground-truth.json` holds the true prices behind the fabricated files, but no automated comparison against it has been run, and the project has no automated tests. The screens were checked by building the app and calling the libraries and API routes, not by browser testing.
- **Confirmed RFx is per browser.** It does not carry across devices or private windows.
