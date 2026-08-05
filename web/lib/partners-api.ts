/** Typed client for the /api/v1/partners backend. */

import { apiFetch, apiUrl } from "@/lib/api";
import type { LLMSelection } from "@/lib/unified-ws";

/** Full partner info returned by the partners API. */
export interface PartnerInfo {
  partner_id: string;
  name: string;
  description: string;
  /** List endpoints: channel name keys only. Detail: full (masked) dict. */
  channels: string[] | Record<string, unknown>;
  llm_selection?: LLMSelection | null;
  backup_llm_selection?: LLMSelection | null;
  model?: string | null;
  language?: string;
  emoji?: string;
  color?: string;
  avatar?: string;
  soul_origin?: { type?: string; id?: string };
  enabled_tools?: string[] | null;
  builtin_tools?: string[] | null;
  mcp_tools?: string[] | null;
  running: boolean;
  started_at: string | null;
  last_reload_error?: string | null;
  provisioning?: ProvisioningReport;
  start_error?: string;
}

/** Result of provisioning assets onto a partner. */
export interface ProvisioningReport {
  copied: Record<string, string[]>;
  errors: { type: string; name: string; error: string }[];
}

/** A reusable soul (personality) template from the library. */
export interface SoulTemplate {
  id: string;
  name: string;
  content: string;
}

/** Available soul sources (library templates + personas). */
export interface SoulSources {
  library: SoulTemplate[];
  personas: { name: string; description: string; content?: string }[];
}

/** A selectable tool with name and description. */
export interface ToolOption {
  name: string;
  description: string;
}

/** An MCP tool option with provider grouping metadata. */
export interface McpToolOption extends ToolOption {
  /** Provider grouping key; `server` is its pre-provider spelling. */
  provider_id: string;
  server: string;
  /** `"mcp"` today, `"cli"` once CLI-app providers land. */
  kind: string;
}

/** All tool options available for partner configuration. */
export interface ToolOptions {
  tools: ToolOption[];
  /** Auto-mounted built-in tools an owner may allow/deny (default: all). */
  builtin_tools: ToolOption[];
  mcp_tools: McpToolOption[];
}

/** Assets (knowledge bases, skills, notebooks) attached to a partner. */
export interface PartnerAssets {
  knowledge_bases: { name: string; documents?: number }[];
  skills: { name: string }[];
  notebooks: { id: string; name: string; record_count?: number }[];
}

/** Summary of a partner's conversation session. */
export interface PartnerSessionInfo {
  session_key: string;
  /** Opening user message, trimmed — the conversation's human label. */
  title?: string;
  message_count: number;
  updated_at: string;
  last_message: string;
  archived?: boolean;
}

/** A slash command exposed by a partner. */
export interface PartnerCommandInfo {
  command: string;
  description: string;
  arg_hint?: string;
}

/** Specifies where a partner's soul comes from (default, library, persona, custom). */
export interface SoulSpec {
  source: "default" | "library" | "persona" | "custom";
  id?: string;
  content?: string;
}

/** Payload for creating a new partner. */
export interface CreatePartnerPayload {
  partner_id?: string;
  name: string;
  description?: string;
  soul?: SoulSpec;
  channels?: Record<string, unknown>;
  llm_selection?: LLMSelection | null;
  backup_llm_selection?: LLMSelection | null;
  language?: string;
  emoji?: string;
  color?: string;
  avatar?: string;
  enabled_tools?: string[] | null;
  builtin_tools?: string[] | null;
  mcp_tools?: string[] | null;
  assets?: {
    knowledge_bases?: string[];
    skills?: string[];
    notebooks?: string[];
  };
  start?: boolean;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      detail?: string | { message?: string };
    };
    const detail = body.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : (detail?.message ?? `Request failed: ${res.status}`);
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

/** List all partners.
 * @returns Array of partner info. */
export async function listPartners(): Promise<PartnerInfo[]> {
  return json(
    await apiFetch(apiUrl("/api/v1/partners"), { cache: "no-store" }),
  );
}

/** Fetch a single partner by id.
 * @param partnerId - The partner's id.
 * @param options - Pass `includeSecrets` to include masked channel secrets.
 * @returns The partner's info. */
export async function getPartner(
  partnerId: string,
  options?: { includeSecrets?: boolean },
): Promise<PartnerInfo> {
  const query = options?.includeSecrets ? "?include_secrets=true" : "";
  return json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}${query}`),
    ),
  );
}

/** Create a new partner.
 * @param payload - Partner configuration (name, channels, LLM, assets, etc.).
 * @returns The created partner info. */
export async function createPartner(
  payload: CreatePartnerPayload,
): Promise<PartnerInfo> {
  return json(
    await apiFetch(apiUrl("/api/v1/partners"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

/** Update an existing partner's configuration.
 * @param partnerId - The partner's id.
 * @param payload - Partial partner fields to update.
 * @returns The updated partner info. */
export async function updatePartner(
  partnerId: string,
  payload: Partial<CreatePartnerPayload> & {
    channels?: Record<string, unknown>;
  },
): Promise<PartnerInfo> {
  return json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}`),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    ),
  );
}

/** Start a partner's runtime.
 * @param partnerId - The partner's id.
 * @returns The partner info with updated running state. */
export async function startPartner(partnerId: string): Promise<PartnerInfo> {
  return json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}/start`),
      { method: "POST" },
    ),
  );
}

/** Stop a running partner.
 * @param partnerId - The partner's id. */
export async function stopPartner(partnerId: string): Promise<void> {
  await json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}/stop`),
      { method: "POST" },
    ),
  );
}

/** Permanently delete a partner and its data.
 * @param partnerId - The partner's id. */
export async function destroyPartner(partnerId: string): Promise<void> {
  await json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}`),
      {
        method: "DELETE",
      },
    ),
  );
}

/** Fetch a partner's soul (personality) content.
 * @param partnerId - The partner's id.
 * @returns The soul prompt text (empty string if unset). */
export async function getPartnerSoul(partnerId: string): Promise<string> {
  const data = await json<{ content: string }>(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}/soul`),
    ),
  );
  return data.content ?? "";
}

/** Save a partner's soul (personality) content.
 * @param partnerId - The partner's id.
 * @param content - The soul prompt text. */
export async function savePartnerSoul(
  partnerId: string,
  content: string,
): Promise<void> {
  await json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}/soul`),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      },
    ),
  );
}

/** Fetch available soul sources (library templates + personas).
 * @returns Soul sources for the soul picker. */
export async function getSoulSources(): Promise<SoulSources> {
  return json(await apiFetch(apiUrl("/api/v1/partners/soul-sources")));
}

/** Create a new reusable soul template in the library.
 * @param id - Template id.
 * @param name - Display name.
 * @param content - Soul prompt text.
 * @returns The created template. */
export async function createSoulTemplate(
  id: string,
  name: string,
  content: string,
): Promise<SoulTemplate> {
  return json(
    await apiFetch(apiUrl("/api/v1/partners/souls"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, name, content }),
    }),
  );
}

/** Fetch all tool options available for partner configuration.
 * @returns Built-in, auto-mounted, and MCP tool options. */
export async function getToolOptions(): Promise<ToolOptions> {
  return json(await apiFetch(apiUrl("/api/v1/partners/tool-options")));
}

/** Fetch the partner slash-command palette.
 * @returns Array of command info entries. */
export async function getPartnerCommands(): Promise<PartnerCommandInfo[]> {
  const data = await json<{ commands: PartnerCommandInfo[] }>(
    await apiFetch(apiUrl("/api/v1/partners/commands/palette")),
  );
  return data.commands;
}

/** Fetch the assets attached to a partner.
 * @param partnerId - The partner's id.
 * @returns Knowledge bases, skills, and notebooks linked to the partner. */
export async function getPartnerAssets(
  partnerId: string,
): Promise<PartnerAssets> {
  return json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}/assets`),
    ),
  );
}

/** Add assets (knowledge bases, skills, notebooks) to a partner.
 * @param partnerId - The partner's id.
 * @param assets - Names of assets to attach.
 * @returns Updated assets and provisioning report. */
export async function addPartnerAssets(
  partnerId: string,
  assets: {
    knowledge_bases?: string[];
    skills?: string[];
    notebooks?: string[];
  },
): Promise<{ assets: PartnerAssets } & ProvisioningReport> {
  return json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}/assets`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(assets),
      },
    ),
  );
}

/** Remove a single asset from a partner.
 * @param partnerId - The partner's id.
 * @param assetType - The asset kind (knowledge_base, skill, or notebook).
 * @param name - The asset name.
 * @returns Updated assets list. */
export async function removePartnerAsset(
  partnerId: string,
  assetType: "knowledge_base" | "skill" | "notebook",
  name: string,
): Promise<{ assets: PartnerAssets }> {
  return json(
    await apiFetch(
      apiUrl(
        `/api/v1/partners/${encodeURIComponent(partnerId)}/assets/${assetType}/${encodeURIComponent(name)}`,
      ),
      { method: "DELETE" },
    ),
  );
}

/** Schema for one partner channel (config fields, secrets, availability). */
export interface ChannelSchemaEntry {
  name: string;
  display_name: string;
  default_config: Record<string, unknown>;
  secret_fields: string[];
  // null when the channel module failed to import (missing optional
  // dependency); `unavailable_reason` then carries the import error.
  json_schema: Record<string, unknown> | null;
  available?: boolean;
  unavailable_reason?: string;
}

/** Response containing schemas for all available partner channels. */
export interface ChannelsSchemaResponse {
  channels: Record<string, ChannelSchemaEntry>;
}

/** Fetch live channel schemas (availability reflects current server imports).
 * @returns Channel schemas keyed by channel name. */
export async function getChannelSchemas(): Promise<ChannelsSchemaResponse> {
  // no-store: availability reflects live server imports (e.g. a dependency
  // installed minutes ago) — a cached copy here shows phantom-missing channels.
  return json(
    await apiFetch(apiUrl("/api/v1/partners/channels/schema"), {
      cache: "no-store",
    }),
  );
}

/** Fetch a partner's conversation history.
 * @param partnerId - The partner's id.
 * @param options - Optional session key/id and limit.
 * @returns Array of message rows with role, content, and optional trace events. */
export async function getPartnerHistory(
  partnerId: string,
  options?: { sessionKey?: string; sessionId?: string; limit?: number },
): Promise<
  {
    role: string;
    content: string;
    timestamp?: string;
    channel?: string;
    attachments?: Record<string, unknown>[];
    /** Persisted turn trace (assistant rows only) for rehydrating activity. */
    events?: Record<string, unknown>[];
  }[]
> {
  const params = new URLSearchParams();
  if (options?.sessionKey) params.set("session_key", options.sessionKey);
  if (options?.sessionId) params.set("session_id", options.sessionId);
  if (options?.limit) params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return json(
    await apiFetch(
      apiUrl(
        `/api/v1/partners/${encodeURIComponent(partnerId)}/history${query}`,
      ),
    ),
  );
}

/** List all conversation sessions for a partner.
 * @param partnerId - The partner's id.
 * @returns Array of session summaries. */
export async function getPartnerSessions(
  partnerId: string,
): Promise<PartnerSessionInfo[]> {
  return json(
    await apiFetch(
      apiUrl(`/api/v1/partners/${encodeURIComponent(partnerId)}/sessions`),
      { cache: "no-store" },
    ),
  );
}

async function postSessionAction(
  partnerId: string,
  action: "archive" | "resume" | "delete",
  sessionKey: string,
): Promise<void> {
  await apiFetch(
    apiUrl(
      `/api/v1/partners/${encodeURIComponent(partnerId)}/sessions/${action}`,
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_key: sessionKey }),
    },
  );
}

export function archivePartnerSession(partnerId: string, sessionKey: string) {
  return postSessionAction(partnerId, "archive", sessionKey);
}

export function resumePartnerSession(partnerId: string, sessionKey: string) {
  return postSessionAction(partnerId, "resume", sessionKey);
}

export function deletePartnerSession(partnerId: string, sessionKey: string) {
  return postSessionAction(partnerId, "delete", sessionKey);
}

/** Branch a partner session into a new conversation.
 * @param partnerId - The partner's id.
 * @param sourceKey - The source session key to branch from.
 * @param newKey - The new session key for the branch.
 * @returns The new branched session info. */
export async function branchPartnerSession(
  partnerId: string,
  sourceKey: string,
  newKey: string,
): Promise<{ session: PartnerSessionInfo }> {
  return json(
    await apiFetch(
      apiUrl(
        `/api/v1/partners/${encodeURIComponent(partnerId)}/sessions/branch`,
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_key: sourceKey, new_key: newKey }),
      },
    ),
  );
}
