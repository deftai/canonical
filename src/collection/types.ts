export const COLLECTION_FILE_REL = ".canonical/collection.json";
export const CONSENT_VERSION = "canonical-2026-09-b";
export const METRICS_SCOPES = ["usage"] as const;
export const SUBMISSION_SCOPES = ["feedback", "bug", "feature"] as const;
export type MetricsMode = "undecided" | "disallowed" | "anonymous" | "attributed";
export type MetricsState = "not_prompted" | "declined" | "active" | "revoked" | "expired";
export type SubmissionsState = "not_granted" | "granted";
export type IdentityState = "anonymous" | "identified";
export interface MetricsRecord {
  readonly decision: "active" | "declined" | "revoked";
  readonly consentVersion: string;
  readonly decidedAt: string;
  readonly expiresAt?: number;
}
export interface SubmissionsRecord {
  readonly consentVersion: string;
  readonly decidedAt: string;
  readonly expiresAt?: number;
}
export interface CollectionFile {
  readonly installId?: string;
  readonly token?: string;
  readonly metrics?: MetricsRecord;
  readonly submissions?: SubmissionsRecord;
  readonly attributed?: boolean;
}
export interface ConsentSignal {
  readonly metrics: MetricsState;
  readonly metricsMode: MetricsMode;
  readonly submissions: SubmissionsState;
  readonly identity: IdentityState;
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
export type SdkContact = { readonly email?: string; readonly name?: string; readonly sms?: string };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_E164_RE = /^\+[1-9]\d{6,14}$/;
const MOBILE_NATIONAL_RE = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$|^\d{7,15}$/;
function str(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}
function expired(at: number | undefined, now: number): boolean {
  return typeof at === "number" && at > 0 && at <= now;
}
function metricsState(m: MetricsRecord | undefined, nowMs: number): MetricsState {
  if (m === undefined) return "not_prompted";
  if (m.decision === "declined" || m.decision === "revoked") return m.decision;
  if (m.decision === "active") return expired(m.expiresAt, nowMs) ? "expired" : "active";
  return "not_prompted";
}
function metricsModeOf(metrics: MetricsState, attributed: boolean): MetricsMode {
  if (metrics === "declined" || metrics === "revoked") return "disallowed";
  if (metrics === "active") return attributed ? "attributed" : "anonymous";
  return "undecided";
}
function submissionsState(sub: SubmissionsRecord | undefined, nowMs: number): SubmissionsState {
  if (sub === undefined || expired(sub.expiresAt, nowMs)) return "not_granted";
  return "granted";
}
export function signal(file: CollectionFile, nowMs: number = Date.now()): ConsentSignal {
  const metrics = metricsState(file.metrics, nowMs);
  const attributed = file.attributed === true;
  const identity: IdentityState = attributed ? "identified" : "anonymous";
  return {
    metrics,
    metricsMode: metricsModeOf(metrics, attributed),
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
export function scopesFor(
  file: CollectionFile,
  nowMs: number,
  want?: { usage?: boolean; submissions?: boolean },
): string[] {
  const sig = signal(file, nowMs);
  const out: string[] = [];
  if (want?.usage === true || sig.metrics === "active") {
    out.push(...METRICS_SCOPES);
  }
  if (want?.submissions === true || sig.submissions === "granted") {
    out.push(...SUBMISSION_SCOPES);
  }
  return [...new Set(out)];
}
function mobileOk(mobile: string): boolean {
  const c = mobile.replace(/[\s().-]/g, "");
  return (
    MOBILE_E164_RE.test(mobile) ||
    MOBILE_E164_RE.test(c) ||
    MOBILE_NATIONAL_RE.test(mobile) ||
    /^\d{7,15}$/.test(c)
  );
}
function toSdk(
  firstName: string | undefined,
  lastName: string | undefined,
  email: string | undefined,
  mobile: string | undefined,
): SdkContact {
  const name = [firstName, lastName]
    .filter((p): p is string => p !== undefined)
    .join(" ")
    .trim();
  const sdk: { name?: string; email?: string; sms?: string } = {};
  if (name.length > 0) sdk.name = name;
  if (email !== undefined) sdk.email = email;
  if (mobile !== undefined) sdk.sms = mobile;
  return sdk;
}
export function parseContact(
  fields: Contact,
): { ok: true; sdk: SdkContact } | { ok: false; message: string } {
  const firstName = str(fields.firstName);
  const lastName = str(fields.lastName);
  const email = str(fields.email);
  const mobile = str(fields.mobile);
  if (email !== undefined && !EMAIL_RE.test(email)) {
    return { ok: false, message: "collection:identity: invalid email" };
  }
  if (mobile !== undefined && !mobileOk(mobile)) {
    return { ok: false, message: "collection:identity: invalid mobile" };
  }
  return { ok: true, sdk: toSdk(firstName, lastName, email, mobile) };
}
type ConsentFields = { consentVersion: string; decidedAt: string; expiresAt?: number };
type ReadPart<T> = { value?: T; changed: boolean };
function fieldsOf(raw: Record<string, unknown>): ConsentFields {
  return {
    consentVersion: typeof raw.consentVersion === "string" ? raw.consentVersion : CONSENT_VERSION,
    decidedAt: typeof raw.decidedAt === "string" ? raw.decidedAt : new Date(0).toISOString(),
    ...(typeof raw.expiresAt === "number" ? { expiresAt: raw.expiresAt } : {}),
  };
}
function readAttributed(o: Record<string, unknown>): boolean | undefined {
  if (typeof o.attributed === "boolean") return o.attributed;
  if (o.identity === null || typeof o.identity !== "object") return undefined;
  const id = o.identity as Record<string, unknown>;
  return ["firstName", "lastName", "email", "mobile"].some((k) => str(id[k])) ? true : undefined;
}
function readMetrics(o: Record<string, unknown>): ReadPart<MetricsRecord> {
  if (o.metrics === null || typeof o.metrics !== "object") return { changed: false };
  const v = o.metrics as Record<string, unknown>;
  const d = v.decision;
  if (d !== "active" && d !== "declined" && d !== "revoked") return { changed: false };
  if (typeof v.consentVersion !== "string" || typeof v.decidedAt !== "string") {
    return { changed: false };
  }
  return {
    value: {
      decision: d,
      consentVersion: v.consentVersion,
      decidedAt: v.decidedAt,
      ...(typeof v.expiresAt === "number" ? { expiresAt: v.expiresAt } : {}),
    },
    changed: v.scopes !== undefined,
  };
}
function submissionsDrop(v: Record<string, unknown>): boolean {
  if (v.granted === false) return true;
  const scopes = Array.isArray(v.scopes) ? (v.scopes as string[]) : undefined;
  if (
    scopes !== undefined &&
    scopes.length > 0 &&
    !SUBMISSION_SCOPES.every((s) => scopes.includes(s))
  ) {
    return true;
  }
  return v.granted !== true && v.granted !== undefined;
}
function readSubmissions(o: Record<string, unknown>): ReadPart<SubmissionsRecord> {
  if (o.submissions === null || typeof o.submissions !== "object") return { changed: false };
  const v = o.submissions as Record<string, unknown>;
  const drop = submissionsDrop(v);
  const changed = drop || v.granted !== undefined || v.scopes !== undefined;
  if (drop || typeof v.consentVersion !== "string" || typeof v.decidedAt !== "string") {
    return { changed };
  }
  return {
    value: {
      consentVersion: v.consentVersion,
      decidedAt: v.decidedAt,
      ...(typeof v.expiresAt === "number" ? { expiresAt: v.expiresAt } : {}),
    },
    changed,
  };
}
function isMetricsDecision(d: unknown): d is MetricsRecord["decision"] {
  return d === "active" || d === "declined" || d === "revoked";
}
function legacyActiveFile(
  file: CollectionFile,
  f: ConsentFields,
  legacy: Record<string, unknown>,
): CollectionFile {
  const scopes = Array.isArray(legacy.scopes) ? (legacy.scopes as string[]) : [];
  const metrics: MetricsRecord = scopes.includes("usage")
    ? { decision: "active", ...f }
    : { decision: "declined", consentVersion: f.consentVersion, decidedAt: f.decidedAt };
  if (!SUBMISSION_SCOPES.every((s) => scopes.includes(s))) {
    return { ...file, metrics };
  }
  return { ...file, metrics, submissions: { ...f } };
}
function applyLegacyConsent(
  o: Record<string, unknown>,
  file: CollectionFile,
  metrics: MetricsRecord | undefined,
  submissions: SubmissionsRecord | undefined,
): CollectionFile {
  if (metrics !== undefined || submissions !== undefined) return file;
  if (o.consent === null || typeof o.consent !== "object") return file;
  const legacy = o.consent as Record<string, unknown>;
  if (!isMetricsDecision(legacy.decision)) return file;
  const f = fieldsOf(legacy);
  if (legacy.decision !== "active") {
    return {
      ...file,
      metrics: {
        decision: legacy.decision,
        consentVersion: f.consentVersion,
        decidedAt: f.decidedAt,
      },
    };
  }
  return legacyActiveFile(file, f, legacy);
}
function assembleFile(
  o: Record<string, unknown>,
  attributed: boolean | undefined,
  metrics: MetricsRecord | undefined,
  submissions: SubmissionsRecord | undefined,
): CollectionFile {
  return {
    ...(typeof o.installId === "string" ? { installId: o.installId } : {}),
    ...(typeof o.token === "string" ? { token: o.token } : {}),
    ...(metrics !== undefined ? { metrics } : {}),
    ...(submissions !== undefined ? { submissions } : {}),
    ...(attributed !== undefined ? { attributed } : {}),
  };
}
export function normalize(raw: unknown): { file: CollectionFile; changed: boolean } {
  if (raw === null || typeof raw !== "object") return { file: {}, changed: false };
  const o = raw as Record<string, unknown>;
  const attributed = readAttributed(o);
  const m = readMetrics(o);
  const s = readSubmissions(o);
  let file = assembleFile(o, attributed, m.value, s.value);
  const hasLegacyConsent = o.consent !== null && typeof o.consent === "object";
  if (hasLegacyConsent) file = applyLegacyConsent(o, file, m.value, s.value);
  const changed =
    o.metricsMode !== undefined ||
    o.identity !== undefined ||
    m.changed ||
    s.changed ||
    hasLegacyConsent;
  return { file, changed };
}
