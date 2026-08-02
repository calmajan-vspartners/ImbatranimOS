# Lint debt: backend type-safety errors (pre-existing)

> **RESOLVED 2026-07-17** — formatting was paid in briefs 16/17; the backend
> `no-unsafe-*` slice is paid in
> [brief 29](../../briefs/done/29-backend-lint-typing.md) (plus CS-5 for
> bookmarks). `backend#lint` and root `npm run lint` are now green
> (0 errors, 0 warnings). Kept for history.

Captured 2026-07-17 while landing turborepo (brief 16); updated same day
after brief 17 paid down most of it. Corrections to the original capture:
backend lint never actually passed (the "backend lint passes" claim
misread a turbo failure summary), and the "30 unformatted files" were
real — the fork never had prettier-clean sources.

**Paid (2026-07-17, briefs 16/17 + sweep commit `934619f`):**
- Formatting: prettier 3.8.3 sweep across backend/core/add-ons;
  `npm run format:check` green 9/9. Root pins prettier 3.8.3 so
  backend's eslint-plugin-prettier can't resolve a newer hoisted copy.
- Frontend-side eslint errors: `_`-prefix convention codified
  (argsIgnorePattern in the new core/add-on configs), 6 real
  setState-in-effect errors fixed, dead code removed. Core + all 7
  add-ons lint green.

**Still open — backend#lint (~40 errors), keeps root `npm run lint` red:**
- `@typescript-eslint/no-unsafe-*` across raw better-sqlite3 call sites
  (bookmarks/notes/todos services type query results as `any`) — wants
  typed row shapes or `.get<T>()`-style casts per repository.
- A few unused imports (e.g. `HttpAdapterHost`, `HttpException`,
  `HttpStatus` in `main.ts`).

Promoting to a brief: type the sqlite repositories, drop dead imports,
then consider lint+format:check as a pre-tag gate for v1.0 (brief 15).
Backend `src/**` was untouchable during brief 17, which is why this
remains.
