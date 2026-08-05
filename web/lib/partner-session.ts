/**
 * Per-partner web session key, persisted in localStorage so a refresh / tab
 * switch / navigation reattaches to the SAME conversation. The key is the
 * canonical session id the backend stores under (colon-free, so it doubles as
 * the filename stem and the id used by resume / delete / branch).
 */

function storageKey(partnerId: string): string {
  return `partner-session:${partnerId}`;
}

/** Generate a fresh random partner session key. */
export function freshPartnerSessionKey(): string {
  return `web-${Math.random().toString(36).slice(2, 10)}`;
}

/** Load the persisted partner session key, creating one if none exists.
 * @param partnerId - The partner's id.
 * @returns The session key (existing or freshly minted). */
export function loadPartnerSessionKey(partnerId: string): string {
  try {
    const existing = window.localStorage.getItem(storageKey(partnerId));
    if (existing) return existing;
    const fresh = freshPartnerSessionKey();
    window.localStorage.setItem(storageKey(partnerId), fresh);
    return fresh;
  } catch {
    return freshPartnerSessionKey();
  }
}

/** Persist a partner session key to localStorage.
 * @param partnerId - The partner's id.
 * @param key - The session key to store. */
export function persistPartnerSessionKey(partnerId: string, key: string): void {
  try {
    window.localStorage.setItem(storageKey(partnerId), key);
  } catch {
    /* private mode / storage disabled — in-memory only */
  }
}
