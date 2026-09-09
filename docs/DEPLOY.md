# Deployment & CI/CD

How `@deftai/canonical` gets tested, published, and released. Repo-only doc —
not part of the npm distribution.

There is no runtime deployment: the product is an npm package installed
globally by end users (`npm i -g @deftai/canonical`). "Deploy" here means
"publish to the npm registry".

## CI (`.github/workflows/ci.yml`)

Runs on every push to `main` and every pull request:

1. `pnpm install --frozen-lockfile` (Node from `.nvmrc`, pnpm via corepack)
2. `pnpm run build` (tsc — **staging** bake by default)
3. `pnpm run lint` (biome)
4. `pnpm run test` (vitest with coverage — coverage is reported, not enforced)

Alongside the repo workflow, two GitHub-side checks run on this repository
(configured in repo settings, not in workflow files):

- **CodeQL** — GitHub default-setup code scanning.
- **Greptile Review** — AI code review on PRs; it is a required status check
  on `main`, so PRs wait for it. Direct pushes to `main` by an admin bypass
  it (GitHub logs the bypass on the push).

## Channels (build-time bake + npm dist-tags)

Canonical ships **channel-hardcoded** artifacts. The collector host is chosen
at build time via `CANONICAL_BUILD_CHANNEL` (set by the publish workflow from
the git tag shape):

| Git tag | Bake | Collector | npm dist-tag | Install |
|---|---|---|---|---|
| `vX.Y.Z-staging.N` | staging | `api.deft-staging.co` | `staging` | `npm i -g @deftai/canonical@staging` |
| `vX.Y.Z` | production | `api.deft.co` | `prod` | `npm i -g @deftai/canonical@prod` |
| *(promote)* | *(same prod tarball)* | `api.deft.co` | `latest` **and** `stable` | `npm i -g @deftai/canonical` |

Rules:

- Tag name **is** the version and the channel signal. Staging must include
  `-staging.N`. Plain `vX.Y.Z` is production-only.
- Staging tarballs are **never** retagged to `latest`/`stable` (wrong host).
- Production candidates publish to `--tag prod` only. After smoke, **promote**
  moves `latest` + `stable` to that version (no rebuild).
- `latest` and `stable` are synonyms by policy (always set together).
- Runtime env vars do **not** switch the collector host.
- `canon --version` prints `canon <version> (<channel>)`.

### How versions increase

| Channel | Version shape | Who bumps | Example sequence |
|---|---|---|---|
| Staging | `{nextPatch}-staging.N` | You (git tag). Helper: `pnpm run next-staging-version` | After GA `0.3.0` → `0.3.1-staging.1`, `.2`, … |
| Prod candidate | plain `X.Y.Z` | Release commit bumps `package.json` + CHANGELOG, then tag `vX.Y.Z` | `0.3.1` |
| GA | same `X.Y.Z` | Promote only (dist-tags) | `latest`/`stable` → `0.3.1` |

Staging prereleases are of the **next** patch after current GA (`latest` on
npm, else `package.json`). They sort below the eventual release
(`0.3.1-staging.5` < `0.3.1`) and never become the default install.

## Publish (`.github/workflows/npm-publish.yml`)

### Automatic (git tag push)

```bash
# Staging (unreleased / daily) — bake staging, publish @staging
pnpm run next-staging-version    # e.g. prints 0.3.1-staging.1
git tag v0.3.1-staging.1
git push origin v0.3.1-staging.1

# Production candidate — bake production, publish @prod (NOT latest yet)
# (after CHANGELOG + package.json bump on main)
git tag v0.3.1
git push origin v0.3.1
```

Pipeline per tag: checkout tag → resolve channel from version →
`CANONICAL_BUILD_CHANNEL=…` build → `test:fast` → verify bake →
`npm publish --access public --tag staging|prod`.

### Promote to GA (`latest` + `stable`)

After you smoke `@prod`:

```bash
# Local (after npm login with dist-tag permission):
pnpm run promote -- 0.3.1

# Or GitHub Actions (requires repo secret NPM_TOKEN — OIDC covers publish only):
gh workflow run "npm publish" -f action=promote -f version=0.3.1
```

Promote does **not** rebuild. It only moves dist-tags.

### Manual re-publish

```bash
gh workflow run "npm publish" -f action=publish -f tag=v0.3.1-staging.1
```

### Auth notes

- **Publish** uses npm Trusted Publishing (OIDC) — no `NPM_TOKEN` for
  `npm publish`. Setup (already done): npmjs.com → package Settings →
  Trusted Publisher → workflow `npm-publish.yml`.
- **Promote** (`npm dist-tag add`) is **not** covered by OIDC. Use
  `pnpm run promote` locally, or set repo secret `NPM_TOKEN` (Automation
  token with dist-tag permission) for the promote workflow job.
- GitHub-hosted runner required for provenance on publish.
- Idempotent re-publish: if the version already exists, the publish step
  continues (and best-effort ensures the channel dist-tag).

## Release runbook

### A. Staging push (anytime unreleased work is on `main`)

1. Land commits on `main` (CI green).
2. `pnpm run next-staging-version` → e.g. `0.3.1-staging.1`
3. `git tag v0.3.1-staging.1 && git push origin v0.3.1-staging.1`
4. Watch the workflow; install with `npm i -g @deftai/canonical@staging`
5. Confirm `canon --version` shows `(staging)` and talks to staging collector.

No CHANGELOG version section required for staging tags (they stay under
`[Unreleased]` until a real release).

### B. Production candidate + GA

1. Ensure `CHANGELOG.md` `[Unreleased]` covers everything since the last GA.
2. Release commit: rename `[Unreleased]` → `[X.Y.Z] - <date>`, bump
   `package.json` `version` to `X.Y.Z`. Land on `main`.
3. Tag **only after** that commit is on `main`:

   ```bash
   git tag vX.Y.Z && git push origin main && git push origin vX.Y.Z
   ```

4. Workflow publishes `@prod` (production bake). Smoke:

   ```bash
   npm i -g @deftai/canonical@prod
   canon --version   # expect (production)
   ```

5. Promote when happy:

   ```bash
   pnpm run promote -- X.Y.Z
   npm view @deftai/canonical dist-tags
   ```

Never tag a plain `vX.Y.Z` without a matching changelog entry, and never add
a versioned changelog entry without tagging. No GitHub Releases are created
for tags (tag + CHANGELOG.md are the release record).

### Local packs (no npm)

```bash
pnpm run build:staging      # or build:production
npm pack
npm i -g ./deftai-canonical-*.tgz
canon --version
```

## Gotchas

- **Actions are SHA-pinned** — third-party actions in both workflows are
  referenced by full commit SHA with the version tag in a trailing comment
  (supply-chain hardening; floating tags like `@v5` can be re-pointed). To
  upgrade one, resolve the new tag to its commit —
  `gh api repos/actions/checkout/commits/<tag> --jq .sha` — and update both
  the SHA and the comment.
- **GH007 email privacy** — commits authored with a private email are rejected
  on push. Use the GitHub noreply address in `git config user.email`.
- **`task -x`** — when smoke-testing verbs through go-task, `-x` is required to
  see real exit codes; plain `task` reports failures as 201.
- **Local package smoke test** — `npm pack` then `npm i -g ./deftai-canonical-*.tgz`;
  confirm the tarball contents with `npm pack --dry-run` (should contain
  `dist/`, `content/`, `tasks/`, `.githooks/`, `Taskfile.yml` and nothing else).
- **Do not** push `vX.Y.Z-beta…` or other prerelease forms — only `-staging.N`
  or plain `X.Y.Z` are accepted by the publish workflow.
