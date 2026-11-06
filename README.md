# kill-the-quote-spreadsheet

> TODO: fill in (problem, approach, demo, deploy notes).

## Structure

| Path | Purpose |
| --- | --- |
| `app/` | Next.js App Router (no UI built yet) |
| `lib/` | Shared code and types (`rfx-types.ts`) |
| `data/` | Generated RFx, ground truth, and `vendor-responses/` |
| `scripts/` | `generate-dataset.ts` dataset fabricator |

## Dataset

```bash
npm run generate:dataset
```

Regenerates `data/rfx.json`, `data/rfx-template.xlsx`, `data/ground-truth.json` and the five vendor files in `data/vendor-responses/`. Output is deterministic (seeded).

## Extraction

```bash
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local   # gitignored
npm run extract                 # all vendors -> data/extracted/<vendor>.json
npm run extract -- vendor-a     # one vendor
```

`lib/extraction.ts` (`extractVendorQuote`) is the reusable entry point: raw content extraction (`lib/raw-content.ts`), a live Claude call using structured outputs, then normalization to INR per unit (`lib/normalize.ts`). Defaults (model `claude-sonnet-5-5`, USD to INR = 83) live in `lib/config.ts`; the FX rate is an assumption and is recorded on every converted line.
