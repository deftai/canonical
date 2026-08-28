// SDK-3: a file-based CredentialStorage adapter (IMPLEMENTATION §1.9 — "client persists both
// locally ... mode 0600", since the file holds a bearer-equivalent install token).
//
// IMPORTANT: this module must NOT import `node:fs` (or any node built-in) at the top level.
// `@deft/collection-sdk`'s entrypoint (src/index.ts) is imported directly inside workerd by the
// SDK-6 integration test (packages/server/test/sdk-integration/full-flow.test.ts), which never
// calls `fileStorage()` but does pull in everything the entrypoint re-exports. A static
// `import ... from "node:fs"` at module scope would be evaluated the moment the module graph
// loads — including inside workerd, where there is no real filesystem — so every `node:fs`
// access here is deferred to a dynamic `import()` inside the async methods below, which only
// runs if a host actually calls `fileStorage(...).load()/save()/clear()`. Node resolves the
// dynamic import exactly like a static one; workerd simply never has to.
async function loadFs() {
    return import("node:fs/promises");
}
async function loadPath() {
    return import("node:path");
}
async function loadOs() {
    return import("node:os");
}
function isNodeError(err) {
    return typeof err === "object" && err !== null && "code" in err;
}
/** Expands a leading `~/` (or a bare `~`) to `os.homedir()`. `~user`-style paths are left
 * untouched (a literal path) since resolving them needs a passwd lookup this adapter doesn't
 * do. Deferred imports (`node:path`, `node:os`) for the same reason as `node:fs/promises` above
 * — this module must stay loadable inside workerd. */
async function expandHome(filePath) {
    if (filePath !== "~" && !filePath.startsWith("~/") && !filePath.startsWith("~\\")) {
        return filePath;
    }
    const [os, path] = await Promise.all([loadOs(), loadPath()]);
    const home = os.homedir();
    if (filePath === "~")
        return home;
    return path.join(home, filePath.slice(2));
}
function parseStoredCredentials(text) {
    let data;
    try {
        data = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (data !== null &&
        typeof data === "object" &&
        typeof data.installId === "string" &&
        typeof data.token === "string") {
        return {
            installId: data.installId,
            token: data.token,
        };
    }
    return null;
}
/** Persists credentials as JSON at `filePath`, mode 0600 (owner read/write only). Missing file
 * reads as "no stored credentials" rather than an error. A leading `~/` (or a bare `~`) is
 * expanded under `os.homedir()`. Writes are atomic: a 0600 temp file is written and fsynced,
 * then renamed onto the target (IMPLEMENTATION §3.4 / SDK-3) — a crash mid-save must never leave
 * a truncated/partial target, since a truncated file reads as "no credentials" and would
 * silently mint and burn a new once-only install token. */
export function fileStorage(filePath) {
    return {
        async load() {
            const fs = await loadFs();
            const target = await expandHome(filePath);
            let text;
            try {
                text = await fs.readFile(target, "utf-8");
            }
            catch (err) {
                if (isNodeError(err) && err.code === "ENOENT")
                    return null;
                throw err;
            }
            return parseStoredCredentials(text);
        },
        async save(creds) {
            const fs = await loadFs();
            const path = await loadPath();
            const target = await expandHome(filePath);
            const dir = path.dirname(target);
            await fs.mkdir(dir, { recursive: true, mode: 0o700 });
            const text = JSON.stringify({ installId: creds.installId, token: creds.token });
            const tmpPath = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
            const handle = await fs.open(tmpPath, "w", 0o600);
            try {
                await handle.writeFile(text, "utf-8");
                // `mode` on open is subject to the process umask on some platforms, so chmod
                // explicitly afterwards to guarantee exactly 0600 regardless of umask.
                await handle.chmod(0o600);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            try {
                await fs.rename(tmpPath, target);
            }
            catch (err) {
                // Windows can refuse to rename onto an existing target; fall back to unlink-then-rename.
                if (isNodeError(err) && err.code === "EEXIST") {
                    await fs.unlink(target);
                    await fs.rename(tmpPath, target);
                }
                else {
                    await fs.unlink(tmpPath).catch(() => undefined);
                    throw err;
                }
            }
            // Best-effort: fsync the directory too, so the rename itself is durable. Not all
            // platforms support opening a directory this way; ignore failures.
            try {
                const dirHandle = await fs.open(dir, "r");
                try {
                    await dirHandle.sync();
                }
                finally {
                    await dirHandle.close();
                }
            }
            catch {
                // Best-effort only (e.g. unsupported on this platform) — not fatal.
            }
        },
        async clear() {
            const fs = await loadFs();
            const target = await expandHome(filePath);
            try {
                await fs.unlink(target);
            }
            catch (err) {
                if (isNodeError(err) && err.code === "ENOENT")
                    return;
                throw err;
            }
        },
    };
}
//# sourceMappingURL=file.js.map