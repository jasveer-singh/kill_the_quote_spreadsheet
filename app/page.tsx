import Link from "next/link";

const SCREENS = [
  { href: "/draft", label: "Draft an RFx" },
  { href: "/compare", label: "Vendor Comparison" },
  { href: "/ask", label: "Ask a Question" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-16">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Kill the Quote Spreadsheet</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          An AI-native procurement assistant: draft an RFx, compare vendor quotes, and ask questions about the comparison.
        </p>
      </div>
      <nav className="flex flex-col gap-3">
        {SCREENS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded border border-zinc-300 px-4 py-3 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {s.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}
