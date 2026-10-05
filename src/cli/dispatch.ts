/**
 * Flat verb registry + dispatcher for the `canon` CLI.
 *
 * Registry model (mirrors directive's dispatch.ts, reduced):
 *  - CLI_MODULE_VERBS: stems whose handler lives at src/cli/<stem>.ts
 *    exporting `run(argv): number | Promise<number>`.
 *  - VERB_ALIASES: task-style names (colon form) -> canonical stems.
 *  - Space-separated forms route by colon-joining the first two tokens
 *    (`canon scope new` -> `scope:new`).
 *  - `collection:<action>` / `collection <action>` resolve to `collection`
 *    with the action as the first argument (IMPL §5.3).
 *
 * Exit codes: 0 ok, 1 rejected/not-ready, 2 misconfig/usage (incl. unknown verb).
 * Handlers never call process.exit(); only bin.ts exits.
 */

import { createRequire } from "node:module";
import { BUILD_CHANNEL } from "../build-info.js";

const COLLECTION_ACTIONS = [
  "status",
  "opt-in",
  "decline",
  "opt-out",
  "identity",
  "metric",
] as const;

export const CLI_MODULE_VERBS = [
  "check",
  "collection",
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
  "scope-defer",
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
  "collection:decline": "collection",
  "collection:identity": "collection",
  "collection:metric": "collection",
  "collection:opt-in": "collection",
  "collection:opt-out": "collection",
  "collection:status": "collection",
  "issue:sync": "issue-sync",
  "pr:finish": "pr-finish",
  "pr:watch": "pr-watch",
  "review:monitor": "review-monitor",
  "scope:complete": "scope-complete",
  "scope:defer": "scope-defer",
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
  // List the six collection:* verbs; omit the bare module stem (IMPL §5.3).
  const all = new Set<string>([
    ...CLI_MODULE_VERBS.filter((v) => v !== "collection"),
    ...Object.keys(VERB_ALIASES),
  ]);
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
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return `canon ${pkg.version ?? "unknown"} (${BUILD_CHANNEL})\n`;
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

function collectionActionFromVerb(verb: string): string | null {
  if (!verb.startsWith("collection:")) {
    return null;
  }
  const action = verb.slice("collection:".length);
  return (COLLECTION_ACTIONS as readonly string[]).includes(action) ? action : null;
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

  let canonical: string | null = null;
  let rest: string[] = argv.slice(1);

  const collAction = collectionActionFromVerb(first);
  if (collAction !== null) {
    canonical = "collection";
    rest = [collAction, ...argv.slice(1)];
  } else if (first === "collection") {
    canonical = "collection";
    // `canon collection <action> ...` — action already at rest[0]
  } else {
    canonical = resolveCanonicalVerb(first);
    // Space-separated form: `canon scope new ...` -> scope:new
    if (canonical === null && argv.length >= 2) {
      const second = argv[1];
      if (second !== undefined && !second.startsWith("-")) {
        const joinedVerb = `${first}:${second}`;
        const joinedAction = collectionActionFromVerb(joinedVerb);
        if (joinedAction !== null) {
          canonical = "collection";
          rest = [joinedAction, ...argv.slice(2)];
        } else {
          const joined = resolveCanonicalVerb(joinedVerb);
          if (joined !== null) {
            canonical = joined;
            rest = argv.slice(2);
          }
        }
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
