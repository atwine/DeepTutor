"use client";

import { useTranslation } from "react-i18next";
import { FileCode2 } from "lucide-react";

/** Minimal stub — the real NotebookViewer is built in a parallel PR
 * (feature/notebook-viewer) and will overwrite this file when merged.
 * This stub exists only so typecheck passes in this branch. */
export interface NotebookViewerProps {
  notebook: any;
  filename: string;
  downloadUrl?: string;
  className?: string;
}

export function NotebookViewer({ filename, downloadUrl, className }: NotebookViewerProps) {
  const { t } = useTranslation();
  return (
    <div className={className ?? ""}>
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FileCode2 size={28} strokeWidth={1.5} className="text-[var(--muted-foreground)]/50" />
        <p className="mt-3 text-sm font-medium text-[var(--foreground)]">{filename}</p>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t("Notebook viewer loading…")}</p>
        {downloadUrl && (
          <a
            href={downloadUrl}
            className="mt-3 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            {t("Download")} ↓
          </a>
        )}
      </div>
    </div>
  );
}