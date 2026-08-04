import { apiFetch, apiUrl } from "@/lib/api";
import { invalidateClientCache, withClientCache } from "@/lib/client-cache";

const PERSONAS_CACHE_PREFIX = "personas:";

/** Whether a persona was created by the user or provisioned by an admin. */
export type PersonaSource = "user" | "admin";

/** Lightweight persona metadata returned by the list endpoint. */
export interface PersonaInfo {
  name: string;
  description: string;
  source: PersonaSource;
  read_only: boolean;
}

/** Full persona detail including the system-prompt content. */
export interface PersonaDetail extends PersonaInfo {
  content: string;
}

/** Payload for creating a new persona. */
export interface CreatePersonaPayload {
  name: string;
  description: string;
  content: string;
}

/** Payload for updating an existing persona. */
export interface UpdatePersonaPayload {
  description?: string;
  content?: string;
  rename_to?: string;
}

function normalizeSource(raw: unknown): PersonaSource {
  return raw === "admin" ? "admin" : "user";
}

async function asJson(response: Response) {
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.detail) detail = String(body.detail);
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return response.json();
}

function normalizeInfo(item: {
  name?: unknown;
  description?: unknown;
  source?: unknown;
  read_only?: unknown;
}): PersonaInfo {
  return {
    name: String(item?.name ?? ""),
    description: String(item?.description ?? ""),
    source: normalizeSource(item?.source),
    read_only: Boolean(item?.read_only),
  };
}

/** List all personas (user + admin), with client-side caching.
 * @param options - Pass `force` to bypass the cache.
 * @returns Array of persona info entries. */
export async function listPersonas(options?: {
  force?: boolean;
}): Promise<PersonaInfo[]> {
  return withClientCache<PersonaInfo[]>(
    `${PERSONAS_CACHE_PREFIX}list`,
    async () => {
      const response = await apiFetch(apiUrl("/api/v1/personas/list"), {
        cache: "no-store",
      });
      const data = await asJson(response);
      const items = Array.isArray(data?.personas) ? data.personas : [];
      return items.map(normalizeInfo);
    },
    { force: options?.force },
  );
}

/** Fetch a single persona by name, including its content.
 * @param name - The persona name.
 * @returns The persona detail. */
export async function getPersona(name: string): Promise<PersonaDetail> {
  const response = await apiFetch(
    apiUrl(`/api/v1/personas/${encodeURIComponent(name)}`),
    {
      cache: "no-store",
    },
  );
  const data = await asJson(response);
  return {
    ...normalizeInfo({ ...data, name: data?.name ?? name }),
    content: String(data?.content ?? ""),
  };
}

/** Create a new persona.
 * @param payload - Name, description, and content.
 * @returns The created persona info. */
export async function createPersona(
  payload: CreatePersonaPayload,
): Promise<PersonaInfo> {
  const response = await apiFetch(apiUrl("/api/v1/personas/create"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: payload.name,
      description: payload.description,
      content: payload.content,
    }),
  });
  const data = await asJson(response);
  invalidatePersonasCache();
  return normalizeInfo({ ...data, name: data?.name ?? payload.name });
}

/** Update an existing persona (description, content, or rename).
 * @param name - The current persona name.
 * @param payload - Fields to update.
 * @returns The updated persona info. */
export async function updatePersona(
  name: string,
  payload: UpdatePersonaPayload,
): Promise<PersonaInfo> {
  const response = await apiFetch(
    apiUrl(`/api/v1/personas/${encodeURIComponent(name)}`),
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  const data = await asJson(response);
  invalidatePersonasCache();
  return normalizeInfo({ ...data, name: data?.name ?? name });
}

/** Delete a persona by name.
 * @param name - The persona name. */
export async function deletePersona(name: string): Promise<void> {
  const response = await apiFetch(
    apiUrl(`/api/v1/personas/${encodeURIComponent(name)}`),
    {
      method: "DELETE",
    },
  );
  await asJson(response);
  invalidatePersonasCache();
}

/** Drop all cached persona responses so the next list/get refetches. */
export function invalidatePersonasCache() {
  invalidateClientCache(PERSONAS_CACHE_PREFIX);
}
