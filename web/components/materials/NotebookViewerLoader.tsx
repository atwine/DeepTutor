"use client";

import { useMemo } from "react";
import { AlertCircle, FileCode2, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import NotebookViewer, {
  type NotebookViewerProps,
} from "./NotebookViewer";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NotebookViewerLoaderProps {
  /** The raw .ipynb file content as a JSON string, or already-parsed JSON. */
  notebook: string | object | null | undefined;
  /** Original filename for download/Colab buttons. */
  filename: string;
  /** Optional: URL to download the raw .ipynb file. */
  downloadUrl?: string;
  /** Optional: loading flag — when true a spinner is shown. */
  loading?: boolean;
  /** Optional: error message — when set an error state is shown. */
  error?: string | null;
  /** Optional: className for styling (passed through to NotebookViewer). */
  className?: string;
}

// ─── Internal state ─────────────────────────────────────────────────────────

type ParseState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "empty" }
  | { status: "ready"; notebook: any };

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Wrapper around {@link NotebookViewer} that handles loading, error, and
 * empty states. Accepts either a raw JSON string or an already-parsed object.
 *
 * When `loading` is true a spinner is shown regardless of the `notebook`
 * value. When `error` is set an error card is shown. Otherwise the notebook
 * is parsed (if a string) and rendered — or an empty state is shown if it
 * has no cells.
 */
export function NotebookViewerLoader({
  notebook,
  filename,
  downloadUrl,
  loading = false,
  error = null,
  className,
}: NotebookViewerLoaderProps) {
  const { t } = useTranslation();

  // Derive the parse state directly from props via useMemo. This avoids the
  // cascading-render pattern of setState-in-effect: the state is recomputed
  // only when the inputs change, and JSON.parse errors are caught here so
  // they surface as an error card instead of crashing the tree.
  const state = useMemo<ParseState>(() => {
    if (loading) return { status: "loading" };
    if (error) return { status: "error", message: error };
    if (notebook == null) return { status: "loading" };

    try {
      const parsed =
        typeof notebook === "string" ? JSON.parse(notebook) : notebook;
      const cells = parsed?.cells;
      if (!Array.isArray(cells) || cells.length === 0) {
        return { status: "empty" };
      }
      return { status: "ready", notebook: parsed };
    } catch (e) {
      return {
        status: "error",
        message:
          e instanceof Error ? e.message : t("Failed to parse notebook JSON"),
      };
    }
  }, [notebook, loading, error, t]);

  // ─── Loading ─────────────────────────────────────────────────────────────
  if (state.status === "loading") {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-16 text-center ${className || ""}`}
      >
        <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
        <span className="text-sm text-[var(--muted-foreground)]">
          {t("Loading notebook...")}
        </span>
      </div>
    );
  }

  // ─── Error ───────────────────────────────────────────────────────────────
  if (state.status === "error") {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-6 py-16 text-center ${className || ""}`}
      >
        <AlertCircle className="h-6 w-6 text-[var(--destructive)]" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-[var(--foreground)]">
            {t("Failed to load notebook")}
          </p>
          <p className="max-w-md text-xs text-[var(--muted-foreground)]">
            {state.message}
          </p>
        </div>
      </div>
    );
  }

  // ─── Empty ───────────────────────────────────────────────────────────────
  if (state.status === "empty") {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-16 text-center ${className || ""}`}
      >
        <FileCode2 className="h-6 w-6 text-[var(--muted-foreground)]/60" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-[var(--foreground)]">
            {t("Empty notebook")}
          </p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {t("This notebook has no cells to display.")}
          </p>
        </div>
      </div>
    );
  }

  // ─── Ready ───────────────────────────────────────────────────────────────
  const viewerProps: NotebookViewerProps = {
    notebook: state.notebook,
    filename,
    downloadUrl,
    className,
  };
  return <NotebookViewer {...viewerProps} />;
}

export default NotebookViewerLoader;
