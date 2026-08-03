"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { fetchAuthStatus } from "@/lib/auth";
import {
  deleteMaterial,
  listCourseUnits,
  listMaterials,
  materialDownloadUrl,
  publishMaterial,
  unpublishMaterial,
  uploadMaterials,
  type CourseMaterial,
  type CourseUnit,
} from "@/lib/course-units-api";
import { apiFetch } from "@/lib/api";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { NotebookViewer } from "@/components/materials/NotebookViewer";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileText,
  Files,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Upload,
  X,
  XCircle,
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

function StatusBadge({ status }: { status: CourseMaterial["status"] }) {
  const { t } = useTranslation();
  if (status === "published") {
    return (
      <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        {t("Published")}
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-[var(--muted)]/60 px-2 py-0.5 text-[11px] font-medium text-[var(--muted-foreground)]">
      {t("Draft")}
    </span>
  );
}

function IngestionBadge({
  status,
}: {
  status: CourseMaterial["ingestion_status"];
}) {
  const { t } = useTranslation();
  if (status === "ready") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={12} />
        {t("Ready")}
      </span>
    );
  }
  if (status === "indexing") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-blue-600 dark:text-blue-400">
        <Loader2 size={12} className="animate-spin" />
        {t("Indexing")}
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-red-600 dark:text-red-400">
        <XCircle size={12} />
        {t("Failed")}
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[11px] font-medium text-[var(--muted-foreground)]">
      {t("Pending")}
    </span>
  );
}

export default function CourseUnitMaterialsPage() {
  const params = useParams<{ courseUnitId: string }>();
  const courseUnitId = params.courseUnitId;
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const lang: Language = i18n.language?.startsWith("zh") ? "zh" : "en";

  const [unit, setUnit] = useState<CourseUnit | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  // Upload state
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const depthRef = useRef(0);

  // Per-row action busy state
  const [publishBusyId, setPublishBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CourseMaterial | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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
        listCourseUnits(),
        listMaterials(courseUnitId),
      ]);
      setUnit(unitList.find((u) => u.id === courseUnitId) ?? null);
      setMaterials(mats);
    } catch (e) {
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
      if (status.role !== "admin" && status.role !== "instructor") {
        router.replace("/");
        return;
      }
      void load();
    });
  }, [router, load]);

  // --- Upload helpers ---

  function addFiles(incoming: File[]) {
    const existing = new Map(selectedFiles.map((f) => [f.name + f.size, f]));
    for (const f of incoming) {
      existing.set(f.name + f.size, f);
    }
    setSelectedFiles(Array.from(existing.values()));
  }

  function removeFile(file: File) {
    setSelectedFiles((prev) => prev.filter((f) => f !== file));
  }

  function handleDragEnter(e: DragEvent<HTMLElement>) {
    if (uploading) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    depthRef.current += 1;
    setDropActive(true);
  }

  function handleDragOver(e: DragEvent<HTMLElement>) {
    if (uploading) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: DragEvent<HTMLElement>) {
    if (uploading) return;
    e.preventDefault();
    e.stopPropagation();
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDropActive(false);
  }

  function handleDrop(e: DragEvent<HTMLElement>) {
    if (uploading) return;
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    e.stopPropagation();
    setDropActive(false);
    depthRef.current = 0;
    const dropped = Array.from(e.dataTransfer.files || []);
    if (dropped.length) addFiles(dropped);
  }

  async function handleUpload() {
    if (uploading || selectedFiles.length === 0) return;
    setUploading(true);
    setUploadError("");
    try {
      await uploadMaterials(courseUnitId, selectedFiles);
      setSelectedFiles([]);
      if (inputRef.current) inputRef.current.value = "";
      await load();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : t("Failed to upload"));
    } finally {
      setUploading(false);
    }
  }

  // --- Material actions ---

  async function handlePublish(material: CourseMaterial) {
    if (publishBusyId) return;
    setPublishBusyId(material.id);
    setActionError("");
    try {
      const updated = await publishMaterial(courseUnitId, material.id);
      setMaterials((prev) => prev.map((m) => (m.id === material.id ? updated : m)));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to publish"));
    } finally {
      setPublishBusyId(null);
    }
  }

  async function handleUnpublish(material: CourseMaterial) {
    if (publishBusyId) return;
    setPublishBusyId(material.id);
    setActionError("");
    try {
      const updated = await unpublishMaterial(courseUnitId, material.id);
      setMaterials((prev) => prev.map((m) => (m.id === material.id ? updated : m)));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to unpublish"));
    } finally {
      setPublishBusyId(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget || deleteBusy) return;
    setDeleteBusy(true);
    setActionError("");
    try {
      await deleteMaterial(courseUnitId, deleteTarget.id);
      setMaterials((prev) => prev.filter((m) => m.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("Failed to delete"));
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  }

  // --- Notebook preview ---

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
            href="/admin/course-units"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            <ArrowLeft size={16} />
            {t("Back to Course Units")}
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-serif text-xl font-semibold text-[var(--foreground)]">
                {t("Course Materials")}
              </h1>
              <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                {unit ? unit.name : t("Loading…")}
                {unit?.term ? ` · ${unit.term}` : ""}
              </p>
            </div>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm
                         border border-[var(--border)] text-[var(--muted-foreground)]
                         hover:text-[var(--foreground)] hover:bg-[var(--card)]
                         disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {t("Refresh")}
            </button>
          </div>
        </div>

        {/* Upload zone */}
        <div className="mb-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            disabled={uploading}
            className={`group flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-5 py-7 text-center transition-colors ${
              dropActive
                ? "border-sky-400 bg-sky-50/60 dark:border-sky-700 dark:bg-sky-950/20"
                : "border-[var(--border)] bg-[var(--background)] hover:border-[var(--foreground)]/25 hover:bg-[var(--muted)]/40"
            } ${uploading ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <Files className="h-5 w-5 text-[var(--muted-foreground)] transition-colors group-hover:text-[var(--foreground)]" />
            <div className="space-y-1">
              <div className="text-[13px] font-medium text-[var(--foreground)]">
                {dropActive
                  ? t("Drop files to add them")
                  : t("Choose files to upload")}
              </div>
              <p className="text-[11px] text-[var(--muted-foreground)]">
                {t("Click to browse or drag and drop")}
              </p>
            </div>
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files || []);
              e.target.value = "";
              if (picked.length) addFiles(picked);
            }}
          />

          {selectedFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              {selectedFiles.map((file) => (
                <div
                  key={file.name + file.size}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={15} className="shrink-0 text-[var(--muted-foreground)]" />
                    <span className="truncate text-sm text-[var(--foreground)]">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                      {formatSize(file.size)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(file)}
                    disabled={uploading}
                    className="rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSelectedFiles([])}
                  disabled={uploading}
                  className="rounded-lg px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  {t("Clear")}
                </button>
                <button
                  type="button"
                  onClick={() => void handleUpload()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--foreground)] px-3 py-1.5 text-sm font-medium text-[var(--background)] hover:opacity-90 disabled:opacity-40"
                >
                  {uploading ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Upload size={14} />
                  )}
                  {uploading ? t("Uploading…") : t("Upload")}
                </button>
              </div>
            </div>
          )}

          {uploadError && (
            <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
              {uploadError}
            </div>
          )}
        </div>

        {actionError && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
            {actionError}
          </div>
        )}

        {/* Materials list */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] overflow-hidden shadow-sm">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-[var(--muted-foreground)]">
              {t("Loading…")}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-16 text-red-500 text-sm">
              {error}
            </div>
          ) : materials.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <Files
                size={28}
                strokeWidth={1.5}
                className="text-[var(--muted-foreground)]/50"
              />
              <p className="mt-3 text-sm font-medium text-[var(--foreground)]">
                {t("No materials yet")}
              </p>
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                {t("Upload files above to get started.")}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {materials.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center justify-between gap-3 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <FileText size={15} className="shrink-0 text-[var(--muted-foreground)]" />
                      <p className="truncate font-medium text-[var(--foreground)]">
                        {m.filename}
                      </p>
                      <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-wide text-[var(--muted-foreground)]">
                        {fileTypeLabel(m.file_type)}
                      </span>
                      <StatusBadge status={m.status} />
                      <IngestionBadge status={m.ingestion_status} />
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                      {formatSize(m.size_bytes)}
                      {" · "}{t("uploaded {{date}}", { date: formatDate(m.uploaded_at, lang) })}
                      {m.published_at
                        ? ` · ${t("published {{date}}", { date: formatDate(m.published_at, lang) })}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {m.file_type === "ipynb" && (
                      <button
                        onClick={() => void openPreview(m)}
                        title={t("Preview notebook")}
                        className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                   hover:bg-[var(--background)] hover:text-[var(--foreground)] transition-colors"
                      >
                        <Eye size={15} />
                      </button>
                    )}
                    {m.status === "draft" && (
                      <button
                        onClick={() => void handlePublish(m)}
                        disabled={publishBusyId === m.id}
                        title={t("Publish")}
                        className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                   hover:bg-[var(--background)] hover:text-[var(--foreground)]
                                   disabled:opacity-40 transition-colors"
                      >
                        <Send size={15} />
                      </button>
                    )}
                    {m.status === "published" && (
                      <button
                        onClick={() => void handleUnpublish(m)}
                        disabled={publishBusyId === m.id}
                        title={t("Unpublish (revert to draft)")}
                        className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                   hover:bg-[var(--background)] hover:text-[var(--foreground)]
                                   disabled:opacity-40 transition-colors"
                      >
                        <RotateCcw size={15} />
                      </button>
                    )}
                    <button
                      onClick={() => setDeleteTarget(m)}
                      title={t("Delete")}
                      className="rounded-lg p-1.5 text-[var(--muted-foreground)]
                                 hover:bg-red-500/10 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t("Delete material")}
        confirmLabel={t("Delete")}
        tone="danger"
        busy={deleteBusy}
        busyLabel={t("Deleting…")}
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteTarget(null)}
      >
        {deleteTarget
          ? t("This permanently removes “{{name}}”. This cannot be undone.", {
              name: deleteTarget.filename,
            })
          : ""}
      </ConfirmDialog>

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
