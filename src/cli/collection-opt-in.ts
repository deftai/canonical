/** `canon collection:opt-in` -- register + metrics consent (anonymous or attributed one-shot). */
import { parseArgs, renderJson } from "../args/index.js";
import {
  CONSENT_VERSION,
  type ContactIdentity,
  collectionOptIn,
  DEFAULT_SCOPES,
  ensureAttributedOptIn,
} from "../collection/index.js";

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: [
      "project-root",
      "scopes",
      "consent-version",
      "email",
      "name",
      "first-name",
      "last-name",
      "mobile",
    ],
    boolFlags: ["json", "confirm"],
    maxPositional: 0,
  });
  if (parsed.error !== undefined) {
    process.stderr.write(`canon: collection-opt-in: ${parsed.error}\n`);
    return 2;
  }

  const projectRoot = parsed.values["project-root"] ?? ".";
  const scopesRaw = parsed.values.scopes;
  const scopes =
    scopesRaw !== undefined
      ? scopesRaw
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [...DEFAULT_SCOPES];

  const firstName = parsed.values["first-name"] ?? parsed.values.name;
  const identity: ContactIdentity = {
    ...(firstName !== undefined ? { firstName } : {}),
    ...(parsed.values["last-name"] !== undefined ? { lastName: parsed.values["last-name"] } : {}),
    ...(parsed.values.email !== undefined ? { email: parsed.values.email } : {}),
    ...(parsed.values.mobile !== undefined ? { mobile: parsed.values.mobile } : {}),
  };

  const hasIdentityFields = Object.keys(identity).length > 0;
  const consentVersion = parsed.values["consent-version"] ?? CONSENT_VERSION;
  const confirm = parsed.flags.confirm === true;

  const result = hasIdentityFields
    ? await ensureAttributedOptIn(projectRoot, identity, {
        confirm,
        scopes,
        consentVersion,
      })
    : await collectionOptIn(projectRoot, {
        confirm,
        scopes,
        consentVersion,
      });

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        message: result.message,
        scopes: result.scopes ?? null,
        metricsMode: "metricsMode" in result ? (result.metricsMode ?? null) : null,
      })}\n`,
    );
  } else if (result.code === 0) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }
  return result.code;
}
