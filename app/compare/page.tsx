"use client";

import { useEffect, useState } from "react";
import { getActiveRfx } from "@/lib/active-rfx-client";
import { bestPrice, priceConfidence } from "@/lib/compare-utils";
import type { ComparisonPayload } from "@/lib/compare-server";
import type { ExtractedLine, ExtractedVendorQuote, FlagType } from "@/lib/extraction-types";

const FLAG_LABEL: Record<FlagType, string> = {
  missing_line: "Missing",
  unit_mismatch: "Unit differs from RFx",
  currency_mismatch: "Not in INR",
  discount_applied: "Discount applied",
  snippet_unverified: "Snippet not found in document",
  fx_rate_missing: "No FX rate",
  unit_assumed: "Unit assumed",
  currency_assumed: "Currency assumed",
  not_returned_by_model: "Not returned by model",
};

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const CONF_STYLE = {
  high: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

function verifiedText(v: boolean | null) {
  if (v === true) return "found in the document text";
  if (v === false) return "NOT found in the document text";
  return "not checkable (image or no text to check against)";
}

export default function ComparePage() {
  const [data, setData] = useState<ComparisonPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ vendor: number; code: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rfx: getActiveRfx() }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Request failed");
        if (!cancelled) setData(body);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load"));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <main className="mx-auto max-w-3xl px-4 py-10 text-red-600">{error}</main>;
  if (!data) return <main className="mx-auto max-w-3xl px-4 py-10 text-zinc-500">Loading comparison...</main>;

  const { rfx, vendors, activeRfxMismatch } = data;
  const lineOf = (v: ExtractedVendorQuote, code: string) => v.lines.find((l) => l.itemCode === code);
  const sel = selected ? { vendor: vendors[selected.vendor], line: lineOf(vendors[selected.vendor], selected.code) } : null;

  return (
    <main className="mx-auto flex w-full max-w-[96rem] flex-col gap-4 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Vendor comparison</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {rfx.title} ({rfx.rfxId}). Prices are INR per unit. Click any cell to see where its number came from.
        </p>
      </div>

      {activeRfxMismatch && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Your active RFx ({activeRfxMismatch.activeTitle}, {activeRfxMismatch.activeRfxId}) has no vendor quotes: these quotes answer {activeRfxMismatch.answeredRfxId}, so the table shows that RFx.
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[72rem] border-collapse text-sm">
          <thead>
            <tr className="align-top">
              <th className="w-56 border-b p-2 text-left font-medium">Line item</th>
              {vendors.map((v) => (
                <th key={v.vendorId} className="w-48 border-b p-2 text-left font-normal">
                  <div className="font-semibold">{v.vendorName ?? v.vendorId}</div>
                  <div className="mb-1 text-xs text-zinc-500">
                    {v.sourceFile} · {v.summary.quoted}/{v.summary.lines} lines quoted
                  </div>
                  {v.discounts.map((d, i) => (
                    <p key={i} className="mb-1 rounded bg-blue-50 px-1.5 py-1 text-xs text-blue-900 dark:bg-blue-950 dark:text-blue-200">
                      Discount{d.percent !== null ? ` ${d.percent}%` : ""}: {d.description}
                      {d.conditions ? ` Condition: ${d.conditions}` : ""} {d.applied ? "(applied to prices below)" : "(not applied)"}
                    </p>
                  ))}
                  {v.quoteNotes.length > 0 && (
                    <ul className="list-disc pl-4 text-xs text-zinc-600 dark:text-zinc-400">
                      {v.quoteNotes.map((n, i) => (
                        <li key={i}>{n.text}</li>
                      ))}
                    </ul>
                  )}
                </th>
              ))}
              <th className="w-44 border-b p-2 text-left font-medium">Best price</th>
            </tr>
          </thead>
          <tbody>
            {rfx.items.map((item) => {
              const lines = vendors.map((v) => lineOf(v, item.itemCode));
              const best = bestPrice(lines);
              return (
                <tr key={item.itemCode} className="border-b align-top">
                  <td className="p-2">
                    <div className="font-mono text-xs text-zinc-500">{item.itemCode}</div>
                    <div>{item.description}</div>
                    <div className="text-xs text-zinc-500">Qty {item.quantity}</div>
                  </td>
                  {vendors.map((v, vi) => {
                    const line = lines[vi];
                    const price = line?.normalized?.unitPriceINR;
                    const conf = line ? priceConfidence(line) : null;
                    const win = best.winners.includes(vi);
                    const isSel = selected?.vendor === vi && selected.code === item.itemCode;
                    return (
                      <td key={v.vendorId} className="p-1">
                        <button
                          onClick={() => setSelected({ vendor: vi, code: item.itemCode })}
                          className={`flex h-full w-full flex-col items-start gap-1 rounded border p-2 text-left ${win ? "border-green-500 bg-green-50 dark:bg-green-950" : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-700"} ${isSel ? "ring-2 ring-blue-500" : ""}`}
                        >
                          {price != null && conf ? (
                            <>
                              <span className="font-semibold">{inr(price)}</span>
                              <span className="flex flex-wrap gap-1">
                                <span className={`rounded px-1.5 text-xs ${CONF_STYLE[conf]}`}>{conf}</span>
                                {line!.flags
                                  .filter((f) => f.type !== "missing_line")
                                  .map((f, i) => (
                                    <span key={i} className="rounded bg-zinc-100 px-1.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                                      {FLAG_LABEL[f.type]}
                                    </span>
                                  ))}
                              </span>
                              {win && <span className="text-xs font-medium text-green-700 dark:text-green-400">Lowest</span>}
                            </>
                          ) : (
                            <span className="text-zinc-400">Not quoted</span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                  <td className="p-2 text-sm">
                    {best.winners.length ? (
                      <>
                        <div className="font-medium">{inr(best.price!)}</div>
                        <div className="text-xs text-zinc-600 dark:text-zinc-400">{best.winners.map((i) => vendors[i].vendorName ?? vendors[i].vendorId).join(", ")}</div>
                        {best.cheaperLowConfidence && <div className="text-xs text-amber-700 dark:text-amber-400">A cheaper price exists but with low confidence.</div>}
                      </>
                    ) : (
                      <span className="text-xs text-zinc-500">No reliable winner (no high or medium confidence price)</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sel && selected && <Provenance vendor={sel.vendor} line={sel.line} onClose={() => setSelected(null)} />}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      {children}
    </section>
  );
}

function Snippet({ label, text, verified }: { label: string; text: string | null; verified: boolean | null }) {
  if (!text) return null;
  return (
    <div>
      <div className="text-xs text-zinc-500">
        {label}: {verifiedText(verified)}
      </div>
      <blockquote className="whitespace-pre-wrap break-words rounded bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-800">{text}</blockquote>
    </div>
  );
}

function Provenance({ vendor, line, onClose }: { vendor: ExtractedVendorQuote; line: ExtractedLine | undefined; onClose: () => void }) {
  const n = line?.normalized;
  const conf = line ? priceConfidence(line) : null;
  return (
    <aside className="fixed inset-y-0 right-0 z-10 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l bg-white p-4 text-sm shadow-xl dark:bg-zinc-950">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{vendor.vendorName ?? vendor.vendorId}</div>
          <div className="text-zinc-600 dark:text-zinc-400">
            {line ? `${line.itemCode} · ${line.rfxDescription}` : "Line not found in this vendor's extraction"}
          </div>
        </div>
        <button onClick={onClose} className="rounded border px-2 py-0.5 text-xs">
          Close
        </button>
      </div>

      {line && n && n.unitPriceINR !== null && (
        <>
          <Section title="Price shown">
            <div className="text-lg font-semibold">{inr(n.unitPriceINR)} per unit</div>
            {n.discountPercent > 0 && n.listUnitPriceINR !== null && (
              <div className="text-xs text-zinc-600 dark:text-zinc-400">
                List price {inr(n.listUnitPriceINR)} less {n.discountPercent}% quote-level discount
              </div>
            )}
          </Section>
          <Section title="Confidence">
            <div>
              Overall (weakest of the three): <span className={`rounded px-1.5 ${conf ? CONF_STYLE[conf] : ""}`}>{conf ?? "n/a"}</span>
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              Price: {line.unitPrice.confidence ?? "n/a"} · Currency: {line.currency.confidence ?? "not stated"} · Unit: {line.unit.confidence ?? "not stated"}
            </div>
          </Section>
          <Section title="Original value (before normalization)">
            <div>
              {n.original.amount.toLocaleString("en-IN")} {n.original.currency}
              {n.original.basis ? `, quoted ${n.original.basis}` : ", unit not stated"}
            </div>
          </Section>
          <Section title="How it was converted">
            {n.steps.length ? (
              <ol className="list-decimal pl-5">
                {n.steps.map((s, i) => (
                  <li key={i}>
                    {s.description} = {s.output.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                  </li>
                ))}
              </ol>
            ) : (
              <div>No conversion needed: already INR per unit.</div>
            )}
            {n.assumptions.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-zinc-600 dark:text-zinc-400">
                {n.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      {line && !n && (
        <Section title="Status">
          <div className="font-medium">Not quoted by this vendor</div>
        </Section>
      )}

      {line && (
        <Section title="Source in the vendor's document">
          <Snippet label="Price" text={line.unitPrice.sourceSnippet} verified={line.unitPrice.snippetVerified} />
          {line.unit.sourceSnippet && line.unit.sourceSnippet !== line.unitPrice.sourceSnippet && (
            <Snippet label="Unit" text={line.unit.sourceSnippet} verified={line.unit.snippetVerified} />
          )}
          {line.currency.sourceSnippet && line.currency.sourceSnippet !== line.unitPrice.sourceSnippet && (
            <Snippet label="Currency" text={line.currency.sourceSnippet} verified={line.currency.snippetVerified} />
          )}
          {!line.unitPrice.sourceSnippet && !line.unit.sourceSnippet && !line.currency.sourceSnippet && (
            <div className="text-zinc-500">No source text: nothing was extracted for this line.</div>
          )}
        </Section>
      )}

      {line && line.flags.length > 0 && (
        <Section title="Flags">
          <ul className="flex flex-col gap-1">
            {line.flags.map((f, i) => (
              <li key={i}>
                <span className="font-medium">{FLAG_LABEL[f.type]}</span> <span className="text-xs text-zinc-500">({f.source})</span>
                <div className="text-xs text-zinc-600 dark:text-zinc-400">{f.reason}</div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {line && line.notes.length > 0 && (
        <Section title="Vendor notes on this line">
          <ul className="flex flex-col gap-2">
            {line.notes.map((nt, i) => (
              <li key={i}>
                {nt.text}
                {nt.sourceSnippet && <div className="font-mono text-xs text-zinc-500">&ldquo;{nt.sourceSnippet}&rdquo;</div>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </aside>
  );
}
