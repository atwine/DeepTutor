/** A single content part within a multi-part message. */
export type MessageContentItem = {
  type: string;
  text?: string;
  content?: string;
  message?: string;
  url?: string;
  alt?: string;
};

/** Untyped raw message content from the backend. */
export type RawMessageContent = unknown;

function stringifyObject(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeObjectContent(item: Record<string, unknown>): string {
  for (const key of ["text", "content", "message", "alt"]) {
    const value = item[key];
    if (typeof value === "string" && value) return value;
  }
  if (item.type === "image" || item.type === "image_url") return "[image]";
  return stringifyObject(item);
}

/**
 * Normalize raw message content (string, array, or object) into a plain string.
 *
 * @param content - Raw content from the backend.
 * @returns A flattened string representation.
 */
export function normalizeMessageContent(content: RawMessageContent): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (!item || typeof item !== "object") return String(item);
        return normalizeObjectContent(item as Record<string, unknown>);
      })
      .filter(Boolean)
      .join(" ");
  }
  if (typeof content === "object") {
    return normalizeObjectContent(content as Record<string, unknown>);
  }
  return String(content);
}

/**
 * Truncate text to a maximum length, appending an ellipsis if cut.
 *
 * @param text - Text to truncate.
 * @param maxLength - Maximum number of characters to keep.
 * @returns The truncated string.
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "…";
}
