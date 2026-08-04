"use client";

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Issue #42: Reusable server-side pagination control.
 *
 * Renders prev/next + first/last buttons and a "X–Y of Z" summary.
 * Designed for endpoints that return {items, total, limit, offset}.
 * The parent owns the page state — this component is presentational only.
 */
export default function Pagination({
  total,
  limit,
  offset,
  onPageChange,
  disabled = false,
}: {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (newOffset: number) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + limit, total);

  const goTo = (page: number) => {
    const newOffset = Math.max(0, Math.min((page - 1) * limit, (totalPages - 1) * limit));
    onPageChange(newOffset);
  };

  if (total === 0) return null;

  const btnBase =
    "flex items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted-foreground)] " +
    "hover:text-[var(--foreground)] hover:bg-[var(--card)] disabled:opacity-40 disabled:cursor-not-allowed " +
    "transition-colors";

  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-[var(--border)] text-xs text-[var(--muted-foreground)]">
      <span>
        {t("Showing {{from}}–{{to}} of {{total}}", {
          from: showingFrom,
          to: showingTo,
          total,
        })}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => goTo(1)}
          disabled={disabled || currentPage === 1}
          className={`${btnBase} h-8 w-8`}
          aria-label={t("First page")}
          title={t("First page")}
        >
          <ChevronsLeft size={14} />
        </button>
        <button
          onClick={() => goTo(currentPage - 1)}
          disabled={disabled || currentPage === 1}
          className={`${btnBase} h-8 w-8`}
          aria-label={t("Previous page")}
          title={t("Previous page")}
        >
          <ChevronLeft size={14} />
        </button>
        <span className="px-2 tabular-nums">
          {currentPage} / {totalPages}
        </span>
        <button
          onClick={() => goTo(currentPage + 1)}
          disabled={disabled || currentPage === totalPages}
          className={`${btnBase} h-8 w-8`}
          aria-label={t("Next page")}
          title={t("Next page")}
        >
          <ChevronRight size={14} />
        </button>
        <button
          onClick={() => goTo(totalPages)}
          disabled={disabled || currentPage === totalPages}
          className={`${btnBase} h-8 w-8`}
          aria-label={t("Last page")}
          title={t("Last page")}
        >
          <ChevronsRight size={14} />
        </button>
      </div>
    </div>
  );
}
