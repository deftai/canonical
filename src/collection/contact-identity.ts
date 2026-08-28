import type { Collector } from "@deft/collection-sdk";
import { type CreateCanonicalCollectorOptions, createCanonicalCollector } from "./client.js";
import {
  readCollectionFile,
  resolveConsentSignal,
  writeCollectionFile,
  writeIdentityMirror,
} from "./storage.js";
import {
  CONSENT_VERSION,
  type ContactIdentity,
  type IdentityState,
  identityMode,
  METRICS_SCOPES,
  SUBMISSION_SCOPES,
} from "./types.js";

export { identityMode };

/** Loose email: non-empty local@domain with a dot in the domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164 (+ and digits) or national digits with common separators. */
const MOBILE_E164_RE = /^\+[1-9]\d{6,14}$/;
const MOBILE_NATIONAL_RE = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$|^\d{7,15}$/;

export type SdkContact = {
  readonly email?: string;
  readonly name?: string;
  readonly sms?: string;
};

export function toSdkContact(identity: ContactIdentity): SdkContact {
  const name = [identity.firstName, identity.lastName]
    .map((p) => p?.trim())
    .filter((p): p is string => p !== undefined && p.length > 0)
    .join(" ")
    .trim();
  const email = identity.email?.trim();
  const sms = identity.mobile?.trim();
  return {
    ...(name.length > 0 ? { name } : {}),
    ...(email !== undefined && email.length > 0 ? { email } : {}),
    ...(sms !== undefined && sms.length > 0 ? { sms } : {}),
  };
}

export function validateEmail(raw: string): { ok: true } | { ok: false; message: string } {
  const email = raw.trim();
  if (email.length === 0 || !EMAIL_RE.test(email)) {
    return { ok: false, message: "collection:identity: invalid email" };
  }
  return { ok: true };
}

export function validateMobile(raw: string): { ok: true } | { ok: false; message: string } {
  const mobile = raw.trim();
  if (mobile.length === 0) {
    return { ok: false, message: "collection:identity: invalid mobile" };
  }
  const compact = mobile.replace(/[\s().-]/g, "");
  if (
    MOBILE_E164_RE.test(mobile) ||
    MOBILE_E164_RE.test(compact) ||
    MOBILE_NATIONAL_RE.test(mobile)
  ) {
    return { ok: true };
  }
  // National after stripping separators (7–15 digits).
  if (/^\d{7,15}$/.test(compact)) {
    return { ok: true };
  }
  return { ok: false, message: "collection:identity: invalid mobile" };
}

function normalizeFields(fields: ContactIdentity): ContactIdentity {
  const out: {
    firstName?: string;
    lastName?: string;
    email?: string;
    mobile?: string;
  } = {};
  if (fields.firstName !== undefined) {
    const v = fields.firstName.trim();
    if (v.length > 0) {
      out.firstName = v;
    }
  }
  if (fields.lastName !== undefined) {
    const v = fields.lastName.trim();
    if (v.length > 0) {
      out.lastName = v;
    }
  }
  if (fields.email !== undefined) {
    const v = fields.email.trim();
    if (v.length > 0) {
      out.email = v;
    }
  }
  if (fields.mobile !== undefined) {
    const v = fields.mobile.trim();
    if (v.length > 0) {
      out.mobile = v;
    }
  }
  return out;
}

function mergeIdentity(
  existing: ContactIdentity | undefined,
  patch: ContactIdentity,
): ContactIdentity {
  return normalizeFields({
    firstName: patch.firstName ?? existing?.firstName,
    lastName: patch.lastName ?? existing?.lastName,
    email: patch.email ?? existing?.email,
    mobile: patch.mobile ?? existing?.mobile,
  });
}

/** Scopes to reconfirm on identity sync. Null when neither track is active — skip server. */
function scopesForReconfirm(projectRoot: string): string[] | null {
  const file = readCollectionFile(projectRoot);
  const signal = resolveConsentSignal(file);
  const scopes: string[] = [];
  if (signal.metrics === "active") {
    scopes.push(...METRICS_SCOPES);
  }
  if (signal.submissions === "granted") {
    scopes.push(...(file.submissions?.scopes ?? [...SUBMISSION_SCOPES]));
  }
  return scopes.length > 0 ? [...new Set(scopes)] : null;
}

function hasCredentials(projectRoot: string): boolean {
  const file = readCollectionFile(projectRoot);
  return (
    typeof file.installId === "string" &&
    file.installId.length > 0 &&
    typeof file.token === "string" &&
    file.token.length > 0
  );
}

export interface IdentityShowResult {
  readonly code: 0;
  readonly mode: IdentityState;
  readonly identity: ContactIdentity;
  readonly message: string;
}

export function collectionIdentityShow(projectRoot: string): IdentityShowResult {
  const file = readCollectionFile(projectRoot);
  const identity = file.identity ?? {};
  const mode = identityMode(file.identity);
  return {
    code: 0,
    mode,
    identity,
    message: `identity=${mode}`,
  };
}

export interface IdentityMutationOptions extends CreateCanonicalCollectorOptions {
  readonly collector?: Collector;
}

export interface IdentityMutationResult {
  readonly code: 0 | 1 | 2;
  readonly mode: IdentityState;
  readonly message: string;
  readonly identity?: ContactIdentity;
}

/**
 * Persist contact identity locally and, when credentials exist, reconfirm via
 * SDK optIn with contact mapped to { name, email, sms }.
 */
export async function collectionIdentityUpdate(
  projectRoot: string,
  fields: ContactIdentity,
  opts: IdentityMutationOptions = {},
): Promise<IdentityMutationResult> {
  if (
    fields.firstName === undefined &&
    fields.lastName === undefined &&
    fields.email === undefined &&
    fields.mobile === undefined
  ) {
    return {
      code: 2,
      mode: identityMode(readCollectionFile(projectRoot).identity),
      message: "collection:identity --update requires at least one field",
    };
  }

  if (fields.email !== undefined) {
    const v = validateEmail(fields.email);
    if (!v.ok) {
      return { code: 2, mode: "anonymous", message: v.message };
    }
  }
  if (fields.mobile !== undefined) {
    const v = validateMobile(fields.mobile);
    if (!v.ok) {
      return { code: 2, mode: "anonymous", message: v.message };
    }
  }

  const existing = readCollectionFile(projectRoot);
  const merged = mergeIdentity(existing.identity, fields);
  if (Object.keys(merged).length === 0) {
    return {
      code: 2,
      mode: "anonymous",
      message: "collection:identity --update requires at least one non-empty field",
    };
  }

  writeIdentityMirror(projectRoot, merged);
  const mode = identityMode(merged);

  const scopes = hasCredentials(projectRoot) ? scopesForReconfirm(projectRoot) : null;
  if (scopes === null) {
    return {
      code: 0,
      mode,
      identity: merged,
      message: `collection:identity updated identity=${mode} (local only)`,
    };
  }

  try {
    const collector =
      opts.collector ??
      createCanonicalCollector(projectRoot, {
        configDir: opts.configDir,
        baseUrl: opts.baseUrl,
        environment: opts.environment,
        version: opts.version,
        fetch: opts.fetch,
        autoRegister: false,
      });
    const contact = toSdkContact(merged);
    const result = await collector.optIn({
      scopes,
      consentVersion:
        existing.metrics?.consentVersion ?? existing.submissions?.consentVersion ?? CONSENT_VERSION,
      ...(Object.keys(contact).length > 0 ? { contact } : {}),
    });
    if (!result.ok) {
      return {
        code: 1,
        mode,
        identity: merged,
        message: `collection:identity updated locally; server sync rejected -- ${result.code}`,
      };
    }
    return {
      code: 0,
      mode,
      identity: merged,
      message: `collection:identity updated identity=${mode}`,
    };
  } catch (err) {
    return {
      code: 1,
      mode,
      identity: merged,
      message: `collection:identity updated locally; server sync error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Clear local identity to anonymous. When credentials exist, reconfirm opt-in
 * with an empty contact object so prior PII is not re-sent.
 */
export async function collectionIdentityClear(
  projectRoot: string,
  opts: IdentityMutationOptions = {},
): Promise<IdentityMutationResult> {
  const existing = readCollectionFile(projectRoot);
  writeIdentityMirror(projectRoot, undefined);

  const scopes = hasCredentials(projectRoot) ? scopesForReconfirm(projectRoot) : null;
  if (scopes === null) {
    return {
      code: 0,
      mode: "anonymous",
      message: "collection:identity cleared identity=anonymous",
    };
  }

  try {
    const collector =
      opts.collector ??
      createCanonicalCollector(projectRoot, {
        configDir: opts.configDir,
        baseUrl: opts.baseUrl,
        environment: opts.environment,
        version: opts.version,
        fetch: opts.fetch,
        autoRegister: false,
      });
    const result = await collector.optIn({
      scopes,
      consentVersion:
        existing.metrics?.consentVersion ?? existing.submissions?.consentVersion ?? CONSENT_VERSION,
      contact: {},
    });
    if (!result.ok) {
      return {
        code: 1,
        mode: "anonymous",
        message: `collection:identity cleared locally; server contact clear rejected -- ${result.code}`,
      };
    }
    return {
      code: 0,
      mode: "anonymous",
      message: "collection:identity cleared identity=anonymous",
    };
  } catch (err) {
    return {
      code: 1,
      mode: "anonymous",
      message: `collection:identity cleared locally; server contact clear error -- ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Shared by collection:opt-out --identity. */
export async function clearIdentityAndServerContact(
  projectRoot: string,
  opts: IdentityMutationOptions = {},
): Promise<IdentityMutationResult> {
  return collectionIdentityClear(projectRoot, opts);
}

/** Drop identity from the collection file without touching the server (full opt-out path). */
export function dropLocalIdentity(projectRoot: string): void {
  const existing = readCollectionFile(projectRoot);
  if (existing.identity === undefined) {
    return;
  }
  const { identity: _drop, ...rest } = existing;
  writeCollectionFile(projectRoot, rest);
}
