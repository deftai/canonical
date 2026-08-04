/**
 * `--json` output convention: one line, keys sorted, snake_case keys,
 * written to stdout by the caller. Diagnostics stay on stderr.
 */
export function renderJson(payload: Record<string, unknown>): string {
  const sorted = Object.fromEntries(
    Object.keys(payload)
      .sort()
      .map((k) => [k, payload[k]]),
  );
  return JSON.stringify(sorted);
}
