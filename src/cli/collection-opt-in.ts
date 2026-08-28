/** `canon collection:opt-in` -- register + metrics consent (default: usage only). */
import { parseArgs, renderJson } from "../args/index.js";
import { CONSENT_VERSION, collectionOptIn, DEFAULT_SCOPES } from "../collection/index.js";

export async function run(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv, {
    valueFlags: ["project-root", "scopes", "consent-version", "email", "name"],
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

  const contact: { email?: string; name?: string } = {};
  if (parsed.values.email !== undefined) {
    contact.email = parsed.values.email;
  }
  if (parsed.values.name !== undefined) {
    contact.name = parsed.values.name;
  }

  const result = await collectionOptIn(projectRoot, {
    confirm: parsed.flags.confirm === true,
    scopes,
    consentVersion: parsed.values["consent-version"] ?? CONSENT_VERSION,
    ...(Object.keys(contact).length > 0 ? { contact } : {}),
  });

  if (parsed.flags.json === true) {
    process.stdout.write(
      `${renderJson({
        code: result.code,
        message: result.message,
        scopes: result.scopes ?? null,
      })}\n`,
    );
  } else if (result.code === 0) {
    process.stdout.write(`${result.message}\n`);
  } else {
    process.stderr.write(`${result.message}\n`);
  }
  return result.code;
}
