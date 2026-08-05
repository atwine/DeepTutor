/** Regex pattern string for valid skill names (lowercase alphanumeric + hyphens). */
export const SKILL_NAME_PATTERN = "^[a-z0-9][a-z0-9-]{0,63}$";
/** Compiled regex for validating skill name slugs. */
export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Convert a raw string into a valid skill name slug.
 * @param raw - The input string.
 * @returns Lowercase slug with spaces/underscores as hyphens and invalid chars removed. */
export function slugifySkillName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "");
}

/** Check whether a string is a valid skill name slug.
 * @param value - The string to test.
 * @returns True if the value matches the skill name pattern. */
export function isValidSkillName(value: string): boolean {
  return SKILL_NAME_RE.test(value);
}
