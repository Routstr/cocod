# TODO

## Critical fixes

- [ ] Fix PBKDF2 salt handling in `src/utils/crypto.ts` (`Buffer.from(salt).buffer` can use the wrong byte range; pass a proper `Uint8Array`/`ArrayBuffer` slice to `crypto.subtle.deriveKey`).
- [ ] Validate numeric CLI inputs in `src/cli.ts` (`receive bolt11 <amount>`, `send cashu <amount>`) before sending requests; reject `NaN`, non-integers, and non-positive values.
- [ ] Validate request bodies in `src/routes.ts` for all POST routes (`amount`, `invoice`, `token`, `url`, `username`) and return 400 for invalid input instead of falling through to 500.
- [ ] Ensure config directories exist before writes/deletes in daemon and init flows (`src/daemon.ts`, `src/routes.ts`, `src/utils/config.ts`) so first-run startup does not fail on missing `~/.cocod`.

## High-priority correctness/UX

- [ ] Remove duplicated socket/config path logic in `src/cli-shared.ts`; import shared constants from `src/utils/config.ts` so CLI and daemon always use the same paths.
- [ ] Replace unsafe error casting in `src/cli-shared.ts` (`(error as Error).message`) with `unknown` narrowing (`error instanceof Error ? error.message : String(error)`).
- [ ] Decide and implement a consistent encrypted-wallet lifecycle in `src/routes.ts` `/unlock`:
  - currently a `config` object is built and never used,
  - behavior for whether unlocked state should persist to disk is unclear.
- [ ] Return consistent HTTP status codes in `src/routes.ts` for all failures (e.g. `/npc/username` confirm-failure path currently returns error without explicit non-2xx status).
- [ ] Standardize response shapes in `src/routes.ts` (some endpoints return strings, others objects, others newline-joined text like `/mints/list`).
- [ ] Review daemon shutdown flow in `src/daemon.ts` (`setTimeout` + `process.exit`) and simplify for predictable cleanup.

## Documentation drift

- [ ] Update `README.md` command docs from `mint ...` to `mints ...` to match `src/cli.ts`.
- [ ] Update `README.md` path defaults (`~/.cocod/...`) and architecture notes to match the actual runtime behavior and `src/utils/config.ts`.
- [ ] Update `AGENTS.md` defaults (`/tmp/cocod.sock`, `/tmp/cocod.pid`) if they are no longer accurate.
- [ ] Fix dependency docs mismatch in `README.md` (`coco-cashu-sqlite3` vs actual `coco-cashu-sqlite-bun`).
- [ ] Replace placeholder license text in `README.md` (`[Add your license here]`) with the real license.

## Quality and maintenance

- [ ] Add automated tests (Bun test) for:
  - crypto round-trip and wrong-passphrase failure,
  - daemon state transitions (`UNINITIALIZED`/`LOCKED`/`UNLOCKED`/`ERROR`),
  - route validation and status codes,
  - CLI argument validation.
- [ ] Add regression tests for SSE `/events` stream behavior (history updates + keep-alive pings + disconnect cleanup).
- [ ] Decide whether build artifacts should ever be tracked; if not, remove committed artifacts like `cocod-0.0.1.tgz` and keep generated outputs out of PRs.
