# Deployment & CI/CD

How `@deftai/canonical` gets tested, published, and released. Repo-only doc —
not part of the npm distribution.

There is no runtime deployment: the product is an npm package installed
globally by end users (`npm i -g @deftai/canonical`). "Deploy" here means
"publish to the npm registry".

## CI (`.github/workflows/ci.yml`)

Runs on every push to `main` and every pull request:

1. `pnpm install --frozen-lockfile` (Node from `.nvmrc`, pnpm via corepack)
2. `pnpm run build` (tsc)
3. `pnpm run lint` (biome)
4. `pnpm run test` (vitest with coverage — coverage is reported, not enforced)

Alongside the repo workflow, two GitHub-side checks run on this repository
(configured in repo settings, not in workflow files):

- **CodeQL** — GitHub default-setup code scanning.
- **Greptile Review** — AI code review on PRs; it is a required status check
  on `main`, so PRs wait for it. Direct pushes to `main` by an admin bypass
  it (GitHub logs the bypass on the push).

## Publish (`.github/workflows/npm-publish.yml`)

Triggered by pushing a tag matching `v*`, or manually via `workflow_dispatch`
with an existing tag (for re-publishing after a failed run — no tag surgery).

Pipeline: checkout the tag → install → build → `test:fast` → align
`package.json` version with the tag (`npm version --no-git-tag-version`) →
`npm publish --access public`.

Key properties:

- **npm Trusted Publishing (OIDC)** — no `NPM_TOKEN` secret anywhere. The
  workflow has `id-token: write`; the npm CLI exchanges the GitHub OIDC token
  for publish auth. Provenance attestation is automatic.
- **GitHub-hosted runner required** — the registry rejects provenance bundles
  signed on self-hosted runners.
- **Idempotent** — a re-run does not fail on E409 when the version is already
  published (it verifies via `npm view` and continues).
- One-time registry setup (already done): npmjs.com → package Settings →
  Trusted Publisher: GitHub Actions, org `deftai`, repo `canonical`, workflow
  `npm-publish.yml`.

## Release runbook

Versioning is manual and changelog-driven (see `content/scm.md` for the rules
the pack itself states):

1. Ensure `CHANGELOG.md` `[Unreleased]` covers everything since the last tag.
2. Release commit: rename `[Unreleased]` to `[X.Y.Z] - <date>` (keep an empty
   `[Unreleased]` above it) and bump `version` in `package.json` to match.
   Land it on `main` (release PR, or direct push by a maintainer).
3. Tag **only after** the release commit is on `main`:

   ```bash
   git tag vX.Y.Z && git push origin main && git push origin vX.Y.Z
   ```

4. The tag push triggers the publish workflow. Verify:

   ```bash
   gh run watch --exit-status $(gh run list --workflow "npm publish" --limit 1 --json databaseId -q '.[0].databaseId')
   npm view @deftai/canonical version
   ```

Never tag without a matching changelog entry, and never add a versioned
changelog entry without tagging. No GitHub Releases are created for tags
(convention so far: the tag + CHANGELOG.md are the release record).

## Gotchas

- **GH007 email privacy** — commits authored with a private email are rejected
  on push. Use the GitHub noreply address in `git config user.email`.
- **`task -x`** — when smoke-testing verbs through go-task, `-x` is required to
  see real exit codes; plain `task` reports failures as 201.
- **Local package smoke test** — `npm pack` then `npm i -g ./deftai-canonical-*.tgz`;
  confirm the tarball contents with `npm pack --dry-run` (should contain
  `dist/`, `content/`, `tasks/`, `.githooks/`, `Taskfile.yml` and nothing else).
