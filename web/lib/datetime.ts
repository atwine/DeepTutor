/** Supported UI language codes. */
export type Language = "en" | "zh";

/**
 * Map a language code to a BCP 47 locale tag.
 *
 * @param lang - Language code ("en" or "zh").
 * @returns The corresponding locale string.
 */
export function getLocale(lang: Language): string {
  return lang === "zh" ? "zh-CN" : "en-US";
}

/**
 * Format a date according to the given language and options.
 *
 * @param date - Date to format.
 * @param lang - Language code for locale selection.
 * @param options - Intl.DateTimeFormat options (defaults to year/month/day).
 * @returns The formatted date string.
 */
export function formatDate(
  date: Date,
  lang: Language,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
): string {
  return new Intl.DateTimeFormat(getLocale(lang), options).format(date);
}

/**
 * Format a time according to the given language and options.
 *
 * @param date - Date to format.
 * @param lang - Language code for locale selection.
 * @param options - Intl.DateTimeFormat options (defaults to hour/minute).
 * @returns The formatted time string.
 */
export function formatTime(
  date: Date,
  lang: Language,
  options: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" },
): string {
  return new Intl.DateTimeFormat(getLocale(lang), options).format(date);
}
