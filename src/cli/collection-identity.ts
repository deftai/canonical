/** `canon collection:identity` -- show | clear | update local contact identity. */
import { parseArgs, renderJson } from "../args/index.js";
import {
  collectionIdentityClear,
  collectionIdentityShow,
  collectionIdentityUpdate,
} from "../collection/index.js";

function printHelp(): void {
  process.stdout.write(`canon collection:identity — manage reply-channel identity

Usage:
  canon collection:identity --show
  canon collection:identity --clear
  canon collection:identity --update [--first-name=…] [--last-name=…] [--email=…] [--mobile=…]
  task -x collection:identity -- --show|--clear|--update …

Notes:
  Mode identity=identified requires email or mobile; otherwise anonymous.
  Stored in .canonical/collection.json (0600). Synced to server via opt-in
  reconfirm as SDK contact { name, email, sms } — never in event payloads (PRIV-2).
  --show intentionally prints identity fields; other verbs avoid logging PII.
`);
}

export async function run(argv: string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return 0;
  }

  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "first-name", "last-name", "email", "mobile"],
    boolFlags: ["json", "show", "clear", "update"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: collection-identity: ${parsed.error}\n`);
    return 2;
  }

  const modes = [parsed.flags.show, parsed.flags.clear, parsed.flags.update].filter(
    (v) => v === true,
  );
  if (modes.length !== 1) {
    process.stderr.write(
      "canon: collection-identity: exactly one of --show | --clear | --update is required\n",
    );
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const json = parsed.flags.json === true;

  if (parsed.flags.show === true) {
    const result = collectionIdentityShow(projectRoot);
    if (json) {
      process.stdout.write(
        `${renderJson({
          code: result.code,
          identity: result.identity,
          message: result.message,
          mode: result.mode,
        })}\n`,
      );
    } else {
      // --show intentionally prints fields.
      const id = result.identity;
      const lines = [
        result.message,
        ...(id.firstName !== undefined ? [`firstName=${id.firstName}`] : []),
        ...(id.lastName !== undefined ? [`lastName=${id.lastName}`] : []),
        ...(id.email !== undefined ? [`email=${id.email}`] : []),
        ...(id.mobile !== undefined ? [`mobile=${id.mobile}`] : []),
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
    }
    return result.code;
  }

  if (parsed.flags.clear === true) {
    const result = await collectionIdentityClear(projectRoot);
    if (json) {
      process.stdout.write(
        `${renderJson({ code: result.code, message: result.message, mode: result.mode })}\n`,
      );
    } else if (result.code === 0) {
      process.stdout.write(`${result.message}\n`);
    } else {
      process.stderr.write(`${result.message}\n`);
    }
    return result.code;
  }

  // --update
  const fields = {
    ...(parsed.values["first-name"] !== undefined
      ? { firstName: parsed.values["first-name"] }
      : {}),
    ...(parsed.values["last-name"] !== undefined ? { lastName: parsed.values["last-name"] } : {}),
    ...(parsed.values.email !== undefined ? { email: parsed.values.email } : {}),
    ...(parsed.values.mobile !== undefined ? { mobile: parsed.values.mobile } : {}),
  };
  const result = await collectionIdentityUpdate(projectRoot, fields);
  if (json) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        // omit full identity from default logs; json mode returns mode only unless show
        message: result.message,
        mode: result.mode,
      })}\n`,
    );
  } else if (result.code === 0) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }
  return result.code;
}
