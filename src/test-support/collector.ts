/**
 * In-memory fake of the Deft collection endpoint for hermetic tests.
 * Enforces backend facts B1–B8; throws on any URL outside the baked collector base.
 */
import { randomUUID } from "node:crypto";
import { ERROR_CODES, isKnownScope, SCOPE_SCHEMAS } from "@deft/schemas";
import { COLLECTION_BASE_URL } from "../build-info.js";

export type CollectorRoute =
  | "register"
  | "optin"
  | "optout"
  | "status"
  | "challenge"
  | "submissions";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

export interface FakeContact {
  name?: string;
  email?: string;
  sms?: string;
}

export interface FakeInstall {
  readonly installId: string;
  readonly token: string;
  state: "pending" | "active" | "revoked";
  scopes: string[];
  contact: FakeContact | undefined;
  consentVersion?: string;
  expiresAt?: number;
  /** Nonces issued by challenge; consumed on submit. */
  nonces: Map<string, { scope: string; issuedAt: number }>;
  submissions: Array<{ id: string; scope: string; payload: unknown; at: number }>;
}

export interface FakeCollector {
  readonly fetch: typeof fetch;
  readonly installs: Map<string, FakeInstall>;
  readonly requests: RecordedRequest[];
  /** Advance fake server clock (affects expiry / nonce age). */
  advance(ms: number): void;
  /** Next matching route returns `{error: code}` with the table status. */
  failNext(route: CollectorRoute, code: keyof typeof ERROR_CODES): void;
  /**
   * Next matching route waits `ms` (via setTimeout) before handling.
   * Works with vitest fake timers for MET-10 soft-emit budgets.
   */
  hangNext(route: CollectorRoute, ms: number): void;
  /** Current fake server time in epoch ms. */
  now(): number;
}

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(code: keyof typeof ERROR_CODES): Response {
  const entry = ERROR_CODES[code];
  return jsonResponse(entry.status, { error: code });
}

function headerMap(headers: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (headers === undefined) {
    return out;
  }
  const h = new Headers(headers);
  h.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

function parseBody(raw: BodyInit | null | undefined): unknown {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  if (typeof raw !== "string") {
    throw new Error("fakeCollector: expected string body from SDK");
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { __invalid_json: true };
  }
}

function contactHasEmptyString(contact: Record<string, unknown>): boolean {
  for (const value of Object.values(contact)) {
    if (value === null) {
      return true;
    }
    if (typeof value === "string" && value.length === 0) {
      return true;
    }
  }
  return false;
}

function routeOf(method: string, path: string): CollectorRoute | null {
  if (method === "POST" && path === "/v1/registrations") {
    return "register";
  }
  if (method === "POST" && /^\/v1\/registrations\/[^/]+\/optin$/.test(path)) {
    return "optin";
  }
  if (method === "POST" && /^\/v1\/registrations\/[^/]+\/optout$/.test(path)) {
    return "optout";
  }
  if (method === "GET" && /^\/v1\/registrations\/[^/]+\/status$/.test(path)) {
    return "status";
  }
  if (method === "POST" && path === "/v1/challenge") {
    return "challenge";
  }
  if (method === "POST" && /^\/v1\/submissions\/[^/]+$/.test(path)) {
    return "submissions";
  }
  return null;
}

function installIdFromPath(path: string): string | undefined {
  const m = /^\/v1\/registrations\/([^/]+)\//.exec(path);
  return m?.[1];
}

function correlatorCheck(
  headers: Record<string, string>,
  body: unknown,
): keyof typeof ERROR_CODES | null {
  const headerCorr = headers["x-deft-correlator"];
  const bodyCorr =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? (body as { correlator?: unknown }).correlator
      : undefined;
  const bodyHas = typeof bodyCorr === "string" || (bodyCorr !== undefined && bodyCorr !== null);
  const headerHas = headerCorr !== undefined && headerCorr.length > 0;
  if (headerHas !== bodyHas) {
    return "correlator_mismatch";
  }
  if (headerHas && bodyHas && headerCorr !== bodyCorr) {
    return "correlator_mismatch";
  }
  return null;
}

export function fakeCollector(opts: { baseUrl?: string } = {}): FakeCollector {
  const baseUrl = (opts.baseUrl ?? COLLECTION_BASE_URL).replace(/\/$/, "");
  const installs = new Map<string, FakeInstall>();
  const requests: RecordedRequest[] = [];
  let nowMs = Date.now();
  const failQueue: Array<{ route: CollectorRoute; code: keyof typeof ERROR_CODES }> = [];
  const hangQueue: Array<{ route: CollectorRoute; ms: number }> = [];

  function takeFail(route: CollectorRoute): keyof typeof ERROR_CODES | undefined {
    const idx = failQueue.findIndex((f) => f.route === route);
    if (idx < 0) {
      return undefined;
    }
    const [entry] = failQueue.splice(idx, 1);
    return entry?.code;
  }

  async function takeHang(route: CollectorRoute): Promise<void> {
    const idx = hangQueue.findIndex((h) => h.route === route);
    if (idx < 0) {
      return;
    }
    const ms = hangQueue.splice(idx, 1)[0]?.ms ?? 0;
    if (ms > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
      });
    }
  }

  function requireBearer(
    headers: Record<string, string>,
    install: FakeInstall | undefined,
  ): Response | null {
    const auth = headers.authorization;
    if (auth === undefined || !auth.startsWith("Bearer ")) {
      return errorResponse("token_missing");
    }
    const token = auth.slice("Bearer ".length);
    if (install === undefined) {
      return errorResponse("unknown_installation");
    }
    if (token !== install.token) {
      return errorResponse("token_mismatch");
    }
    return null;
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith(`${baseUrl}/`) && url !== baseUrl) {
      throw new Error(
        `fakeCollector: refused URL outside baked collector base (${baseUrl}): ${url}`,
      );
    }
    const path = url.slice(baseUrl.length) || "/";
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = headerMap(init?.headers);
    const body = method === "GET" ? undefined : parseBody(init?.body);
    requests.push({ method, path, headers, body });

    if (
      body !== null &&
      typeof body === "object" &&
      (body as { __invalid_json?: boolean }).__invalid_json
    ) {
      return errorResponse("invalid_json");
    }

    const route = routeOf(method, path);
    if (route === null) {
      return errorResponse("not_found");
    }

    await takeHang(route);

    const forced = takeFail(route);
    if (forced !== undefined) {
      return errorResponse(forced);
    }

    const corrErr = correlatorCheck(headers, body);
    if (corrErr !== null && method !== "GET") {
      // GET status has no body; header-only correlator is fine (optional).
      return errorResponse(corrErr);
    }
    // GET with correlator header and no body is allowed (B5: optional; mismatch only when one side present on POST).

    if (route === "register") {
      const installId = randomUUID();
      const token = `tok-${installId}`;
      const install: FakeInstall = {
        installId,
        token,
        state: "pending",
        scopes: [],
        contact: undefined,
        nonces: new Map(),
        submissions: [],
      };
      installs.set(installId, install);
      return jsonResponse(200, {
        install_id: installId,
        install_token: token,
        state: "pending",
      });
    }

    if (route === "optin") {
      const id = installIdFromPath(path);
      const install = id !== undefined ? installs.get(id) : undefined;
      const authErr = requireBearer(headers, install);
      if (authErr !== null) {
        return authErr;
      }
      if (install === undefined) {
        return errorResponse("unknown_installation");
      }
      // B4: revoked id can never be reused for opt-in.
      if (install.state === "revoked") {
        return errorResponse("revoked");
      }
      const obj = (body ?? {}) as {
        scopes?: unknown;
        consent_version?: unknown;
        contact?: unknown;
      };
      if (!Array.isArray(obj.scopes) || !obj.scopes.every((s) => typeof s === "string")) {
        return errorResponse("schema_invalid");
      }
      if (typeof obj.consent_version !== "string" || obj.consent_version.length === 0) {
        return errorResponse("schema_invalid");
      }
      // B2 contact rules.
      if (Object.hasOwn(obj, "contact")) {
        if (obj.contact === null) {
          return errorResponse("schema_invalid");
        }
        if (typeof obj.contact !== "object" || Array.isArray(obj.contact)) {
          return errorResponse("schema_invalid");
        }
        const c = obj.contact as Record<string, unknown>;
        if (contactHasEmptyString(c)) {
          return errorResponse("schema_invalid");
        }
        if (Object.keys(c).length === 0) {
          install.contact = undefined;
        } else {
          // Whole replace — no per-field merge (B2).
          const next: FakeContact = {};
          if (typeof c.name === "string") {
            next.name = c.name;
          }
          if (typeof c.email === "string") {
            next.email = c.email;
          }
          if (typeof c.sms === "string") {
            next.sms = c.sms;
          }
          install.contact = next;
        }
      }
      // B1: replace scope set with request scopes.
      install.scopes = [...obj.scopes];
      install.consentVersion = obj.consent_version;
      install.state = "active";
      install.expiresAt = nowMs + YEAR_MS;
      return jsonResponse(200, {
        state: "active",
        scopes: install.scopes,
        expires_at: install.expiresAt,
        contact_verified: false,
      });
    }

    if (route === "optout") {
      const id = installIdFromPath(path);
      const install = id !== undefined ? installs.get(id) : undefined;
      const authErr = requireBearer(headers, install);
      if (authErr !== null) {
        return authErr;
      }
      if (install === undefined) {
        return errorResponse("unknown_installation");
      }
      // B3: revoked from any state.
      install.state = "revoked";
      install.scopes = [];
      return jsonResponse(200, { state: "revoked" });
    }

    if (route === "status") {
      const id = installIdFromPath(path);
      const install = id !== undefined ? installs.get(id) : undefined;
      const authErr = requireBearer(headers, install);
      if (authErr !== null) {
        return authErr;
      }
      if (install === undefined) {
        return errorResponse("unknown_installation");
      }
      // B3: status still answers for revoked.
      return jsonResponse(200, {
        state: install.state,
        scopes: install.scopes,
        ...(install.expiresAt !== undefined ? { expires_at: install.expiresAt } : {}),
        ...(install.consentVersion !== undefined
          ? { consent_version: install.consentVersion }
          : {}),
        contact_verified: false,
      });
    }

    if (route === "challenge") {
      const obj = (body ?? {}) as { install_id?: unknown; scope?: unknown };
      if (typeof obj.install_id !== "string" || typeof obj.scope !== "string") {
        return errorResponse("schema_invalid");
      }
      const install = installs.get(obj.install_id);
      const authErr = requireBearer(headers, install);
      if (authErr !== null) {
        return authErr;
      }
      if (install === undefined) {
        return errorResponse("unknown_installation");
      }
      if (install.state === "revoked") {
        return errorResponse("revoked");
      }
      // B6: pending → not_opted_in; expired → optin_expired; scope outside set → scope_not_consented.
      if (install.state === "pending") {
        return errorResponse("not_opted_in");
      }
      if (
        typeof install.expiresAt === "number" &&
        install.expiresAt > 0 &&
        install.expiresAt <= nowMs
      ) {
        return errorResponse("optin_expired");
      }
      if (!install.scopes.includes(obj.scope)) {
        return errorResponse("scope_not_consented");
      }
      const nonce = randomUUID();
      install.nonces.set(nonce, { scope: obj.scope, issuedAt: nowMs });
      return jsonResponse(200, { nonce });
    }

    // submissions
    const scopeMatch = /^\/v1\/submissions\/([^/]+)$/.exec(path);
    const scope = scopeMatch?.[1];
    if (scope === undefined || !isKnownScope(scope)) {
      return errorResponse("not_found");
    }
    const obj = (body ?? {}) as {
      install_id?: unknown;
      nonce?: unknown;
      payload?: unknown;
    };
    if (typeof obj.install_id !== "string" || typeof obj.nonce !== "string") {
      return errorResponse("schema_invalid");
    }
    const install = installs.get(obj.install_id);
    const authErr = requireBearer(headers, install);
    if (authErr !== null) {
      return authErr;
    }
    if (install === undefined) {
      return errorResponse("unknown_installation");
    }
    if (install.state === "revoked") {
      return errorResponse("revoked");
    }
    if (install.state === "pending") {
      return errorResponse("not_opted_in");
    }
    if (
      typeof install.expiresAt === "number" &&
      install.expiresAt > 0 &&
      install.expiresAt <= nowMs
    ) {
      return errorResponse("optin_expired");
    }
    if (!install.scopes.includes(scope)) {
      return errorResponse("scope_not_consented");
    }
    const nonceRec = install.nonces.get(obj.nonce);
    if (nonceRec === undefined) {
      return errorResponse("nonce_invalid");
    }
    if (nonceRec.scope !== scope) {
      return errorResponse("nonce_scope_mismatch");
    }
    install.nonces.delete(obj.nonce);

    const schemaEntry = SCOPE_SCHEMAS[scope as keyof typeof SCOPE_SCHEMAS];
    const parsed = schemaEntry.schema.safeParse(obj.payload);
    if (!parsed.success) {
      return errorResponse("schema_invalid");
    }
    // B7: no contact fields in event payloads (schemas are .strict() and have none).
    const id = randomUUID();
    install.submissions.push({
      id,
      scope,
      payload: parsed.data,
      at: nowMs,
    });
    return jsonResponse(200, { id });
  };

  return {
    fetch: fetchImpl,
    installs,
    requests,
    advance(ms: number) {
      nowMs += ms;
    },
    failNext(route: CollectorRoute, code: keyof typeof ERROR_CODES) {
      failQueue.push({ route, code });
    },
    hangNext(route: CollectorRoute, ms: number) {
      hangQueue.push({ route, ms });
    },
    now() {
      return nowMs;
    },
  };
}
