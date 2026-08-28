# Vendored `@deft/*` packages

Temporary copies of `@deft/collection-sdk` and `@deft/schemas` from
`deft-collection-endpoint`, used until those packages are published to npm.

Refresh after rebuilding the sibling repo:

```sh
pnpm run vendor:collection-sdk
# or: DEFT_COLLECTION_ROOT=/path/to/deft-collection-endpoint pnpm run vendor:collection-sdk
```

Do not edit files under this tree by hand — re-vendor instead.
