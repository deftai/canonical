/**
 * Flat verb registry + dispatcher for the `canon` CLI.
 *
 * Registry model (mirrors directive's dispatch.ts, reduced):
 *  - CLI_MODULE_VERBS: stems whose handler lives at src/cli/<stem>.ts
 *    exporting `run(argv): number | Promise<number>`.
 *  - VERB_ALIASES: task-style names (colon form) -> canonical stems.
 *  - Space-separated forms route by colon-joining the first two tokens
 *    (`canon scope new` -> `scope:new`).
 *
 * Exit codes: 0 ok, 1 rejected/not-ready, 2 misconfig/usage (incl. unknown verb).
 * Handlers never call process.exit(); only bin.ts exits.
 */

import { createRequire } from "node:module";

export const CLI_MODULE_VERBS = [
  "check",
  "collection-decline",
  "collection-identity",
  "collection-metric",
  "collection-opt-in",
  "collection-opt-out",
  "collection-status",
  "feedback",
  "init",
  "issue-sync",
  "orient",
  "policy",
  "pr-finish",
  "pr-watch",
  "render",
  "review-monitor",
  "scope-complete",
  "scope-new",
  "scope-start",
  "scope-stop",
  "setup",
  "state-validate",
  "swarm-run",
  "triage",
  "update",
  "verify-branch",
  "verify-encoding",
  "verify-forward-coverage",
  "work-next",
] as const;

export const VERB_ALIASES: Readonly<Record<string, string>> = {
  "collection:decline": "collection-decline",
  "collection:identity": "collection-identity",
  "collection:metric": "collection-metric",
  "collection:opt-in": "collection-opt-in",
  "collection:opt-out": "collection-opt-out",
  "collection:status": "collection-status",
  "issue:sync": "issue-sync",
  "pr:finish": "pr-finish",
  "pr:watch": "pr-watch",
  "review:monitor": "review-monitor",
  "scope:complete": "scope-complete",
  "scope:new": "scope-new",
  "scope:start": "scope-start",
  "scope:stop": "scope-stop",
  "state:validate": "state-validate",
  "swarm:run": "swarm-run",
  "verify:branch": "verify-branch",
  "verify:encoding": "verify-encoding",
  "verify:forward-coverage": "verify-forward-coverage",
  "work:next": "work-next",
};

export type CommandHandler = (argv: string[]) => number | Promise<number>;

export interface DispatchIo {
  readonly writeOut: (text: string) => void;
  readonly writeErr: (text: string) => void;
}

export function defaultIo(): DispatchIo {
  return {
    writeOut: (t) => process.stdout.write(t),
    writeErr: (t) => process.stderr.write(t),
  };
}

export function resolveCanonicalVerb(verb: string): string | null {
  if ((CLI_MODULE_VERBS as readonly string[]).includes(verb)) {
    return verb;
  }
  const alias = VERB_ALIASES[verb];
  if (alias !== undefined) {
    return alias;
  }
  return null;
}

export function registeredVerbs(): readonly string[] {
  const all = new Set<string>([...CLI_MODULE_VERBS, ...Object.keys(VERB_ALIASES)]);
  return [...all].sort();
}

const handlerCache = new Map<string, Promise<CommandHandler>>();

export function resetHandlerCacheForTests(): void {
  handlerCache.clear();
}

function loadHandler(canonical: string): Promise<CommandHandler> {
  let cached = handlerCache.get(canonical);
  if (cached === undefined) {
    cached = import(`./${canonical}.js`).then((mod: Record<string, unknown>) => {
      const fn = mod.run;
      if (typeof fn !== "function") {
        throw new Error(`handler module ${canonical} has no run() export`);
      }
      return fn as CommandHandler;
    });
    handlerCache.set(canonical, cached);
  }
  return cached;
}

function versionBanner(): string {
  // Read the real version from this package's manifest -- dist/cli/ and
  // src/cli/ both sit two levels below the package root.
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return `canon ${pkg.version ?? "unknown"}\n`;
  } catch {
    return "canon unknown\n";
  }
}

function printHelp(io: DispatchIo): void {
  io.writeOut("canon -- deterministic verbs for the canonical pack\n\n");
  io.writeOut("Usage: canon <verb> [args]\n\nVerbs:\n");
  for (const verb of registeredVerbs()) {
    io.writeOut(`  ${verb}\n`);
  }
  io.writeOut("\nExit codes: 0 ok, 1 rejected/not ready, 2 misconfig/error\n");
}

export async function dispatch(argv: string[], io: DispatchIo = defaultIo()): Promise<number> {
  const first = argv[0];
  if (first === "--version" || first === "-V") {
    io.writeOut(versionBanner());
    return 0;
  }
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    printHelp(io);
    return 0;
  }

  let canonical = resolveCanonicalVerb(first);
  let rest = argv.slice(1);

  // Space-separated form: `canon scope new ...` -> scope:new
  if (canonical === null && argv.length >= 2) {
    const second = argv[1];
    if (second !== undefined && !second.startsWith("-")) {
      const joined = resolveCanonicalVerb(`${first}:${second}`);
      if (joined !== null) {
        canonical = joined;
        rest = argv.slice(2);
      }
    }
  }

  if (canonical === null) {
    io.writeErr(`canon: unknown verb '${first}'\n`);
    io.writeErr("  Run `canon --help` for the verb list.\n");
    return 2;
  }

  try {
    const handler = await loadHandler(canonical);
    const code = await handler(rest);
    return typeof code === "number" ? code : 2;
  } catch (err: unknown) {
    io.writeErr(`canon: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }
}
