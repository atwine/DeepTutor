import { apiFetch, apiUrl } from "@/lib/api";

/** Status of the OpenAI Codex OAuth connection flow. */
export type CodexOAuthStatus = {
  connection: "disconnected" | "authorizing" | "connected" | "error";
  operation_id: string | null;
  operation_state:
    | "waiting"
    | "exchanging"
    | "fetching_models"
    | "completed"
    | "cancelled"
    | "expired"
    | "failed"
    | null;
  authorize_url: string | null;
  expires_in: number | null;
  callback_port: number | null;
  callback_forward_port: number | null;
  redirect_uri: string | null;
  model_count: number;
  catalog_source:
    | "live"
    | "fresh-cache"
    | "revalidated-cache"
    | "stale-cache"
    | null;
  catalog_fetched_at: number | null;
  active_model: string | null;
  activated: boolean;
  error_code: string | null;
};

/** Payload returned when starting a Codex OAuth login flow. */
export type CodexLoginStart = {
  operation_id: string;
  authorize_url: string;
  expires_in: number;
  callback_port: number;
  callback_forward_port: number;
  redirect_uri: string;
  ssh_forward_command: string;
};

/** Connection guidance for a remote (SSH-forwarded) Codex OAuth callback. */
export type CodexRemoteGuidance = Omit<CodexLoginStart, "ssh_forward_command">;

/** Error thrown by the Codex OAuth API client, carrying a stable error code. */
export class CodexOAuthApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CodexOAuthApiError";
    this.code = code;
  }
}

const BASE = "/api/v1/settings/providers/openai-codex";

/**
 * Check whether a hostname is a loopback address (localhost, 127.x.x.x, ::1).
 *
 * @param hostname - Hostname to check.
 * @returns True if the hostname is a loopback address.
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized === "[::1]"
  ) {
    return true;
  }

  const octets = normalized.split(".");
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every(
      (octet) =>
        /^\d+$/.test(octet) && Number(octet) >= 0 && Number(octet) <= 255,
    )
  );
}

/**
 * Build an SSH port-forwarding command for a remote Codex OAuth callback.
 *
 * @param callbackPort - Local port to forward.
 * @param hostname - Remote server hostname.
 * @param forwardPort - Remote port to forward to.
 * @returns The SSH command string.
 */
export function buildSshForwardCommand(
  callbackPort: number,
  hostname: string,
  forwardPort: number,
): string {
  const serverHost = hostname.trim() || "<server-host>";
  return `ssh -N -L ${callbackPort}:127.0.0.1:${forwardPort} <ssh-user>@${serverHost}`;
}

/**
 * Derive remote connection guidance from the current OAuth status and login start.
 *
 * @param status - Current OAuth status, or null.
 * @param loginStart - Login start payload, or null.
 * @returns Connection guidance if the operation is waiting, otherwise null.
 */
export function codexRemoteGuidance(
  status: CodexOAuthStatus | null,
  loginStart: CodexLoginStart | null,
): CodexRemoteGuidance | null {
  if (status?.operation_state !== "waiting" || !status.operation_id) {
    return null;
  }
  const matchingStart =
    loginStart?.operation_id === status.operation_id ? loginStart : null;
  const authorizeUrl = status.authorize_url ?? matchingStart?.authorize_url;
  const expiresIn = status.expires_in ?? matchingStart?.expires_in;
  const callbackPort = status.callback_port ?? matchingStart?.callback_port;
  const callbackForwardPort =
    status.callback_forward_port ?? matchingStart?.callback_forward_port;
  const redirectUri = status.redirect_uri ?? matchingStart?.redirect_uri;
  if (
    !authorizeUrl ||
    expiresIn == null ||
    callbackPort == null ||
    callbackForwardPort == null ||
    !redirectUri
  ) {
    return null;
  }
  return {
    operation_id: status.operation_id,
    authorize_url: authorizeUrl,
    expires_in: expiresIn,
    callback_port: callbackPort,
    callback_forward_port: callbackForwardPort,
    redirect_uri: redirectUri,
  };
}

/**
 * Send a request to the Codex OAuth API and parse the JSON response.
 *
 * @param path - API path relative to the Codex base.
 * @param method - HTTP method ("GET" or "POST").
 * @param fetchImpl - Fetch implementation to use (defaults to apiFetch).
 * @returns The parsed JSON response.
 */
export async function requestCodex<T>(
  path: string,
  method: "GET" | "POST",
  fetchImpl: typeof apiFetch = apiFetch,
): Promise<T> {
  const response = await fetchImpl(apiUrl(`${BASE}${path}`), {
    method,
    skipAuthRedirect: true,
  });
  if (response.ok) {
    try {
      return (await response.json()) as T;
    } catch {
      throw new CodexOAuthApiError(
        "invalid_response",
        "DeepTutor returned an invalid Codex OAuth response.",
      );
    }
  }

  let code = `http_${response.status}`;
  let message = "Codex request failed.";
  try {
    const payload = (await response.json()) as {
      detail?: { code?: string; message?: string };
    };
    if (payload.detail?.code) code = payload.detail.code;
    if (payload.detail?.message) message = payload.detail.message;
  } catch {
    // The UI renders only the stable code mapping below.
  }
  throw new CodexOAuthApiError(code, message);
}

/** Fetch the current Codex OAuth connection status. */
export function getCodexStatus(): Promise<CodexOAuthStatus> {
  return requestCodex<CodexOAuthStatus>("/oauth/status", "GET");
}

/** Start a new Codex OAuth login flow. */
export function startCodexLogin(): Promise<CodexLoginStart> {
  return requestCodex<CodexLoginStart>("/oauth/start", "POST");
}

/** Cancel an in-progress Codex OAuth login flow. */
export function cancelCodexLogin(): Promise<CodexOAuthStatus> {
  return requestCodex<CodexOAuthStatus>("/oauth/cancel", "POST");
}

/** Trigger a refresh of the Codex model catalog. */
export function refreshCodexModels(): Promise<CodexOAuthStatus> {
  return requestCodex<CodexOAuthStatus>("/models/refresh", "POST");
}

/** Log out of the Codex OAuth connection. */
export function logoutCodex(): Promise<CodexOAuthStatus> {
  return requestCodex<CodexOAuthStatus>("/oauth/logout", "POST");
}

/**
 * Determine whether the UI should keep polling for Codex OAuth status updates.
 *
 * @param status - Current OAuth status.
 * @returns True if the operation is in an in-progress state.
 */
export function shouldPollCodexStatus(status: CodexOAuthStatus): boolean {
  return (
    status.operation_state === "waiting" ||
    status.operation_state === "exchanging" ||
    status.operation_state === "fetching_models"
  );
}

/**
 * Map a Codex error code to an i18n message key.
 *
 * @param code - Error code from the API, or null.
 * @returns i18n key for the localized error message.
 */
export function codexErrorMessageKey(code: string | null): string {
  if (code === "catalog_unavailable" || code === "catalog_invalid") {
    return "codex.oauth.catalogFailed";
  }
  if (code === "inference_in_progress") {
    return "codex.oauth.inferenceActive";
  }
  if (code === "login_timeout") return "codex.oauth.callbackMissing";
  if (code === "callback_unavailable") {
    return "codex.oauth.callbackUnavailable";
  }
  if (code === "invalid_response") return "codex.oauth.invalidResponse";
  if (code === "login_cancelled") return "codex.oauth.cancelled";
  if (code === "authorization_denied") return "codex.oauth.denied";
  return "codex.oauth.requestFailed";
}

/**
 * Derive an i18n status message key from the current Codex OAuth status.
 *
 * @param status - Current OAuth status.
 * @returns i18n key for the localized status message.
 */
export function codexStatusMessageKey(status: CodexOAuthStatus): string {
  if (status.error_code) return codexErrorMessageKey(status.error_code);
  if (shouldPollCodexStatus(status)) return "codex.oauth.waiting";
  if (status.activated && status.active_model) return "codex.oauth.activated";
  if (status.connection === "connected") return "codex.oauth.connected";
  if (status.operation_state === "cancelled") return "codex.oauth.cancelled";
  if (status.operation_state === "expired") return "codex.oauth.expired";
  return "codex.oauth.disconnected";
}
