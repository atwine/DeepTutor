"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  listMaterials,
  listMyCourseUnits,
  materialDownloadUrl,
  type CourseMaterial,
  type CourseUnit,
} from "@/lib/course-units-api";
import { apiFetch } from "@/lib/api";
import { NotebookViewer } from "@/components/materials/NotebookViewer";
import {
  ArrowLeft,
  Download,
  Eye,
  FileText,
  Files,
  X,
} from "lucide-react";
import Link from "next/link";
import { formatDate as formatLocaleDate, type Language } from "@/lib/datetime";

function formatDate(iso: string, lang: Language): string {
  if (!iso) return "—";
  try {
    return formatLocaleDate(new Date(iso), lang);
  } catch {
    return "—";
  }
}

/** Human-readable file size, e.g. "1.2 MB". */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let size = bytes / 1024;
  let i = 0;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(1)} ${units[i]}`;
}

/** Map a file_type to a short label for the type badge. */
function fileTypeLabel(fileType: CourseMaterial["file_type"]): string {
  const labels: Record<CourseMaterial["file_type"], string> = {
    ipynb: "Notebook",
    pdf: "PDF",
    docx: "Word",
    pptx: "PowerPoint",
    xlsx: "Excel",
    md: "Markdown",
    txt: "Text",
    other: "File",
  };
  return labels[fileType] ?? "File";
}

export default function StudentMaterialsPage() {
  const params = useParams<{ courseUnitId: string }>();
  const courseUnitId = params.courseUnitId;
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language?.startsWith("zh") ? "zh" : "en";

  const [unit, setUnit] = useState<CourseUnit | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Notebook preview state
  const [previewMaterial, setPreviewMaterial] = useState<CourseMaterial | null>(null);
  const [notebook, setNotebook] = useState<unknown>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [unitList, mats] = await Promise.all([
        listMyCourseUnits(),
        listMaterials(courseUnitId),
      ]);
      setUnit(unitList.find((u) => u.id === courseUnitId) ?? null);
      setMaterials(mats);
    } catch (e) {
      // A 403 means the student isn't enrolled (or the unit is
      // archived/expired) — surface it gracefully instead of a raw error.
      setError(e instanceof Error ? e.message : t("Failed to load materials"));
    } finally {
      setLoading(false);
    }
  }, [courseUnitId, t]);

  useEffect(() => {
    fetchAuthStatus().then((status) => {
      if (!status?.authenticated) {
        router.replace("/login");
        return;
      }
      void load();
    });
  }, [router, load]);

  async function openPreview(material: CourseMaterial) {
    setPreviewMaterial(material);
    setNotebook(null);
    setPreviewError("");
    setPreviewLoading(true);
    try {
      const res = await apiFetch(materialDownloadUrl(courseUnitId, material.id));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail ?? t("Failed to load notebook"));
      }
      setNotebook(await res.json());
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : t("Failed to load notebook"));
    } finally {
      setPreviewLoading(false);
    }
  }

  function closePreview() {
    setPreviewMaterial(null);
    setNotebook(null);
    setPreviewError("");
  }

  return (
    <div className="h-screen overflow-y-auto bg-[var(--background)] px-4 py-10 [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8">
          <Link
            href="/courses/my"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            {t("Back to My Course Units")}
          </Link>
          <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
            {t("Course Materials")}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
            {unit ? unit.name : t("Loading…")}
            {unit?.term ? ` · ${unit.term}` : ""}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-[var(--muted-foreground)] shadow-sm">
            {t("Loading…")}
          </div>
        ) : error ? (
          <div className="flex items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] py-16 text-sm text-red-500 shadow-sm">
            {error}
          </div>
        ) : materials.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--card)] px-6 py-16 text-center shadow-sm">
            <Files
              size={28}
              strokeWidth={1.5}
              className="text-[var(--muted-foreground)]/50"
            />
            <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
              {t("No materials have been published yet")}
            </p>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">
              {t("Check back once your instructor uploads course materials.")}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {materials.map((m) => (
              <div
                key={m.id}
                className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <FileText
                    size={22}
                    strokeWidth={1.5}
                    className="mt-0.5 shrink-0 text-[var(--muted-foreground)]"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-[var(--foreground)]">
                      {m.filename}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      <span className="rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide">
                        {fileTypeLabel(m.file_type)}
                      </span>
                      {" · "}{formatSize(m.size_bytes)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                      {t("Published {{date}}", {
                        date: formatDate(m.published_at ?? m.uploaded_at, lang),
                      })}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  {m.file_type === "ipynb" && (
                    <button
                      onClick={() => void openPreview(m)}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                                 border border-[var(--border)] text-[var(--foreground)]
                                 hover:bg-[var(--background)] transition-colors"
                    >
                      <Eye size={14} />
                      {t("View")}
                    </button>
                  )}
                  <a
                    href={materialDownloadUrl(courseUnitId, m.id)}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                               border border-[var(--border)] text-[var(--foreground)]
                               hover:bg-[var(--background)] transition-colors"
                  >
                    <Download size={14} />
                    {t("Download")}
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notebook preview modal */}
      {previewMaterial && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] px-4"
          role="dialog"
          aria-modal="true"
          onClick={closePreview}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3">
              <h2 className="truncate text-base font-semibold text-[var(--foreground)]">
                {previewMaterial.filename}
              </h2>
              <button
                type="button"
                onClick={closePreview}
                className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]"
                aria-label={t("Close")}
              >
                <X size={16} />
              </button>
            </div>
            <div className="overflow-y-auto p-5">
              {previewLoading ? (
                <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
                  {t("Loading…")}
                </div>
              ) : previewError ? (
                <div className="flex items-center justify-center py-16 text-red-500 text-sm">
                  {previewError}
                </div>
              ) : (
                <NotebookViewer
                  notebook={notebook}
                  filename={previewMaterial.filename}
                  downloadUrl={materialDownloadUrl(courseUnitId, previewMaterial.id)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
