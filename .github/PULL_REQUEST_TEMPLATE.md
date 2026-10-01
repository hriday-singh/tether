## Description
<!-- Provide a brief description of the changes introduced by this PR. -->

## Motivation & Context
<!-- Why is this change required? What problem does it solve? If it fixes an issue, link it here: Fixes #123 -->

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Performance improvement or refactor
- [ ] Documentation update
- [ ] Test coverage addition

## Affected Packages/Workspaces
- [ ] `@tether/server` (Fastify API, WebSocket engine, room persistence)
- [ ] `@tether/web` (Next.js web client, editor, UI components)
- [ ] `@tether/shared` (protocol schemas, token bucket, codecs)
- [ ] `@tether/sync-client` (client sync protocol adapter)
- [ ] `@tether/chaos` (network fault injection & stress tests)

## Verification Checklist
- [ ] My code follows the code style and modularity rules of this project (no single file > 700 lines).
- [ ] `pnpm typecheck` passes with 0 errors.
- [ ] `pnpm lint` passes with 0 warnings/errors.
- [ ] `pnpm test` passes with all tests green.
- [ ] `pnpm chaos:ci` passes (if changes affect the sync engine, protocol, or state vectors).
- [ ] If I changed `@tether/shared` or `@tether/sync-client`, I ran `pnpm build:pkg`.
- [ ] No hardcoded tokens, secrets, or local environment paths are included.
