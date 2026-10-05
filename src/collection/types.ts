/** Pure collection types and helpers — no imports (ARC-4). */

export const COLLECTION_FILE_REL = ".canonical/collection.json";

/** Pinned consent text version — bump when the user-facing consent copy changes. */
export const CONSENT_VERSION = "canonical-2026-09-b";

/** Metrics opt-in scopes (usage counters only). */
export const METRICS_SCOPES = ["usage"] as const;

/** Submission scopes granted only after disclosure. */
export const SUBMISSION_SCOPES = ["feedback", "bug", "feature"] as const;

export type CollectionScope = (typeof METRICS_SCOPES)[number] | (typeof SUBMISSION_SCOPES)[number];

export type ConsentDecision = "active" | "declined" | "revoked";

export type MetricsMode = "undecided" | "disallowed" | "anonymous" | "attributed";

/** Lean metrics consent record (STO-3). */
export interface MetricsRecord {
  readonly decision: ConsentDecision;
  readonly consentVersion: string;
  readonly decidedAt: string;
  readonly expiresAt?: number;
}

/** Lean submissions grant — key present means granted (STO-3). */
export interface SubmissionsRecord {
  readonly consentVersion: string;
  readonly decidedAt: string;
  readonly expiresAt?: number;
}

/** On-disk project collection state (STO-3). */
export interface CollectionFile {
  readonly installId?: string;
  readonly token?: string;
  readonly metrics?: MetricsRecord;
  readonly submissions?: SubmissionsRecord;
  /** Contact is on file on the server for this install. */
  readonly attributed?: boolean;
}

export type CollectionPromptState = "not_prompted" | "declined" | "active" | "revoked" | "expired";
export type MetricsState = CollectionPromptState;
export type SubmissionsState = "not_granted" | "granted";
export type IdentityState = "anonymous" | "identified";

export interface ConsentSignal {
  readonly metrics: MetricsState;
  readonly metricsMode: MetricsMode;
  readonly submissions: SubmissionsState;
  readonly identity: IdentityState;
  /** Alias of identity for pack/agents. */
  readonly identityMode: IdentityState;
}

export interface Result {
  readonly code: 0 | 1 | 2;
  readonly message: string;
}

export type Contact = {
  readonly firstName?: string;
  readonly lastName?: string;
  readonly email?: string;
  readonly mobile?: string;
};

export type SdkContact = {
  readonly email?: string;
  readonly name?: string;
  readonly sms?: string;
};

/** Loose email: non-empty local@domain with a dot in the domain. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** E.164 (+ and digits) or national digits with common separators. */
const MOBILE_E164_RE = /^\+[1-9]\d{6,14}$/;
const MOBILE_NATIONAL_RE = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$|^\d{7,15}$/;

export function isMetricsMode(value: unknown): value is MetricsMode {
  return (
    value === "undecided" ||
    value === "disallowed" ||
    value === "anonymous" ||
    value === "attributed"
  );
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function metricsState(mirror: MetricsRecord | undefined, nowMs: number): MetricsState {
  if (mirror === undefined) {
    return "not_prompted";
  }
  if (mirror.decision === "declined") {
    return "declined";
  }
  if (mirror.decision === "revoked") {
    return "revoked";
  }
  if (mirror.decision === "active") {
    if (typeof mirror.expiresAt === "number" && mirror.expiresAt > 0 && mirror.expiresAt <= nowMs) {
      return "expired";
    }
    return "active";
  }
  return "not_prompted";
}

function submissionsState(mirror: SubmissionsRecord | undefined, nowMs: number): SubmissionsState {
  if (mirror === undefined) {
    return "not_granted";
  }
  if (typeof mirror.expiresAt === "number" && mirror.expiresAt > 0 && mirror.expiresAt <= nowMs) {
    return "not_granted";
  }
  return "granted";
}

/** SIG-2 / SIG-3: derive the consent signal from the lean file. */
export function signal(file: CollectionFile, nowMs: number = Date.now()): ConsentSignal {
  const metrics = metricsState(file.metrics, nowMs);
  let metricsMode: MetricsMode = "undecided";
  if (metrics === "declined" || metrics === "revoked") {
    metricsMode = "disallowed";
  } else if (metrics === "active") {
    metricsMode = file.attributed === true ? "attributed" : "anonymous";
  }
  const identity: IdentityState = file.attributed === true ? "identified" : "anonymous";
  return {
    metrics,
    metricsMode,
    submissions: submissionsState(file.submissions, nowMs),
    identity,
    identityMode: identity,
  };
}

export function formatSignal(sig: ConsentSignal): string {
  return (
    `metricsMode=${sig.metricsMode} metrics=${sig.metrics} ` +
    `submissions=${sig.submissions} identity=${sig.identity}`
  );
}

/**
 * Scopes the server should hold (B1). Includes usage when metrics are (or will be)
 * active, and the three submission scopes when granted (or about to be).
 */
export function scopesFor(
  file: CollectionFile,
  nowMs: number,
  want?: { usage?: boolean; submissions?: boolean },
): string[] {
  const sig = signal(file, nowMs);
  const scopes: string[] = [];
  if (want?.usage === true || sig.metrics === "active") {
    scopes.push(...METRICS_SCOPES);
  }
  if (want?.submissions === true || sig.submissions === "granted") {
    scopes.push(...SUBMISSION_SCOPES);
  }
  return [...new Set(scopes)];
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
    MOBILE_NATIONAL_RE.test(mobile) ||
    /^\d{7,15}$/.test(compact)
  ) {
    return { ok: true };
  }
  return { ok: false, message: "collection:identity: invalid mobile" };
}

/** Trim, drop empties, validate (CON-7); sdk is {} when every field is empty. */
export function parseContact(
  fields: Contact,
): { ok: true; sdk: SdkContact } | { ok: false; message: string } {
  const firstName = nonEmptyString(fields.firstName);
  const lastName = nonEmptyString(fields.lastName);
  const email = nonEmptyString(fields.email);
  const mobile = nonEmptyString(fields.mobile);

  if (email !== undefined) {
    const v = validateEmail(email);
    if (!v.ok) {
      return v;
    }
  }
  if (mobile !== undefined) {
    const v = validateMobile(mobile);
    if (!v.ok) {
      return v;
    }
  }

  const name = [firstName, lastName]
    .filter((p): p is string => p !== undefined)
    .join(" ")
    .trim();
  const sdk: SdkContact = {
    ...(name.length > 0 ? { name } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(mobile !== undefined ? { sms: mobile } : {}),
  };
  return { ok: true, sdk };
}

function isMetricsRecord(value: unknown): value is MetricsRecord {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const v = value as Record<string, unknown>;
  return (
    (v.decision === "active" || v.decision === "declined" || v.decision === "revoked") &&
    typeof v.consentVersion === "string" &&
    typeof v.decidedAt === "string"
  );
}

function leanMetrics(raw: MetricsRecord): MetricsRecord {
  return {
    decision: raw.decision,
    consentVersion: raw.consentVersion,
    decidedAt: raw.decidedAt,
    ...(typeof raw.expiresAt === "number" ? { expiresAt: raw.expiresAt } : {}),
  };
}

function legacyHasAllScopes(scopes: readonly string[]): boolean {
  return scopes.includes("usage") && SUBMISSION_SCOPES.every((s) => scopes.includes(s));
}

function identityAttributed(identity: unknown): boolean {
  if (identity === null || typeof identity !== "object") {
    return false;
  }
  const o = identity as Record<string, unknown>;
  for (const key of ["firstName", "lastName", "email", "mobile"]) {
    if (nonEmptyString(o[key]) !== undefined) {
      return true;
    }
  }
  return false;
}

function submissionsFromLegacy(raw: Record<string, unknown>): {
  record?: SubmissionsRecord;
  drop: boolean;
} {
  if (raw.granted === false) {
    return { drop: true };
  }
  if (raw.granted !== true) {
    // Already lean (no granted key) or malformed.
    if (
      typeof raw.consentVersion === "string" &&
      typeof raw.decidedAt === "string" &&
      raw.granted === undefined
    ) {
      const scopes = raw.scopes;
      if (Array.isArray(scopes) && scopes.length > 0) {
        const ok = SUBMISSION_SCOPES.every((s) => scopes.includes(s));
        if (!ok) {
          return { drop: true };
        }
      }
      return {
        drop: false,
        record: {
          consentVersion: raw.consentVersion,
          decidedAt: raw.decidedAt,
          ...(typeof raw.expiresAt === "number" ? { expiresAt: raw.expiresAt } : {}),
        },
      };
    }
    return { drop: true };
  }
  const scopes = Array.isArray(raw.scopes) ? (raw.scopes as string[]) : [];
  if (scopes.length > 0 && !SUBMISSION_SCOPES.every((s) => scopes.includes(s))) {
    return { drop: true };
  }
  if (typeof raw.consentVersion !== "string" || typeof raw.decidedAt !== "string") {
    return { drop: true };
  }
  return {
    drop: false,
    record: {
      consentVersion: raw.consentVersion,
      decidedAt: raw.decidedAt,
      ...(typeof raw.expiresAt === "number" ? { expiresAt: raw.expiresAt } : {}),
    },
  };
}

type LegacyFields = {
  consentVersion: string;
  decidedAt: string;
  expiresAt?: number;
};

function legacyFields(legacy: Record<string, unknown>): LegacyFields {
  return {
    consentVersion:
      typeof legacy.consentVersion === "string" ? legacy.consentVersion : CONSENT_VERSION,
    decidedAt: typeof legacy.decidedAt === "string" ? legacy.decidedAt : new Date(0).toISOString(),
    ...(typeof legacy.expiresAt === "number" ? { expiresAt: legacy.expiresAt } : {}),
  };
}

function migrateActiveAllScopes(base: CollectionFile, fields: LegacyFields): CollectionFile {
  return {
    ...base,
    metrics: { decision: "active", ...fields },
    submissions: { ...fields },
  };
}

function migrateActivePartial(
  base: CollectionFile,
  scopes: readonly string[],
  fields: LegacyFields,
): CollectionFile {
  const hasUsage = scopes.includes("usage");
  const submissionOk = SUBMISSION_SCOPES.every((s) => scopes.includes(s));
  return {
    ...base,
    ...(hasUsage
      ? { metrics: { decision: "active" as const, ...fields } }
      : {
          metrics: {
            decision: "declined" as const,
            consentVersion: fields.consentVersion,
            decidedAt: fields.decidedAt,
          },
        }),
    ...(submissionOk ? { submissions: { ...fields } } : {}),
  };
}

function migrateLegacyConsent(
  legacy: Record<string, unknown>,
  base: CollectionFile,
): { file: CollectionFile; changed: boolean } {
  const decision = legacy.decision;
  if (decision !== "active" && decision !== "declined" && decision !== "revoked") {
    return { file: base, changed: true };
  }
  const scopes = Array.isArray(legacy.scopes) ? (legacy.scopes as string[]) : [];
  const fields = legacyFields(legacy);
  if (decision === "active" && legacyHasAllScopes(scopes)) {
    return { changed: true, file: migrateActiveAllScopes(base, fields) };
  }
  if (decision === "active") {
    return { changed: true, file: migrateActivePartial(base, scopes, fields) };
  }
  return {
    changed: true,
    file: {
      ...base,
      metrics: {
        decision,
        consentVersion: fields.consentVersion,
        decidedAt: fields.decidedAt,
      },
    },
  };
}

function readAttributed(o: Record<string, unknown>): {
  attributed?: boolean;
  changed: boolean;
} {
  let attributed: boolean | undefined =
    typeof o.attributed === "boolean" ? o.attributed : undefined;
  let changed = false;
  if (o.identity !== undefined) {
    changed = true;
    if (attributed === undefined && identityAttributed(o.identity)) {
      attributed = true;
    }
  }
  if (o.metricsMode !== undefined) {
    changed = true;
  }
  return { attributed, changed };
}

function readMetrics(o: Record<string, unknown>): {
  metrics?: MetricsRecord;
  changed: boolean;
} {
  if (!isMetricsRecord(o.metrics)) {
    return { changed: false };
  }
  const rawMetrics = o.metrics as MetricsRecord & { scopes?: unknown };
  return {
    metrics: leanMetrics(o.metrics),
    changed: rawMetrics.scopes !== undefined,
  };
}

function readSubmissions(o: Record<string, unknown>): {
  submissions?: SubmissionsRecord;
  changed: boolean;
} {
  if (o.submissions === undefined || o.submissions === null || typeof o.submissions !== "object") {
    return { changed: false };
  }
  const rawSub = o.submissions as Record<string, unknown>;
  const sub = submissionsFromLegacy(rawSub);
  if (sub.drop) {
    return { changed: true };
  }
  return {
    submissions: sub.record,
    changed: rawSub.granted !== undefined || rawSub.scopes !== undefined,
  };
}

/** STO-4 / STO-5: normalize older shapes; only code that knows them. */
export function normalize(raw: unknown): { file: CollectionFile; changed: boolean } {
  if (raw === null || typeof raw !== "object") {
    return { file: {}, changed: false };
  }
  const o = raw as Record<string, unknown>;
  const attr = readAttributed(o);
  const metricsPart = readMetrics(o);
  const subsPart = readSubmissions(o);
  let changed = attr.changed || metricsPart.changed || subsPart.changed;
  let file: CollectionFile = {
    ...(typeof o.installId === "string" ? { installId: o.installId } : {}),
    ...(typeof o.token === "string" ? { token: o.token } : {}),
    ...(metricsPart.metrics !== undefined ? { metrics: metricsPart.metrics } : {}),
    ...(subsPart.submissions !== undefined ? { submissions: subsPart.submissions } : {}),
    ...(attr.attributed !== undefined ? { attributed: attr.attributed } : {}),
  };
  if (o.consent !== undefined && o.consent !== null && typeof o.consent === "object") {
    changed = true;
    if (metricsPart.metrics === undefined && subsPart.submissions === undefined) {
      file = migrateLegacyConsent(o.consent as Record<string, unknown>, file).file;
    }
  }
  return { file, changed };
}
