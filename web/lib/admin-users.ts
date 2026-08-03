/**
 * Case-insensitive filter backing the admin Users search box. Matches
 * against username, first name, surname, and registration number.
 * An empty / whitespace-only query returns the input list unchanged.
 *
 * Generic over `{ username }` (rather than importing UserRecord) so the
 * module stays alias-free and loadable by the node unit tests.
 */
export function filterUsersByQuery<T extends { username: string }>(
  users: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return users;
  return users.filter((user) => {
    const haystack = [
      user.username,
      (user as Record<string, unknown>).first_name,
      (user as Record<string, unknown>).surname,
      (user as Record<string, unknown>).registration_number,
    ]
      .filter((v) => typeof v === "string" && v)
      .join(" ")
      .toLowerCase();
    return haystack.includes(normalized);
  });
}
