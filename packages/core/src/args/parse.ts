/**
 * Shared flag parser for canon verbs. Handles `--flag value`, `--flag=value`,
 * boolean flags, and positional args. Returns `{ error }` on malformed input --
 * callers map that to exit 2, never throw.
 */

export interface ParseSpec {
  /** Flags that take a string value, e.g. ["project-root", "note"]. */
  readonly valueFlags?: readonly string[];
  /** Flags that are boolean presence switches, e.g. ["json", "confirm"]. */
  readonly boolFlags?: readonly string[];
  /** Maximum positional args allowed (default: unlimited). */
  readonly maxPositional?: number;
}

export interface ParsedArgs {
  readonly values: Readonly<Record<string, string>>;
  readonly flags: Readonly<Record<string, boolean>>;
  readonly positional: readonly string[];
  readonly error?: string;
}

export function parseArgs(argv: readonly string[], spec: ParseSpec = {}): ParsedArgs {
  const valueFlags = new Set(spec.valueFlags ?? []);
  const boolFlags = new Set(spec.boolFlags ?? []);
  const values: Record<string, string> = {};
  const flags: Record<string, boolean> = {};
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === undefined) {
      continue;
    }
    if (raw === "--") {
      continue;
    }
    if (raw.startsWith("--")) {
      const eq = raw.indexOf("=");
      const name = eq === -1 ? raw.slice(2) : raw.slice(2, eq);
      if (boolFlags.has(name)) {
        if (eq !== -1) {
          return { values, flags, positional, error: `flag --${name} does not take a value` };
        }
        flags[name] = true;
        continue;
      }
      if (valueFlags.has(name)) {
        if (eq !== -1) {
          values[name] = raw.slice(eq + 1);
          continue;
        }
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
          return { values, flags, positional, error: `flag --${name} requires a value` };
        }
        values[name] = next;
        i++;
        continue;
      }
      return { values, flags, positional, error: `unknown flag --${name}` };
    }
    positional.push(raw);
  }

  if (spec.maxPositional !== undefined && positional.length > spec.maxPositional) {
    return {
      values,
      flags,
      positional,
      error: `too many arguments: expected at most ${spec.maxPositional}`,
    };
  }
  return { values, flags, positional };
}
