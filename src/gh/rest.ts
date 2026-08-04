import { spawnSync } from "node:child_process";

/**
 * GitHub REST helper. All network goes through an injectable `fetch`-shaped
 * seam so no test ever touches the live API. Token resolution: GH_TOKEN /
 * GITHUB_TOKEN env, else `gh auth token`. Repo resolution from `origin`.
 */

export interface GhSeams {
  readonly fetchFn?: typeof fetch;
  readonly env?: NodeJS.ProcessEnv;
  /** Injectable subprocess for `gh auth token` / `git remote get-url`. */
  readonly exec?: (
    cmd: string,
    args: readonly string[],
    cwd?: string,
  ) => {
    readonly status: number;
    readonly stdout: string;
  };
}

const defaultExec = (cmd: string, args: readonly string[], cwd?: string) => {
  const r = spawnSync(cmd, args as string[], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return { status: r.status ?? 1, stdout: r.stdout ?? "" };
};

export class GhConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GhConfigError";
  }
}

export class GhApiError extends Error {
  readonly httpStatus: number;
  readonly endpoint: string;
  constructor(endpoint: string, httpStatus: number, message: string) {
    super(`GitHub API ${endpoint} -> ${httpStatus}: ${message}`);
    this.name = "GhApiError";
    this.httpStatus = httpStatus;
    this.endpoint = endpoint;
  }
}

export function resolveToken(seams: GhSeams = {}): string {
  const env = seams.env ?? process.env;
  const fromEnv = env.GH_TOKEN ?? env.GITHUB_TOKEN;
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }
  const exec = seams.exec ?? defaultExec;
  try {
    const r = exec("gh", ["auth", "token"]);
    if (r.status === 0 && r.stdout.trim() !== "") {
      return r.stdout.trim();
    }
  } catch {
    // fall through
  }
  throw new GhConfigError(
    "no GitHub token: set GH_TOKEN/GITHUB_TOKEN or authenticate with `gh auth login`",
  );
}

export interface RepoSlug {
  readonly owner: string;
  readonly repo: string;
}

export function resolveRepo(projectRoot: string, seams: GhSeams = {}): RepoSlug {
  const exec = seams.exec ?? defaultExec;
  const r = exec("git", ["remote", "get-url", "origin"], projectRoot);
  if (r.status !== 0) {
    throw new GhConfigError("no `origin` remote: cannot resolve GitHub repo");
  }
  const url = r.stdout.trim();
  const m =
    /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(url) ?? /^([^/]+)\/([^/]+)$/.exec(url);
  if (m === null || m[1] === undefined || m[2] === undefined) {
    throw new GhConfigError(`origin remote is not a GitHub repo: ${url}`);
  }
  return { owner: m[1], repo: m[2] };
}

export interface GhClient {
  readonly get: (endpoint: string) => Promise<unknown>;
  readonly post: (endpoint: string, body: unknown) => Promise<unknown>;
  readonly patch: (endpoint: string, body: unknown) => Promise<unknown>;
  readonly put: (endpoint: string, body: unknown) => Promise<unknown>;
}

const API_BASE = "https://api.github.com";

/** Build a REST client. Endpoints are absolute paths like `/repos/{o}/{r}/issues/1`. */
export function ghClient(seams: GhSeams = {}): GhClient {
  const fetchFn = seams.fetchFn ?? fetch;
  const token = resolveToken(seams);
  const call = async (method: string, endpoint: string, body?: unknown): Promise<unknown> => {
    const res = await fetchFn(`${API_BASE}${endpoint}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "user-agent": "canonpack",
        "x-github-api-version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new GhApiError(endpoint, res.status, text.slice(0, 300));
    }
    if (text === "") {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };
  return {
    get: (endpoint) => call("GET", endpoint),
    post: (endpoint, body) => call("POST", endpoint, body),
    patch: (endpoint, body) => call("PATCH", endpoint, body),
    put: (endpoint, body) => call("PUT", endpoint, body),
  };
}
