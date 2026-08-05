import type { TFunction } from "i18next";

/** Upload policy for a knowledge base — allowed extensions, accept string, and max file size. */
export interface KnowledgeUploadPolicy {
  extensions: string[];
  accept: string;
  max_file_size_bytes: number;
}

/** Default upload policy used before the backend policy is fetched. */
export const DEFAULT_UPLOAD_POLICY: KnowledgeUploadPolicy = {
  extensions: [],
  accept: "",
  max_file_size_bytes: 200 * 1024 * 1024,
};

/** Live indexing progress info for a knowledge base. */
export interface ProgressInfo {
  task_id?: string;
  stage?: string;
  message?: string;
  current?: number;
  total?: number;
  percent?: number;
  progress_percent?: number;
  indexed_count?: number;
  index_changed?: boolean;
  index_action?: string;
}

/** Metadata about a KB's index version (signature, model, dimension, etc.). */
export interface IndexVersion {
  signature?: string;
  model?: string;
  dimension?: number;
  binding?: string;
  created_at?: string;
  ready?: boolean;
  legacy?: boolean;
}

/** A knowledge base with its status, metadata, statistics, and progress. */
export interface KnowledgeBase {
  id?: string;
  name: string;
  is_default?: boolean;
  status?: string;
  path?: string;
  metadata?: {
    created_at?: string;
    last_updated?: string;
    last_indexed_at?: string;
    last_indexed_count?: number;
    last_indexed_action?: string;
    rag_provider?: string;
    needs_reindex?: boolean;
    embedding_model?: string;
    embedding_dim?: number;
    embedding_mismatch?: boolean;
    /** Connected-source kind (e.g. "obsidian", "subagent"); absent for ordinary indexed KBs. */
    type?: string;
    /** Absolute path of a connected Obsidian vault (when type === "obsidian"). */
    vault_path?: string;
    /** Backend of a connected subagent (when type === "subagent"): "claude_code" | "codex" | "gemini" | "kimi" | "opencode" | "mimo" | "partner". */
    agent_kind?: string;
    /** Bound partner id when agent_kind === "partner". */
    partner_id?: string;
  };
  progress?: ProgressInfo;
  statistics?: {
    raw_documents?: number;
    images?: number;
    content_lists?: number;
    rag_provider?: string;
    rag_initialized?: boolean;
    needs_reindex?: boolean;
    status?: string;
    progress?: ProgressInfo;
    index_versions?: IndexVersion[];
    active_signature?: string | null;
    active_match?: boolean;
  };
  source?: "admin" | "user";
  assigned?: boolean;
  read_only?: boolean;
  provenance_label?: string;
  available?: boolean;
}

/** A single file in a validated selection, with its validation result. */
export interface ValidatedSelectionFile {
  id: string;
  file: File;
  extension: string;
  sizeLabel: string;
  valid: boolean;
  error: string | null;
}

/** Result of validating a set of files against an upload policy. */
export interface ValidatedFileSelection {
  items: ValidatedSelectionFile[];
  validFiles: File[];
  invalidFiles: ValidatedSelectionFile[];
  totalBytes: number;
}

/**
 * Format a byte count as a human-readable file size string.
 *
 * @param bytes - Size in bytes.
 * @returns Formatted string (e.g. "1.2 MB").
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

/**
 * Extract the lowercase file extension (with leading dot) from a filename.
 *
 * @param filename - Filename to inspect.
 * @returns The extension (e.g. ".pdf"), or empty string if none.
 */
export const getFileExtension = (filename: string): string => {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index).toLowerCase() : "";
};

/**
 * Build a stable ID for a File based on name, size, and last-modified time.
 *
 * @param file - File to identify.
 * @returns A unique key string.
 */
export const selectionFileId = (file: File): string =>
  `${file.name}:${file.size}:${file.lastModified}`;

/**
 * Merge two arrays of files, deduplicating by selection ID.
 *
 * @param existing - Already-selected files.
 * @param incoming - Newly added files.
 * @returns Merged array with duplicates removed.
 */
export const mergeSelectedFiles = (
  existing: File[],
  incoming: File[],
): File[] => {
  const merged = new Map<string, File>();
  [...existing, ...incoming].forEach((file) => {
    merged.set(selectionFileId(file), file);
  });
  return Array.from(merged.values());
};

const parseKnowledgeTimestamp = (value?: string): Date | null => {
  if (!value) return null;
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

/**
 * Format a knowledge-base timestamp string as a locale-aware string.
 *
 * @param value - ISO or space-separated timestamp.
 * @returns Formatted timestamp, or the original value if parsing fails.
 */
export const formatKnowledgeTimestamp = (value?: string): string | null => {
  const parsed = parseKnowledgeTimestamp(value);
  return parsed ? parsed.toLocaleString() : value || null;
};

/** The retrieval engine a KB is bound to. Connected vaults badge by source. */
export const kbProvider = (kb: KnowledgeBase): string => {
  if (kb.metadata?.type === "obsidian") return "obsidian";
  return (
    (kb.statistics?.rag_provider as string | undefined) ||
    (kb.metadata?.rag_provider as string | undefined) ||
    "llamaindex"
  );
};

/** Source-document count for a KB, or null when unknown. */
export const kbDocCount = (kb: KnowledgeBase): number | null => {
  const raw = kb.statistics?.raw_documents;
  if (typeof raw === "number") return raw;
  const indexed = kb.metadata?.last_indexed_count;
  return typeof indexed === "number" ? indexed : null;
};

/** Resolve the effective status of a KB from its top-level or statistics field. */
export const resolveKbStatus = (kb: KnowledgeBase): string =>
  kb.status ?? kb.statistics?.status ?? "unknown";

/** Whether a KB needs reindexing (flagged or status is "needs_reindex"). */
export const kbNeedsReindex = (kb: KnowledgeBase): boolean =>
  Boolean(kb.statistics?.needs_reindex) ||
  resolveKbStatus(kb) === "needs_reindex";

/** Whether a KB is in a state that accepts new file uploads. */
export const kbIsUploadable = (kb: KnowledgeBase): boolean =>
  resolveKbStatus(kb) === "ready" && !kbNeedsReindex(kb);

/** Whether a KB can be reindexed (has source files and is stale or errored). */
export const kbCanReindex = (kb: KnowledgeBase): boolean => {
  const status = resolveKbStatus(kb);
  const hasSourceFiles =
    typeof kb.statistics?.raw_documents === "number"
      ? kb.statistics.raw_documents > 0
      : true;
  if (!hasSourceFiles) return false;
  if (status === "error") return true;
  return (
    Boolean(kb.statistics?.needs_reindex) ||
    kb.statistics?.active_match === false
  );
};

const LIVE_PROGRESS_STAGES = new Set([
  "initializing",
  "starting",
  "processing_documents",
  "processing_file",
]);

/** Whether a KB currently has a live indexing operation in progress. */
export const kbHasLiveProgress = (kb: KnowledgeBase): boolean => {
  const status = resolveKbStatus(kb);
  if (status === "ready" || status === "error" || status === "needs_reindex") {
    return false;
  }
  const stage = kb.progress?.stage;
  if (!stage) return false;
  if (stage === "completed" || stage === "error") return false;
  return LIVE_PROGRESS_STAGES.has(stage);
};

/** Resolve a 0–100 progress percentage from a ProgressInfo object. */
export const resolveProgressPercent = (progress?: ProgressInfo): number => {
  const directPercent = progress?.progress_percent ?? progress?.percent;
  if (typeof directPercent === "number") return directPercent;

  const current = progress?.current ?? 0;
  const total = progress?.total ?? 0;
  if (!current || !total) return 0;
  return Math.round((current / total) * 100);
};

/**
 * Validate a set of files against an upload policy.
 *
 * @param files - Files to validate.
 * @param uploadPolicy - Allowed extensions and max file size.
 * @param t - i18n translation function for error messages.
 * @returns Validated file selection with per-file results.
 */
export function validateFiles(
  files: File[],
  uploadPolicy: KnowledgeUploadPolicy,
  t: TFunction,
): ValidatedFileSelection {
  const allowedExtensions = new Set(
    uploadPolicy.extensions.map((ext) => ext.toLowerCase()),
  );

  const items = files.map((file) => {
    const extension = getFileExtension(file.name);
    let error: string | null = null;

    if (allowedExtensions.size > 0 && !allowedExtensions.has(extension)) {
      error = t("Unsupported file type");
    } else if (file.size > uploadPolicy.max_file_size_bytes) {
      error = t("This file exceeds the maximum size of {{size}}.", {
        size: formatFileSize(uploadPolicy.max_file_size_bytes),
      });
    }

    return {
      id: selectionFileId(file),
      file,
      extension: extension || t("No extension"),
      sizeLabel: formatFileSize(file.size),
      valid: !error,
      error,
    };
  });

  return {
    items,
    validFiles: items.filter((item) => item.valid).map((item) => item.file),
    invalidFiles: items.filter((item) => !item.valid),
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  };
}
