"use client";

import { useState } from "react";
import { getActiveRfx } from "@/lib/active-rfx-client";
import type { AskResult } from "@/lib/ask";

type Entry = { question: string; result?: AskResult; error?: string };

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export default function AskPage() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    // earlier answered turns of this page session give follow-ups their context; nothing is stored
    const history = entries.filter((e) => e.result).slice(-6).map((e) => ({ question: e.question, answer: e.result!.answer }));
    setEntries((es) => [...es, { question: q }]);
    setQuestion("");
    setBusy(true);
    let patch: Partial<Entry>;
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, rfx: getActiveRfx() }),
      });
      const body = await res.json();
      patch = res.ok ? { result: body } : { error: body.error ?? "Request failed" };
    } catch (e) {
      patch = { error: e instanceof Error ? e.message : "Request failed" };
    }
    setEntries((es) => es.map((en, i) => (i === es.length - 1 ? { ...en, ...patch } : en)));
    setBusy(false);
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Ask about the comparison</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Answers come only from the extracted vendor data shown on the <a className="underline" href="/compare">comparison screen</a>. References like (see LAP-001) point to its rows.
      </p>

      {entries.map((e, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="max-w-[85%] self-end rounded-lg bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-zinc-100 dark:text-zinc-900">{e.question}</div>
          <div className="max-w-[95%] self-start rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
            {e.error && <p className="text-red-600">{e.error}</p>}
            {!e.error && !e.result && <p className="text-zinc-500">Thinking...</p>}
            {e.result && (
              <div className="flex flex-col gap-2">
                {e.result.answerable !== "yes" && (
                  <span className="self-start rounded bg-amber-100 px-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    {e.result.answerable === "partly" ? "Only partly answerable from the data" : "Not answerable from the data"}
                  </span>
                )}
                <p className="whitespace-pre-wrap">{e.result.answer}</p>
                {e.result.limitations.length > 0 && (
                  <ul className="list-disc pl-5 text-xs text-amber-800 dark:text-amber-300">
                    {e.result.limitations.map((l, j) => (
                      <li key={j}>{l}</li>
                    ))}
                  </ul>
                )}
                {e.result.citations.length > 0 && (
                  <div className="flex flex-wrap gap-1 border-t border-zinc-300 pt-2 dark:border-zinc-700">
                    <span className="text-xs text-zinc-500">Sources:</span>
                    {e.result.citations.map((c, j) => (
                      <span key={j} className="rounded bg-white px-1.5 text-xs dark:bg-zinc-900" title={c.description}>
                        {c.vendorId ? `${c.vendorId} · ` : ""}
                        {c.itemCode}
                        {c.priceINR !== null ? ` · ${inr(c.priceINR)}` : c.vendorId ? " · not quoted" : ""}
                        {c.confidence ? ` · ${c.confidence}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ))}

      <form
        className="flex gap-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          ask();
        }}
      >
        <input
          className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          placeholder="e.g. Which vendor is cheapest overall for laptops?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" disabled={busy || !question.trim()} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900">
          {busy ? "Asking..." : "Ask"}
        </button>
      </form>
    </main>
  );
}
