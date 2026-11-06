"use client";

import { useState } from "react";
import { setActiveRfx } from "@/lib/active-rfx-client";
import type { Rfx } from "@/lib/rfx-types";

type Turn = { role: "buyer" | "assistant"; text: string };

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export default function DraftPage() {
  const [need, setNeed] = useState("");
  const [answer, setAnswer] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [draft, setDraft] = useState<Rfx | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const started = turns.length > 0;

  async function run(clarification?: { question: string; answer: string }) {
    setBusy(true);
    setError(null);
    try {
      const res = await post<{ status: "needs_clarification"; question: string } | { status: "drafted"; rfx: Rfx }>(
        "/api/draft",
        { input: need, clarification },
      );
      if (res.status === "needs_clarification") {
        setQuestion(res.question);
        setTurns((t) => [...t, { role: "assistant", text: res.question }]);
      } else {
        setQuestion(null);
        setDraft(res.rfx);
        setTurns((t) => [...t, { role: "assistant", text: `Drafted ${res.rfx.items.length} line item(s). Review and edit below, then confirm.` }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function generate() {
    setTurns([{ role: "buyer", text: need }]);
    setDraft(null);
    setSaved(false);
    run();
  }

  function submitAnswer() {
    if (!question) return;
    setTurns((t) => [...t, { role: "buyer", text: answer }]);
    run({ question, answer });
  }

  function editItem(index: number, patch: Partial<Rfx["items"][number]>) {
    setSaved(false);
    setDraft((d) => d && { ...d, items: d.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  }

  function confirm() {
    if (!draft) return;
    setError(null);
    if (setActiveRfx(draft)) setSaved(true);
    else setError("Could not save: browser storage is unavailable or an item is invalid (check codes are unique and quantities are whole numbers).");
  }

  const input = "rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
  const button = "rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-10">
      <h1 className="text-2xl font-semibold">Draft an RFx</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">Describe what you need to buy. If something essential is missing I will ask one question, then draft.</p>

      {turns.map((t, i) => (
        <div key={i} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${t.role === "buyer" ? "self-end bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "self-start bg-zinc-100 dark:bg-zinc-800"}`}>
          {t.text}
        </div>
      ))}

      {!started && (
        <div className="flex flex-col gap-2">
          <textarea
            className={`${input} min-h-28`}
            placeholder="e.g. I need 120 business laptops, 14-inch, Intel i5 or better, delivered by end of quarter, budget-conscious"
            value={need}
            onChange={(e) => setNeed(e.target.value)}
          />
          <button className={`${button} self-end`} disabled={busy || !need.trim()} onClick={generate}>
            {busy ? "Generating..." : "Generate RFx"}
          </button>
        </div>
      )}

      {question && (
        <div className="flex gap-2">
          <input className={`${input} flex-1`} placeholder="Your answer" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <button className={button} disabled={busy || !answer.trim()} onClick={submitAnswer}>
            {busy ? "Drafting..." : "Send"}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {draft && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">{draft.title}</h2>
          <ul className="flex flex-col gap-3">
            {draft.items.map((it, i) => (
              <li key={i} className="flex flex-col gap-1 rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <div className="flex flex-wrap gap-2">
                  <input aria-label="Item code" className={`${input} w-28 font-mono`} value={it.itemCode} onChange={(e) => editItem(i, { itemCode: e.target.value })} />
                  <input aria-label="Description" className={`${input} min-w-48 flex-1`} value={it.description} onChange={(e) => editItem(i, { description: e.target.value })} />
                  <input
                    aria-label="Quantity"
                    type="number"
                    min={1}
                    className={`${input} w-24`}
                    value={it.quantity}
                    onChange={(e) => editItem(i, { quantity: Number(e.target.value) })}
                  />
                </div>
                <p className="text-xs text-zinc-500">{it.spec}</p>
              </li>
            ))}
          </ul>
          <button className={`${button} self-end`} disabled={busy || saved} onClick={confirm}>
            {saved ? "Confirmed" : "Confirm draft"}
          </button>
          {saved && <p className="text-sm text-green-700">Saved in this browser as the active RFx.</p>}
        </section>
      )}
    </main>
  );
}
