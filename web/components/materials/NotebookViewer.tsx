"use client";

import React, { useCallback, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { Download, ExternalLink, FileCode2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import "katex/dist/katex.min.css";
import {
  getCodeBlockTheme,
  getCodeBlockThemeBackground,
} from "@/components/common/code-block-themes";
import { useAppShell } from "@/context/AppShellContext";
import { markdownUrlTransform } from "@/lib/markdown-display";

// ─── Types ──────────────────────────────────────────────────────────────────

/** A single Jupyter notebook cell in the nbformat v4 structure. */
interface NotebookCell {
  cell_type: "markdown" | "code" | "raw";
  source: string | string[];
  outputs?: NotebookOutput[];
  metadata?: Record<string, unknown>;
}

/** A code-cell output entry (nbformat v4). */
interface NotebookOutput {
  output_type: string;
  data?: Record<string, string | string[]>;
  text?: string | string[];
  name?: string;
}

/** The minimal shape of a parsed .ipynb file we render. */
interface NotebookJson {
  cells?: NotebookCell[];
  nbformat?: number;
  nbformat_minor?: number;
  metadata?: Record<string, unknown>;
}

export interface NotebookViewerProps {
  /** Notebook content as parsed JSON (the .ipynb file parsed as JSON) */
  notebook: any;
  /** Original filename for download/Colab buttons */
  filename: string;
  /** Optional: URL to download the raw .ipynb file */
  downloadUrl?: string;
  /** Optional: className for styling */
  className?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MONOSPACE =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/** nbformat stores `source` as either a string or an array of line strings. */
function cellSourceToString(source: string | string[] | undefined): string {
  if (!source) return "";
  if (typeof source === "string") return source;
  // The array form splits on lines *with* trailing newlines, so a plain join
  // reconstructs the original text faithfully.
  return source.join("");
}

/** Concatenate text-like output data into a single string. */
function outputTextToString(
  text: string | string[] | undefined,
): string {
  if (!text) return "";
  if (typeof text === "string") return text;
  return text.join("");
}

/** Detect whether an output entry is an image/base64 output we skip in v1. */
function isImageOutput(output: NotebookOutput): boolean {
  if (!output.data) return false;
  return Object.keys(output.data).some((mime) =>
    mime.startsWith("image/"),
  );
}

// ─── Markdown cell ──────────────────────────────────────────────────────────

function MarkdownCell({ source }: { source: string }) {
  const components = useMemo<Record<string, React.ComponentType<any>>>(
    () => ({
      // Render fenced code blocks with syntax highlighting so markdown cells
      // that embed snippets look consistent with code cells.
      code({ className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || "");
        const raw = String(children).replace(/\n$/, "");
        if (match) {
          return (
            <CodeBlock lang={match[1]} raw={raw} />
          );
        }
        return (
          <code
            className="rounded bg-[var(--muted)] px-1 py-0.5 font-mono text-[0.9em] text-[var(--foreground)]"
            {...props}
          >
            {children}
          </code>
        );
      },
      a({ children, href, ...props }: any) {
        return (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--primary)] underline underline-offset-2 hover:opacity-80"
            {...props}
          >
            {children}
          </a>
        );
      },
    }),
    [],
  );

  return (
    <div className="notebook-md-cell overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] px-5 py-4 text-[var(--foreground)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeRaw]}
        urlTransform={markdownUrlTransform}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

// ─── Code block (shared by code cells & markdown fences) ────────────────────

function CodeBlock({ lang, raw }: { lang: string; raw: string }) {
  const { codeBlockTheme, codeBlockShowLineNumbers, codeBlockWrapLongLines } =
    useAppShell();
  const syntaxTheme = getCodeBlockTheme(codeBlockTheme);
  const backgroundColor =
    getCodeBlockThemeBackground(syntaxTheme) ?? "#1f2937";

  // Extract foreground color from the theme for the language label.
  const codeStyle = syntaxTheme['code[class*="language-"]'];
  const textColor =
    (codeStyle && typeof codeStyle.color === "string" && codeStyle.color) ||
    "#e5e7eb";

  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--border)]"
      style={{ backgroundColor }}
    >
      {lang && (
        <div
          className="border-b border-white/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider"
          style={{ color: textColor, opacity: 0.7 }}
        >
          {lang}
        </div>
      )}
      <SyntaxHighlighter
        language={lang || "text"}
        style={syntaxTheme}
        PreTag="pre"
        customStyle={{
          margin: 0,
          borderRadius: 0,
          background: backgroundColor,
          padding: "1rem",
          fontSize: "0.85rem",
          lineHeight: "1.6",
          overflowX: codeBlockWrapLongLines ? "hidden" : "auto",
          whiteSpace: codeBlockWrapLongLines ? "pre-wrap" : "pre",
          wordWrap: codeBlockWrapLongLines ? "break-word" : "normal",
        }}
        codeTagProps={{
          style: { fontFamily: MONOSPACE },
        }}
        showLineNumbers={codeBlockShowLineNumbers}
        wrapLongLines={codeBlockWrapLongLines}
      >
        {raw}
      </SyntaxHighlighter>
    </div>
  );
}

// ─── Code cell ──────────────────────────────────────────────────────────────

function CodeCell({ cell }: { cell: NotebookCell }) {
  const { t } = useTranslation();
  const source = cellSourceToString(cell.source);
  const outputs = cell.outputs ?? [];

  return (
    <div className="notebook-code-cell space-y-2">
      <CodeBlock lang="python" raw={source} />
      {outputs.length > 0 && (
        <div className="space-y-1.5">
          {outputs.map((output, idx) => (
            <OutputView key={idx} output={output} index={idx} t={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Output view ────────────────────────────────────────────────────────────

function OutputView({
  output,
  index,
  t,
}: {
  output: NotebookOutput;
  index: number;
  t: (key: string) => string;
}) {
  // v1: skip image / base64 outputs with a placeholder.
  if (isImageOutput(output)) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
        {t("Image output (not rendered in v1)")}
      </div>
    );
  }

  // Stream output (stdout/stderr) — `text` field.
  if (output.output_type === "stream" && output.text) {
    const text = outputTextToString(output.text);
    return (
      <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 font-mono text-[0.8rem] leading-relaxed text-[var(--foreground)]">
        {text}
      </pre>
    );
  }

  // Execute result / display data — look in `data` for text/plain.
  if (output.data) {
    const plain = output.data["text/plain"];
    if (plain) {
      const text = outputTextToString(plain as string | string[]);
      return (
        <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 font-mono text-[0.8rem] leading-relaxed text-[var(--foreground)]">
          {text}
        </pre>
      );
    }
    // HTML output
    const html = output.data["text/html"];
    if (html) {
      const htmlStr = outputTextToString(html as string | string[]);
      return (
        <div
          className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 text-sm text-[var(--foreground)]"
          dangerouslySetInnerHTML={{ __html: htmlStr }}
        />
      );
    }
  }

  // Error output — traceback in `traceback` field.
  if (output.output_type === "error") {
    const traceback = (output as any).traceback;
    if (Array.isArray(traceback)) {
      return (
        <pre className="overflow-x-auto rounded-lg border border-[var(--destructive)]/30 bg-[var(--destructive)]/5 px-4 py-2.5 font-mono text-[0.8rem] leading-relaxed text-[var(--destructive)]">
          {traceback.join("\n")}
        </pre>
      );
    }
  }

  // Fallback for unknown output types.
  const fallbackText = outputTextToString(output.text);
  if (fallbackText) {
    return (
      <pre className="overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--muted)]/40 px-4 py-2.5 font-mono text-[0.8rem] leading-relaxed text-[var(--foreground)]">
        {fallbackText}
      </pre>
    );
  }

  return null;
}

// ─── Main component ─────────────────────────────────────────────────────────

export function NotebookViewer({
  notebook,
  filename,
  downloadUrl,
  className,
}: NotebookViewerProps) {
  const { t } = useTranslation();
  const nb = notebook as NotebookJson;
  const cells = nb?.cells ?? [];

  // "Open in Colab" — for v1 we link to the Colab homepage. A full upload
  // flow (data URI / GitHub URL) can be layered on later.
  const colabUrl = "https://colab.research.google.com/";

  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = filename || "notebook.ipynb";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [downloadUrl, filename]);

  return (
    <div
      className={`notebook-viewer flex h-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--background)] ${className || ""}`}
    >
      {/* Header — toolbar with filename + action buttons */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0 text-[var(--muted-foreground)]" />
          <span className="truncate text-sm font-medium text-[var(--foreground)]">
            {filename}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted-foreground)]">
            {cells.length} {cells.length === 1 ? t("cell") : t("cells")}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {downloadUrl && (
            <button
              type="button"
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 text-xs font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
            >
              <Download className="h-3.5 w-3.5" />
              {t("Download .ipynb")}
            </button>
          )}
          <a
            href={colabUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t("Open in Colab")}
          </a>
        </div>
      </div>

      {/* Body — scrollable cell list */}
      <div className="notebook-body flex-1 space-y-3 overflow-y-auto p-4">
        {cells.map((cell, idx) => {
          if (cell.cell_type === "markdown") {
            return (
              <MarkdownCell
                key={idx}
                source={cellSourceToString(cell.source)}
              />
            );
          }
          if (cell.cell_type === "code") {
            return <CodeCell key={idx} cell={cell} />;
          }
          // Raw cells — render as plain text in a muted block.
          if (cell.cell_type === "raw") {
            return (
              <pre
                key={idx}
                className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--muted)]/30 px-5 py-4 font-mono text-[0.85rem] text-[var(--muted-foreground)]"
              >
                {cellSourceToString(cell.source)}
              </pre>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

export default NotebookViewer;
