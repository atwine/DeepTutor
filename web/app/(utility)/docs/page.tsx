"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ChevronDown } from "lucide-react";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import { DOC_CATEGORIES, type DocTopic } from "@/lib/docs-content";

function DocCard({ topic }: { topic: DocTopic }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium text-[var(--foreground)]">
            {topic.title}
          </div>
          {!open && (
            <div className="mt-0.5 truncate text-xs text-[var(--muted-foreground)]">
              {topic.summary}
            </div>
          )}
        </div>
        <ChevronDown
          size={16}
          className={`shrink-0 text-[var(--muted-foreground)] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          <MarkdownRenderer content={topic.body} variant="compact" />
        </div>
      )}
    </div>
  );
}

export default function DocsPage() {
  const { t } = useTranslation();

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-6xl px-6 py-10 pb-16 md:px-10">
        <Link
          href="/home"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <ArrowLeft size={16} />
          {t("Back to Chat")}
        </Link>

        <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
          {t("How This Platform Works")}
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          {t(
            "Pick a topic below — nothing expands until you click it, so you only read what you need.",
          )}
        </p>

        <nav className="mt-5 flex flex-wrap gap-1.5">
          {DOC_CATEGORIES.map((cat) => (
            <a
              key={cat.id}
              href={`#${cat.id}`}
              className="rounded-full border border-[var(--border)] bg-[var(--card)] px-3 py-1 text-xs text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
            >
              {t(cat.label)}
            </a>
          ))}
        </nav>

        <div className="mt-8 space-y-8">
          {DOC_CATEGORIES.map((cat) => (
            <section key={cat.id} id={cat.id} className="scroll-mt-6">
              <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {t(cat.label)}
              </h2>
              <div className="space-y-2">
                {cat.topics.map((topic) => (
                  <DocCard key={topic.id} topic={topic} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
