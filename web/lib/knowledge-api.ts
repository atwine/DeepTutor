import { apiFetch, apiUrl } from "@/lib/api";
import { invalidateClientCache, withClientCache } from "@/lib/client-cache";

const KNOWLEDGE_CACHE_PREFIX = "knowledge:";

/** Summary of a knowledge base — its name, status, and metadata. */
export interface KnowledgeBaseSummary {
  id?: string;
  name: string;
  is_default?: boolean;
  status?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  progress?: Record<string, unknown>;
  statistics?: Record<string, unknown>;
  source?: "admin" | "user";
  assigned?: boolean;
  read_only?: boolean;
  provenance_label?: string;
  available?: boolean;
}

/** Summary of a RAG provider engine — its capabilities and configuration state. */
export interface RagProviderSummary {
  id: string;
  name: string;
  description: string;
  /** Whether the engine is ready to use (e.g. its API key is set). */
  configured?: boolean;
  /** Whether the engine needs an API key configured before use. */
  requires_api_key?: boolean;
  /** Retrieval modes this engine supports (empty for mode-less engines). */
  modes?: string[];
  /** The active default retrieval mode for this engine. */
  default_mode?: string;
  /** Whether an existing index for this engine can be linked in place. */
  linkable?: boolean;
}

/** PageIndex engine configuration — API base URL and key status. */
export interface PageIndexConfig {
  api_base_url: string;
  api_key_set: boolean;
  configured: boolean;
}

/** LlamaIndex engine configuration — retrieval profile, chunk geometry, and top-k settings. */
export interface LlamaIndexConfig {
  version: number;
  /** "hybrid" (BM25 + vector fusion) or "vector" only. */
  retrieval_profile: "hybrid" | "vector";
  /** Default number of chunks a query returns. */
  top_k: number;
  vector_top_k_multiplier: number;
  bm25_top_k_multiplier: number;
  /** Chunk geometry — applies to documents indexed after the change. */
  chunk_size: number;
  chunk_overlap: number;
}

/** GraphRAG engine configuration — response type and community settings. */
export interface GraphRagConfig {
  version: number;
  response_type: string;
  community_level: number;
  dynamic_community_selection: boolean;
}

/** LightRAG engine configuration — top-k and response type. */
export interface LightRagConfig {
  version: number;
  top_k: number;
  response_type: string;
}

/** A single preflight check item for an engine's environment readiness. */
export interface PreflightCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Optional checks don't gate overall readiness (e.g. BM25, vision). */
  optional: boolean;
}

/** Preflight check result for an engine — overall ok status and individual checks. */
export interface EnginePreflight {
  ok: boolean;
  checks: PreflightCheck[];
}

/** A selectable model option for an engine service kind. */
export interface ModelOption {
  profile_id: string;
  profile_name: string;
  model_id: string;
  label: string;
  model: string;
  detail: string;
}

/** Active model selection and available options for one service kind. */
export interface ModelKindOptions {
  active: { profile_id: string | null; model_id: string | null };
  options: ModelOption[];
}

/** Map of service kind ("llm" | "embedding") → its options + active selection. */
export type ModelOptionsByKind = Record<string, ModelKindOptions>;

/** Upload policy — allowed extensions, accept string, and max file size. */
export interface KnowledgeUploadPolicy {
  extensions: string[];
  accept: string;
  max_file_size_bytes: number;
}

/** A file or folder entry within a knowledge base's raw/ directory. */
export interface KnowledgeBaseFile {
  /** POSIX path relative to the KB's raw/ root (may include folders). */
  name: string;
  /** "folder" entries are organizational only; default "file". */
  type?: "file" | "folder";
  size?: number;
  modified?: number;
  mime_type?: string | null;
}

const IMAGE_UPLOAD_EXTENSIONS = [
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
];

const IMAGE_UPLOAD_MIME_TYPES = [
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/webp",
];

function normalizeUploadPolicy(data: unknown): KnowledgeUploadPolicy {
  const payload = data as Partial<KnowledgeUploadPolicy> | null | undefined;
  const extensions = Array.from(
    new Set([
      ...(Array.isArray(payload?.extensions) ? payload.extensions : []),
      ...IMAGE_UPLOAD_EXTENSIONS,
    ]),
  ).sort();
  const serverAccept =
    typeof payload?.accept === "string"
      ? payload.accept
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : [];
  const accept = Array.from(
    new Set([...serverAccept, ...extensions, ...IMAGE_UPLOAD_MIME_TYPES]),
  ).join(",");

  return {
    extensions,
    accept,
    max_file_size_bytes:
      typeof payload?.max_file_size_bytes === "number"
        ? payload.max_file_size_bytes
        : 200 * 1024 * 1024,
  };
}

/**
 * List all knowledge bases via the API, with optional cache bypass.
 *
 * @param options - Optional `force` to bypass the client cache.
 * @returns Array of knowledge base summaries.
 */
export async function listKnowledgeBases(options?: { force?: boolean }) {
  return withClientCache<KnowledgeBaseSummary[]>(
    `${KNOWLEDGE_CACHE_PREFIX}list`,
    async () => {
      const response = await apiFetch(apiUrl("/api/v1/knowledge/list"), {
        cache: "no-store",
      });
      const data = await response.json();
      return Array.isArray(data)
        ? data
        : Array.isArray(data?.knowledge_bases)
          ? data.knowledge_bases
          : [];
    },
    {
      force: options?.force,
    },
  );
}

/**
 * List all available RAG providers, with optional cache bypass.
 *
 * @param options - Optional `force` to bypass the client cache.
 * @returns Array of RAG provider summaries.
 */
export async function listRagProviders(options?: { force?: boolean }) {
  return withClientCache<RagProviderSummary[]>(
    `${KNOWLEDGE_CACHE_PREFIX}providers`,
    async () => {
      const response = await apiFetch(
        apiUrl("/api/v1/knowledge/rag-providers"),
        {
          cache: "no-store",
        },
      );
      const data = await response.json();
      return Array.isArray(data?.providers) ? data.providers : [];
    },
    {
      force: options?.force,
    },
  );
}

/**
 * Fetch the knowledge upload policy (allowed extensions, accept string, max size).
 *
 * @param options - Optional `force` to bypass the client cache.
 * @returns Normalized upload policy.
 */
export async function getKnowledgeUploadPolicy(options?: { force?: boolean }) {
  return withClientCache<KnowledgeUploadPolicy>(
    `${KNOWLEDGE_CACHE_PREFIX}upload-policy`,
    async () => {
      const response = await apiFetch(
        apiUrl("/api/v1/knowledge/supported-file-types"),
        {
          cache: "no-store",
        },
      );
      const data = await response.json();
      return normalizeUploadPolicy(data);
    },
    {
      force: options?.force,
    },
  );
}

/** Invalidate all client-cached knowledge API responses. */
export function invalidateKnowledgeCaches() {
  invalidateClientCache(KNOWLEDGE_CACHE_PREFIX);
}

const PAGEINDEX_CONFIG_PATH =
  "/api/v1/knowledge/rag-pipelines/pageindex/config";

/**
 * Fetch the PageIndex engine configuration.
 *
 * @param options - Optional `force` to bypass the client cache.
 * @returns PageIndex configuration.
 */
export async function getPageIndexConfig(options?: {
  force?: boolean;
}): Promise<PageIndexConfig> {
  return withClientCache<PageIndexConfig>(
    `${KNOWLEDGE_CACHE_PREFIX}pageindex-config`,
    async () => {
      const response = await apiFetch(apiUrl(PAGEINDEX_CONFIG_PATH), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          await readErrorDetail(response, "Failed to read PageIndex config"),
        );
      }
      return (await response.json()) as PageIndexConfig;
    },
    { force: options?.force, ttlMs: 15_000 },
  );
}

/**
 * Update the PageIndex engine configuration.
 *
 * @param payload - Partial config with optional API key and base URL.
 * @returns Updated PageIndex configuration.
 */
export async function updatePageIndexConfig(payload: {
  /** Omit to keep the stored key, "" to clear it, any value to replace it. */
  api_key?: string;
  api_base_url?: string;
}): Promise<PageIndexConfig> {
  const res = await apiFetch(apiUrl(PAGEINDEX_CONFIG_PATH), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, "Failed to update PageIndex config"),
    );
  }
  // The provider list's `configured` flag depends on this; refresh it.
  invalidateKnowledgeCaches();
  return (await res.json()) as PageIndexConfig;
}

const LLAMAINDEX_CONFIG_PATH =
  "/api/v1/knowledge/rag-pipelines/llamaindex/config";

/**
 * Fetch the LlamaIndex engine configuration.
 *
 * @param options - Optional `force` to bypass the client cache.
 * @returns LlamaIndex configuration.
 */
export async function getLlamaIndexConfig(options?: {
  force?: boolean;
}): Promise<LlamaIndexConfig> {
  return withClientCache<LlamaIndexConfig>(
    `${KNOWLEDGE_CACHE_PREFIX}llamaindex-config`,
    async () => {
      const response = await apiFetch(apiUrl(LLAMAINDEX_CONFIG_PATH), {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(
          await readErrorDetail(response, "Failed to read LlamaIndex config"),
        );
      }
      return (await response.json()) as LlamaIndexConfig;
    },
    { force: options?.force, ttlMs: 15_000 },
  );
}

/**
 * Update the LlamaIndex engine configuration.
 *
 * @param payload - Partial config (version is server-managed and omitted).
 * @returns Updated LlamaIndex configuration.
 */
export async function updateLlamaIndexConfig(
  payload: Partial<Omit<LlamaIndexConfig, "version">>,
): Promise<LlamaIndexConfig> {
  const res = await apiFetch(apiUrl(LLAMAINDEX_CONFIG_PATH), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, "Failed to update LlamaIndex config"),
    );
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as LlamaIndexConfig;
}

async function getEngineConfig<T>(
  provider: string,
  cacheKey: string,
  options?: { force?: boolean },
): Promise<T> {
  return withClientCache<T>(
    `${KNOWLEDGE_CACHE_PREFIX}${cacheKey}`,
    async () => {
      const response = await apiFetch(
        apiUrl(`/api/v1/knowledge/rag-pipelines/${provider}/config`),
        { cache: "no-store" },
      );
      if (!response.ok) {
        throw new Error(
          await readErrorDetail(response, `Failed to read ${provider} config`),
        );
      }
      return (await response.json()) as T;
    },
    { force: options?.force, ttlMs: 15_000 },
  );
}

async function updateEngineConfig<T>(
  provider: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/rag-pipelines/${provider}/config`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, `Failed to update ${provider} config`),
    );
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as T;
}

/** Fetch the GraphRAG engine configuration. Thin wrapper around `getEngineConfig`. */
export const getGraphRagConfig = (options?: { force?: boolean }) =>
  getEngineConfig<GraphRagConfig>("graphrag", "graphrag-config", options);
/** Update the GraphRAG engine configuration. Thin wrapper around `updateEngineConfig`. */
export const updateGraphRagConfig = (
  payload: Partial<Omit<GraphRagConfig, "version">>,
) => updateEngineConfig<GraphRagConfig>("graphrag", payload);

/** Fetch the LightRAG engine configuration. Thin wrapper around `getEngineConfig`. */
export const getLightRagConfig = (options?: { force?: boolean }) =>
  getEngineConfig<LightRagConfig>("lightrag", "lightrag-config", options);
/** Update the LightRAG engine configuration. Thin wrapper around `updateEngineConfig`. */
export const updateLightRagConfig = (
  payload: Partial<Omit<LightRagConfig, "version">>,
) => updateEngineConfig<LightRagConfig>("lightrag", payload);

/**
 * Run preflight environment checks for a RAG provider engine.
 *
 * @param provider - Engine provider identifier (e.g. "pageindex", "llamaindex").
 * @returns Preflight result with overall ok status and individual checks.
 */
export async function getEnginePreflight(
  provider: string,
): Promise<EnginePreflight> {
  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/rag-pipelines/${provider}/preflight`),
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to check environment"));
  }
  return (await res.json()) as EnginePreflight;
}

/**
 * Fetch available model options for the given service kinds.
 *
 * @param kinds - Service kinds to query (e.g. "llm", "embedding").
 * @returns Map of service kind to its options and active selection.
 */
export async function getEngineModelOptions(
  kinds: string[],
): Promise<ModelOptionsByKind> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/knowledge/rag-pipelines/model-options?kinds=${encodeURIComponent(
        kinds.join(","),
      )}`,
    ),
    { cache: "no-store" },
  );
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to read model options"));
  }
  return (await res.json()) as ModelOptionsByKind;
}

/**
 * Set the active model for a given service kind.
 *
 * @param kind - Service kind (e.g. "llm", "embedding").
 * @param profileId - Profile identifier for the model.
 * @param modelId - Model identifier.
 * @returns Updated options and active selection for the service kind.
 */
export async function setEngineActiveModel(
  kind: string,
  profileId: string,
  modelId: string,
): Promise<ModelKindOptions> {
  const res = await apiFetch(
    apiUrl("/api/v1/knowledge/rag-pipelines/active-model"),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, profile_id: profileId, model_id: modelId }),
    },
  );
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to switch model"));
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as ModelKindOptions;
}

/**
 * Update the active retrieval mode for a RAG provider.
 *
 * @param provider - Engine provider identifier.
 * @param mode - Retrieval mode to set.
 * @returns Object with the provider and its new mode.
 */
export async function updateRagProviderMode(
  provider: string,
  mode: string,
): Promise<{ provider: string; mode: string }> {
  const res = await apiFetch(
    apiUrl(
      `/api/v1/knowledge/rag-providers/${encodeURIComponent(provider)}/mode`,
    ),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    },
  );
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, "Failed to update retrieval mode"),
    );
  }
  // The provider list's `default_mode` depends on this; refresh it.
  invalidateKnowledgeCaches();
  return (await res.json()) as { provider: string; mode: string };
}

function withDockerUpgradeHint(
  detail: string,
  status: number,
  action: string,
): string {
  if (status === 404 && detail.trim().toLowerCase() === "not found") {
    return `${action} endpoint not found (404). The web UI may be newer than the backend API. If using Docker, pull and recreate the container, then retry.`;
  }
  return detail;
}

/**
 * List files in a knowledge base's raw/ directory, with optional cache bypass.
 *
 * @param name - Knowledge base name.
 * @param options - Optional `force` to bypass the client cache.
 * @returns Array of file and folder entries.
 */
export async function listKnowledgeBaseFiles(
  name: string,
  options?: { force?: boolean },
): Promise<KnowledgeBaseFile[]> {
  return withClientCache<KnowledgeBaseFile[]>(
    `${KNOWLEDGE_CACHE_PREFIX}files:${name}`,
    async () => {
      const response = await apiFetch(
        apiUrl(`/api/v1/knowledge/${encodeURIComponent(name)}/files`),
        { cache: "no-store" },
      );
      if (!response.ok) {
        const detail = await readErrorDetail(
          response,
          `Failed to list files (${response.status})`,
        );
        throw new Error(
          withDockerUpgradeHint(
            detail,
            response.status,
            "Knowledge file listing",
          ),
        );
      }
      const data = await response.json();
      return Array.isArray(data?.files) ? data.files : [];
    },
    { force: options?.force, ttlMs: 15_000 },
  );
}

/** Build the `/api/v1/...` path for a raw KB file (caller can pass to apiUrl()). */
export function knowledgeBaseFilePath(
  kbName: string,
  filename: string,
): string {
  return `/api/v1/knowledge/${encodeURIComponent(kbName)}/files/${filename
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** Build the `/api/v1/...` path for extracted plain-text preview of a raw KB file. */
export function knowledgeBaseFilePreviewTextPath(
  kbName: string,
  filename: string,
): string {
  return `/api/v1/knowledge/${encodeURIComponent(kbName)}/file-preview-text/${filename
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

/** Response from a knowledge task (create, upload, reindex, retry). */
export interface KnowledgeTaskResponse {
  task_id?: string;
  message?: string;
  noop?: boolean;
}

async function readErrorDetail(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = await res.json();
    if (body?.detail) return String(body.detail);
  } catch {
    // body wasn't JSON; fall through
  }
  return fallback;
}

// A folder upload's File objects carry `webkitRelativePath` (e.g.
// "Papers/2024/a.pdf"); single-file picks leave it "". We forward it as
// `rel_paths` so the backend preserves the folder layout under raw/.
function appendFilesWithPaths(form: FormData, files: File[]): void {
  files.forEach((file) => {
    form.append("files", file);
    form.append("rel_paths", file.webkitRelativePath || "");
  });
}

/**
 * Create a new knowledge base with uploaded files.
 *
 * @param payload - Name, provider, and files to upload.
 * @returns Task response with task ID for tracking indexing progress.
 */
export async function createKnowledgeBase(payload: {
  name: string;
  provider: string;
  files: File[];
}): Promise<KnowledgeTaskResponse> {
  const form = new FormData();
  form.append("name", payload.name);
  form.append("rag_provider", payload.provider);
  appendFilesWithPaths(form, payload.files);

  const res = await apiFetch(apiUrl("/api/v1/knowledge/create"), {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, "Failed to create knowledge base"),
    );
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as KnowledgeTaskResponse;
}

/**
 * Connect an Obsidian vault as a knowledge base.
 *
 * @param payload - Knowledge base name and vault path.
 * @returns Connection status with name and vault path.
 */
export async function connectObsidianVault(payload: {
  name: string;
  vaultPath: string;
}): Promise<{ status: string; name: string; vault_path: string }> {
  const res = await apiFetch(apiUrl("/api/v1/knowledge/connect-obsidian"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: payload.name, vault_path: payload.vaultPath }),
  });
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, "Failed to connect Obsidian vault"),
    );
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as {
    status: string;
    name: string;
    vault_path: string;
  };
}

/** Probe result for a linked folder — checks index readiness and embedding compatibility. */
export interface LinkedFolderProbe {
  /** Whether the folder holds a ready index for the chosen engine. */
  ok: boolean;
  provider: string;
  external_path: string;
  version: string | null;
  doc_count: number | null;
  embedding: {
    /** null when compatibility could not be verified. */
    compatible: boolean | null;
    index_model: string | null;
    current_model: string | null;
  };
  warnings: string[];
  /** Set when the folder cannot be linked at all (no index, wrong engine, …). */
  error: string | null;
}

/**
 * Probe a local folder for an existing RAG index before linking it.
 *
 * @param payload - Folder path and provider to check.
 * @returns Probe result with compatibility and doc count info.
 */
export async function probeLinkedFolder(payload: {
  folderPath: string;
  provider: string;
}): Promise<LinkedFolderProbe> {
  const res = await apiFetch(apiUrl("/api/v1/knowledge/probe-folder"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folder_path: payload.folderPath,
      rag_provider: payload.provider,
    }),
  });
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to inspect folder"));
  }
  return (await res.json()) as LinkedFolderProbe;
}

/**
 * Connect a local folder with an existing RAG index as a knowledge base.
 *
 * @param payload - Knowledge base name, folder path, and provider.
 * @returns Connection status with name, path, provider, and any warnings.
 */
export async function connectLinkedFolder(payload: {
  name: string;
  folderPath: string;
  provider: string;
}): Promise<{
  status: string;
  name: string;
  external_path: string;
  rag_provider: string;
  warnings: string[];
}> {
  const res = await apiFetch(apiUrl("/api/v1/knowledge/connect-folder"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      folder_path: payload.folderPath,
      rag_provider: payload.provider,
    }),
  });
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to link folder"));
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as {
    status: string;
    name: string;
    external_path: string;
    rag_provider: string;
    warnings: string[];
  };
}

/** Probe result for a LightRAG server — reachability, auth, and version info. */
export interface LightRagServerProbe {
  /** Reachable, a LightRAG server, and (if required) the API key is accepted. */
  ok: boolean;
  base_url: string;
  reachable: boolean;
  auth_required: boolean;
  auth_ok: boolean;
  core_version: string | null;
  api_version: string | null;
  /** Set when the server can't be connected (unreachable, bad key, …). */
  error: string | null;
}

/**
 * Probe a LightRAG server for reachability and auth before connecting.
 *
 * @param payload - Server URL and optional API key.
 * @returns Probe result with reachability, auth, and version info.
 */
export async function probeLightRagServer(payload: {
  serverUrl: string;
  apiKey?: string;
}): Promise<LightRagServerProbe> {
  const res = await apiFetch(
    apiUrl("/api/v1/knowledge/probe-lightrag-server"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server_url: payload.serverUrl,
        api_key: payload.apiKey ?? "",
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, "Failed to reach LightRAG server"),
    );
  }
  return (await res.json()) as LightRagServerProbe;
}

/**
 * Connect a remote LightRAG server as a knowledge base.
 *
 * @param payload - Knowledge base name, server URL, optional API key and mode.
 * @returns Connection status with name, server URL, and provider.
 */
export async function connectLightRagServer(payload: {
  name: string;
  serverUrl: string;
  apiKey?: string;
  mode?: string;
}): Promise<{
  status: string;
  name: string;
  server_url: string;
  rag_provider: string;
}> {
  const res = await apiFetch(
    apiUrl("/api/v1/knowledge/connect-lightrag-server"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: payload.name,
        server_url: payload.serverUrl,
        api_key: payload.apiKey ?? "",
        search_mode: payload.mode ?? "",
      }),
    },
  );
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, "Failed to connect LightRAG server"),
    );
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as {
    status: string;
    name: string;
    server_url: string;
    rag_provider: string;
  };
}

/**
 * Upload additional files to an existing knowledge base.
 *
 * @param name - Knowledge base name.
 * @param files - Files to upload.
 * @param options - Optional provider override.
 * @returns Task response with task ID for tracking indexing progress.
 */
export async function uploadKnowledgeBaseFiles(
  name: string,
  files: File[],
  options?: { provider?: string },
): Promise<KnowledgeTaskResponse> {
  const form = new FormData();
  appendFilesWithPaths(form, files);
  if (options?.provider) form.append("rag_provider", options.provider);

  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/${encodeURIComponent(name)}/upload`),
    { method: "POST", body: form },
  );
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to upload files"));
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as KnowledgeTaskResponse;
}

/**
 * Create a new folder inside a knowledge base's raw/ directory.
 *
 * @param name - Knowledge base name.
 * @param path - Folder path relative to raw/.
 */
export async function createKbFolder(
  name: string,
  path: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/${encodeURIComponent(name)}/folders`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    },
  );
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to create folder"));
  }
  invalidateKnowledgeCaches();
}

/**
 * Move a file to a different folder within a knowledge base.
 *
 * @param name - Knowledge base name.
 * @param source - Source file path relative to raw/.
 * @param destFolder - Destination folder path relative to raw/.
 */
export async function moveKbFile(
  name: string,
  source: string,
  destFolder: string,
): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/${encodeURIComponent(name)}/files/move`),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, dest_folder: destFolder }),
    },
  );
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to move file"));
  }
  invalidateKnowledgeCaches();
}

/**
 * Delete a single raw document from a KB. Works even while the KB is in an
 * error state, so an unparseable file can be dropped without rebuilding the
 * whole base. `was_indexed` signals whether a re-index is needed to purge the
 * file's vectors from retrieval.
 */
export async function deleteKbFile(
  name: string,
  filename: string,
): Promise<{ was_indexed: boolean }> {
  const res = await apiFetch(apiUrl(knowledgeBaseFilePath(name, filename)), {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to delete file"));
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as { was_indexed: boolean };
}

/**
 * Set a knowledge base as the default.
 *
 * @param name - Knowledge base name to set as default.
 */
export async function setDefaultKnowledgeBase(name: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/default/${encodeURIComponent(name)}`),
    { method: "PUT" },
  );
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, "Failed to set default"));
  }
  invalidateKnowledgeCaches();
}

/**
 * Trigger a re-index of an existing knowledge base.
 *
 * @param name - Knowledge base name.
 * @returns Task response with task ID for tracking progress.
 */
export async function reindexKnowledgeBase(
  name: string,
): Promise<KnowledgeTaskResponse> {
  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/${encodeURIComponent(name)}/reindex`),
    { method: "POST" },
  );
  if (!res.ok) {
    const detail = await readErrorDetail(
      res,
      `Re-index failed (${res.status})`,
    );
    throw new Error(
      withDockerUpgradeHint(detail, res.status, "Knowledge re-index"),
    );
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as KnowledgeTaskResponse;
}

/**
 * Retry indexing for a knowledge base that previously failed.
 *
 * @param name - Knowledge base name.
 * @returns Task response with task ID for tracking progress.
 */
export async function retryKnowledgeBase(
  name: string,
): Promise<KnowledgeTaskResponse> {
  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/${encodeURIComponent(name)}/retry`),
    { method: "POST" },
  );
  if (!res.ok) {
    const detail = await readErrorDetail(res, `Retry failed (${res.status})`);
    throw new Error(
      withDockerUpgradeHint(detail, res.status, "Knowledge retry"),
    );
  }
  invalidateKnowledgeCaches();
  return (await res.json()) as KnowledgeTaskResponse;
}

/**
 * Delete a knowledge base and all its data.
 *
 * @param name - Knowledge base name to delete.
 */
export async function deleteKnowledgeBase(name: string): Promise<void> {
  const res = await apiFetch(
    apiUrl(`/api/v1/knowledge/${encodeURIComponent(name)}`),
    { method: "DELETE" },
  );
  if (!res.ok) {
    throw new Error(
      await readErrorDetail(res, `Delete failed (${res.status})`),
    );
  }
  invalidateKnowledgeCaches();
}
