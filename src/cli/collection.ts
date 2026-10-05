import {
  COLLECTION_IDENTITY_HELP,
  contactFlagFields,
  emitMetricNamed,
  out,
  parseArgs,
  parseDimensionsJson,
  parseMetricArgs,
  recordAgentTurn,
  resultOut,
} from "../args/index.js";
import { BUILD_CHANNEL } from "../build-info.js";
import {
  contactClear,
  contactShow,
  contactUpdate,
  decline,
  optIn,
  optOut,
  parseContact,
  status,
} from "../collection/index.js";

type Parsed = ReturnType<typeof parseArgs>;
type Action = {
  readonly valueFlags: readonly string[];
  readonly boolFlags: readonly string[];
  readonly help?: () => void;
  readonly run: (parsed: Parsed, root: string) => number | Promise<number>;
};
const ACTIONS: Record<string, Action> = {
  status: {
    valueFlags: ["project-root"],
    boolFlags: ["json"],
    run: (parsed, root) => {
      const result = status(root);
      const message = `${result.message} channel=${BUILD_CHANNEL}`;
      return parsed.flags.json === true
        ? out(true, result.code, { ...result.json, channel: BUILD_CHANNEL, message }, message)
        : out(false, result.code, {}, message);
    },
  },
  "opt-in": {
    valueFlags: ["project-root", "email", "first-name", "last-name", "mobile"],
    boolFlags: ["json", "confirm"],
    run: async (parsed, root) => {
      const parsedContact = parseContact(contactFlagFields(parsed.values));
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
    run: (parsed, root) => resultOut(parsed.flags.json === true, decline(root)),
  },
  "opt-out": {
    valueFlags: ["project-root"],
    boolFlags: ["json", "confirm", "identity"],
    run: async (parsed, root) =>
      resultOut(
        parsed.flags.json === true,
        await optOut(root, {
          confirm: parsed.flags.confirm === true,
          identity: parsed.flags.identity === true,
        }),
      ),
  },
  identity: {
    valueFlags: ["project-root", "first-name", "last-name", "email", "mobile"],
    boolFlags: ["json", "show", "clear", "update"],
    help: () => {
      process.stdout.write(COLLECTION_IDENTITY_HELP);
    },
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
        const r = contactShow(root);
        return out(
          json,
          r.code,
          { code: r.code, message: r.message, mode: r.mode },
          r.message,
          true,
        );
      }
      const r =
        parsed.flags.clear === true
          ? await contactClear(root)
          : await contactUpdate(root, contactFlagFields(parsed.values));
      return out(json, r.code, { code: r.code, message: r.message, mode: r.mode }, r.message);
    },
  },
  metric: {
    valueFlags: ["project-root", "metric", "value", "period", "dimensions"],
    boolFlags: ["json", "debug"],
    run: async (parsed, root) => {
      const parsedMetric = parseMetricArgs(parsed.values.metric, parsed.values.value);
      if (!parsedMetric.ok) {
        process.stderr.write(`${parsedMetric.message}\n`);
        return 2;
      }
      const dims = parseDimensionsJson(parsed.values.dimensions, 2048);
      if (!dims.ok) {
        process.stderr.write(`canon: collection-metric: ${dims.message}\n`);
        return 2;
      }
      if (parsedMetric.name === "agent_turn") {
        return recordAgentTurn(root, parsed.flags.json === true);
      }
      return emitMetricNamed(root, parsedMetric.name, parsedMetric.value, {
        period: parsed.values.period,
        debug: parsed.flags.debug === true,
        json: parsed.flags.json === true,
        dimensions: dims.dimensions,
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
  if ((rest.includes("--help") || rest.includes("-h")) && action.help !== undefined) {
    action.help();
    return 0;
  }
  const parsed = parseArgs(rest, {
    valueFlags: [...action.valueFlags],
    boolFlags: [...action.boolFlags],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: collection-${actionName}: ${parsed.error}\n`);
    return 2;
  }
  return action.run(parsed, parsed.values["project-root"] ?? ".");
}
