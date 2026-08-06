"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  ChevronDown,
  Search,
  Compass,
  GraduationCap,
  ClipboardList,
  ShieldCheck,
  Sparkles,
  LifeBuoy,
  type LucideIcon,
} from "lucide-react";
import MarkdownRenderer from "@/components/common/MarkdownRenderer";
import { DOC_CATEGORIES, type DocCategory, type DocTopic } from "@/lib/docs-content";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Compass,
  GraduationCap,
  ClipboardList,
  ShieldCheck,
  Sparkles,
  LifeBuoy,
};

function DocCard({ topic, defaultOpen }: { topic: DocTopic; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-sm transition-colors hover:border-[var(--foreground)]/15">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-5 py-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--foreground)]/25"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-[var(--foreground)]">
            {topic.title}
          </div>
          {!open && (
            <div className="mt-1 truncate text-[13px] text-[var(--muted-foreground)]">
              {topic.summary}
            </div>
          )}
        </div>
        <ChevronDown
          size={16}
          className={`shrink-0 text-[var(--muted-foreground)] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-5 py-4">
          <MarkdownRenderer content={topic.body} variant="default" />
        </div>
      )}
    </div>
  );
}

function CategoryCard({ category }: { category: DocCategory }) {
  const Icon = CATEGORY_ICONS[category.icon] ?? Compass;
  return (
    <a
      href={`#${category.id}`}
      className="group flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm outline-none transition-all hover:-translate-y-0.5 hover:border-[var(--foreground)]/20 hover:shadow-md focus-visible:ring-2 focus-visible:ring-[var(--foreground)]/25"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--foreground)]/5 text-[var(--foreground)] transition-colors group-hover:bg-[var(--foreground)]/10">
        <Icon size={18} strokeWidth={1.75} />
      </div>
      <div>
        <div className="font-serif text-[15px] font-medium text-[var(--foreground)]">
          {category.label}
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-[var(--muted-foreground)]">
          {category.description}
        </p>
      </div>
    </a>
  );
}

export default function DocsPage() {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();

  const searchResults = useMemo(() => {
    if (!normalizedQuery) return null;
    const matches: { category: DocCategory; topic: DocTopic }[] = [];
    for (const category of DOC_CATEGORIES) {
      for (const topic of category.topics) {
        const haystack = `${topic.title} ${topic.summary} ${topic.body}`.toLowerCase();
        if (haystack.includes(normalizedQuery)) {
          matches.push({ category, topic });
        }
      }
    }
    return matches;
  }, [normalizedQuery]);

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-6xl px-6 py-10 pb-20 md:px-10">
        <Link
          href="/home"
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          <ArrowLeft size={16} />
          {t("Back to Chat")}
        </Link>

        <h1 className="font-serif text-3xl font-semibold tracking-tight text-[var(--foreground)]">
          {t("How This Platform Works")}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[var(--muted-foreground)]">
          {t(
            "Everything you need to find your way around — organized by what you're trying to do, not by feature name.",
          )}
        </p>

        <div className="relative mt-8 max-w-md">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search the docs...")}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--card)] py-2.5 pl-10 pr-4 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--muted-foreground)] focus:border-[var(--foreground)]/30 focus:ring-2 focus:ring-[var(--foreground)]/10"
          />
        </div>

        {searchResults ? (
          <div className="mt-10">
            <div className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              {searchResults.length
                ? t("{{count}} result(s)", { count: searchResults.length })
                : t("No results")}
            </div>
            {searchResults.length === 0 ? (
              <p className="text-sm text-[var(--muted-foreground)]">
                {t("Try a different word, or browse by category below.")}
              </p>
            ) : (
              <div className="space-y-3">
                {searchResults.map(({ category, topic }) => (
                  <div key={topic.id}>
                    <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      {category.label}
                    </div>
                    <DocCard topic={topic} defaultOpen />
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {DOC_CATEGORIES.map((cat) => (
                <CategoryCard key={cat.id} category={cat} />
              ))}
            </div>

            <div className="mt-16 space-y-14">
              {DOC_CATEGORIES.map((cat) => {
                const Icon = CATEGORY_ICONS[cat.icon] ?? Compass;
                return (
                  <section key={cat.id} id={cat.id} className="scroll-mt-6">
                    <div className="mb-4 flex items-center gap-2.5 border-b border-[var(--border)] pb-3">
                      <Icon size={17} strokeWidth={1.75} className="text-[var(--muted-foreground)]" />
                      <h2 className="font-serif text-lg font-medium text-[var(--foreground)]">
                        {t(cat.label)}
                      </h2>
                    </div>
                    <div className="space-y-3">
                      {cat.topics.map((topic) => (
                        <DocCard key={topic.id} topic={topic} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
