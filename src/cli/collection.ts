/**
 * Table-driven `canon collection <action>` / `collection:<action>` (D1 / ARC-2).
 */
import { parseArgs, renderJson } from "../args/index.js";
import { BUILD_CHANNEL } from "../build-info.js";
import {
  buildSessionSummaryDimensions,
  bumpAgentTurn,
  clearSession,
  contactClear,
  contactShow,
  contactUpdate,
  decline,
  dimensionsJsonByteLength,
  emitUsage,
  optIn,
  optOut,
  parseContact,
  status,
  USAGE_DIMENSIONS_MAX_JSON_BYTES,
  type UsageDimensions,
} from "../collection/index.js";

type Parsed = ReturnType<typeof parseArgs>;

type Action = {
  readonly valueFlags: readonly string[];
  readonly boolFlags: readonly string[];
  readonly maxPositional?: number;
  readonly help?: () => void;
  readonly run: (parsed: Parsed, root: string) => number | Promise<number>;
};

function out(
  json: boolean,
  code: number,
  payload: Record<string, unknown>,
  text: string,
  opts: { alwaysStdout?: boolean } = {},
): number {
  if (json) {
    process.stdout.write(`${renderJson(payload)}\n`);
    return code;
  }
  if (opts.alwaysStdout === true || code === 0) {
    if (text.length > 0) {
      process.stdout.write(`${text}\n`);
    }
  } else {
    process.stderr.write(`${text}\n`);
  }
  return code;
}

function parseDimensionsFlag(
  raw: string | undefined,
): { ok: true; dimensions?: UsageDimensions } | { ok: false; message: string } {
  if (raw === undefined) {
    return { ok: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: "--dimensions must be valid JSON" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "--dimensions must be a JSON object" };
  }
  const dimensions: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return {
        ok: false,
        message: `--dimensions values must be string|number|boolean (bad key '${key}')`,
      };
    }
    dimensions[key] = value;
  }
  if (dimensionsJsonByteLength(dimensions) > USAGE_DIMENSIONS_MAX_JSON_BYTES) {
    return { ok: false, message: "--dimensions payload exceeds 2KiB" };
  }
  return { ok: true, dimensions };
}

function identityHelp(): void {
  process.stdout.write(`canon collection:identity — manage reply-channel identity

Usage:
  canon collection:identity --show
  canon collection:identity --clear
  canon collection:identity --update [--first-name=…] [--last-name=…] [--email=…] [--mobile=…]
  task -x collection:identity -- --show|--clear|--update …

Notes:
  --show prints identity=<identified|anonymous> only.
  Contact is stored on the server; the client keeps an attributed flag.
`);
}

const ACTIONS: Record<string, Action> = {
  status: {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    run: (parsed, root) => {
      const result = status(root);
      const message = `${result.message} channel=${BUILD_CHANNEL}`;
      if (parsed.flags.json === true) {
        return out(
          true,
          result.code,
          {
            channel: BUILD_CHANNEL,
            code: result.code,
            consent_version: result.status.consentVersion ?? null,
            expires_at: result.status.expiresAt ?? null,
            identity: result.status.identity,
            identity_mode: result.status.identityMode,
            install_id: result.status.installId ?? null,
            message,
            metrics: result.status.metrics,
            metrics_mode: result.status.metricsMode,
            prompt_state: result.status.promptState,
            scopes: result.status.scopes,
            submissions: result.status.submissions,
          },
          message,
        );
      }
      return out(false, result.code, {}, message);
    },
  },
  "opt-in": {
    valueFlags: ["project-root", "email", "first-name", "last-name", "mobile"],
    boolFlags: ["json", "confirm"],
    run: async (parsed, root) => {
      const fields = {
        ...(parsed.values["first-name"] !== undefined
          ? { firstName: parsed.values["first-name"] }
          : {}),
        ...(parsed.values["last-name"] !== undefined
          ? { lastName: parsed.values["last-name"] }
          : {}),
        ...(parsed.values.email !== undefined ? { email: parsed.values.email } : {}),
        ...(parsed.values.mobile !== undefined ? { mobile: parsed.values.mobile } : {}),
      };
      const parsedContact = parseContact(fields);
      if (!parsedContact.ok) {
        return out(
          parsed.flags.json === true,
          2,
          { code: 2, message: parsedContact.message },
          parsedContact.message,
        );
      }
      const result = await optIn(root, parsedContact.sdk, {
        confirm: parsed.flags.confirm === true,
      });
      return out(
        parsed.flags.json === true,
        result.code,
        {
          code: result.code,
          message: result.message,
          scopes: result.scopes ?? null,
          metricsMode: result.metricsMode ?? null,
        },
        result.message,
      );
    },
  },
  decline: {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    run: (parsed, root) => {
      const result = decline(root);
      return out(
        parsed.flags.json === true,
        result.code,
        { code: result.code, message: result.message },
        result.message,
      );
    },
  },
  "opt-out": {
    valueFlags: ["project-root"],
    boolFlags: ["json", "confirm", "identity"],
    run: async (parsed, root) => {
      const result = await optOut(root, {
        confirm: parsed.flags.confirm === true,
        identity: parsed.flags.identity === true,
      });
      return out(
        parsed.flags.json === true,
        result.code,
        { code: result.code, message: result.message },
        result.message,
      );
    },
  },
  identity: {
    valueFlags: ["project-root", "first-name", "last-name", "email", "mobile"],
    boolFlags: ["json", "show", "clear", "update"],
    help: identityHelp,
    run: async (parsed, root) => {
      const modes = [parsed.flags.show, parsed.flags.clear, parsed.flags.update].filter(
        (v) => v === true,
      );
      if (modes.length !== 1) {
        process.stderr.write(
          "canon: collection-identity: exactly one of --show | --clear | --update is required\n",
        );
        return 2;
      }
      const json = parsed.flags.json === true;
      if (parsed.flags.show === true) {
        const result = contactShow(root);
        return out(
          json,
          result.code,
          { code: result.code, message: result.message, mode: result.mode },
          result.message,
          { alwaysStdout: true },
        );
      }
      if (parsed.flags.clear === true) {
        const result = await contactClear(root);
        return out(
          json,
          result.code,
          { code: result.code, message: result.message, mode: result.mode },
          result.message,
        );
      }
      const fields = {
        ...(parsed.values["first-name"] !== undefined
          ? { firstName: parsed.values["first-name"] }
          : {}),
        ...(parsed.values["last-name"] !== undefined
          ? { lastName: parsed.values["last-name"] }
          : {}),
        ...(parsed.values.email !== undefined ? { email: parsed.values.email } : {}),
        ...(parsed.values.mobile !== undefined ? { mobile: parsed.values.mobile } : {}),
      };
      const result = await contactUpdate(root, fields);
      return out(
        json,
        result.code,
        { code: result.code, message: result.message, mode: result.mode },
        result.message,
      );
    },
  },
  metric: {
    valueFlags: ["project-root", "metric", "value", "period", "dimensions"],
    boolFlags: ["json", "debug"],
    run: async (parsed, root) => {
      const metric = parsed.values.metric;
      const valueRaw = parsed.values.value;
      if (metric === undefined || metric.trim().length === 0) {
        process.stderr.write("canon: collection-metric: --metric is required\n");
        return 2;
      }
      if (valueRaw === undefined) {
        process.stderr.write("canon: collection-metric: --value is required\n");
        return 2;
      }
      const value = Number(valueRaw);
      if (!Number.isFinite(value)) {
        process.stderr.write("canon: collection-metric: --value must be a number\n");
        return 2;
      }
      const dims = parseDimensionsFlag(parsed.values.dimensions);
      if (!dims.ok) {
        process.stderr.write(`canon: collection-metric: ${dims.message}\n`);
        return 2;
      }
      const metricName = metric.trim();
      if (metricName === "agent_turn") {
        bumpAgentTurn(root);
        if (parsed.flags.json === true) {
          process.stdout.write(`${renderJson({ code: 0, recorded: true })}\n`);
        }
        return 0;
      }
      let dimensions = dims.dimensions;
      if (metricName === "session_summary" && dimensions === undefined) {
        dimensions = buildSessionSummaryDimensions(root);
      }
      const outcome = await emitUsage(root, metricName, value, {
        period: parsed.values.period,
        debug: parsed.flags.debug === true,
        ...(dimensions !== undefined ? { dimensions } : {}),
      });
      if (metricName === "session_summary" && outcome.emitted) {
        clearSession(root);
      }
      const text = outcome.emitted
        ? `collection:metric emitted id=${outcome.id}`
        : `collection:metric skipped (${outcome.reason})`;
      return out(parsed.flags.json === true, 0, { code: 0, ...outcome }, text, {
        alwaysStdout: true,
      });
    },
  },
};

export async function run(argv: string[]): Promise<number> {
  const actionName = argv[0];
  if (actionName === undefined || actionName.startsWith("-")) {
    process.stderr.write(
      "canon: collection: action required (status|opt-in|decline|opt-out|identity|metric)\n",
    );
    return 2;
  }
  const action = ACTIONS[actionName];
  if (action === undefined) {
    process.stderr.write(`canon: collection: unknown action '${actionName}'\n`);
    return 2;
  }
  const rest = argv.slice(1);
  if (rest.includes("--help") || rest.includes("-h")) {
    if (action.help !== undefined) {
      action.help();
      return 0;
    }
  }
  const parsed = parseArgs(rest, {
    valueFlags: [...action.valueFlags],
    boolFlags: [...action.boolFlags],
    maxPositional: action.maxPositional ?? 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: collection-${actionName}: ${parsed.error}\n`);
    return 2;
  }
  const root = parsed.values["project-root"] ?? ".";
  return action.run(parsed, root);
}
