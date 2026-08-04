/** Extract the first value from a Next.js search-param (string | string[] | undefined).
 * @param value - The raw param value from Next.js router/searchParams.
 * @returns The first string if an array, the string itself, or undefined. */
export function firstParam(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
