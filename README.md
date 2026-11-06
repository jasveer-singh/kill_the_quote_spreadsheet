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

## Environment

`ANTHROPIC_API_KEY` is required once extraction is built.
