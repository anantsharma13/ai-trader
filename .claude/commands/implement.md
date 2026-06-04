# /implement — Feature Implementation Workflow

Argument: what to build. Example: `/implement Phase 1 data layer — yahoo.ts DataProvider`

---

## Step 1 — Clarify before writing a single line

Ask the user these questions up front. Do not assume any answer.

**A. What layer/type is this?**
- `data` — fetches quotes, OHLCV, indicators
- `research` — fetches news, RSS, web pages
- `llm` — LLM provider adapter
- `db` — Supabase Postgres or Storage adapter
- `engine` — mock broker / order execution
- `agent` — a Strands agent (analyst, portfolio manager, etc.)
- `orchestrator` — wires agents together, runs the daily loop
- `config` — startup validation, env loading

**B. Is there an existing interface to implement?**
Check `src/*/types.ts`. If yes: implement it exactly — no extra public methods.
If no: define the interface first, confirm with user, then implement.

**C. Does this touch an existing file or create a new one?**
Prefer editing existing files. Confirm if creating something new.

**D. Any known constraints not in `plan.md`?**
Rate limits, auth quirks, data shape differences, etc.

Stop here. Do not continue until answers are clear.

---

## Step 2 — Research (mandatory)

### 2a. Find existing patterns
```bash
grep -r "createProvider\|implements\|interface " src/ --include="*.ts" -l
```
Read the closest existing adapter. Match its structure exactly — same export shape, same error handling pattern, same logging style.

### 2b. Fetch live library docs
For every npm package you'll use, fetch current docs **before writing code**:
```
mcp__plugin_context7_context7__resolve-library-id → then query-docs
```
Or: WebSearch `"<package>" site:github.com README`

Check actual method names, return types, options object shape. Do not rely on training data — APIs change.

### 2c. Verify package fitness
- Weekly downloads > 10k (check npmjs.com)
- Last publish < 12 months
- No open critical CVEs

If a better option exists, surface it to the user before proceeding.

---

## Step 3 — Design (confirm before building)

Write out:
1. File(s) affected (aim for 1–2)
2. Interface being implemented
3. Public API: function/method signatures only
4. Pure functions that contain business logic (no I/O inside)
5. I/O boundaries (where DB/HTTP calls happen)

If the change touches > 2 files or needs a new interface: **stop and confirm the design with the user**.

---

## Step 4 — Implement

### Adapter structure
```
src/llm/providers/<name>.ts       implements LLMProvider
src/data/providers/<name>.ts      implements DataProvider
src/research/providers/<name>.ts  implements ResearchProvider
src/db/providers/<name>.ts        implements StateStore / StorageProvider
src/engine/<name>.ts              implements BrokerAdapter
```
Register in the layer's `index.ts` factory. No other files change.

### Required in every implementation

**Error handling**
- Every async call wrapped in try/catch
- Error message includes: operation name + input (symbol, URL, etc.) + original error
- Transient failures (HTTP 5xx, network): retry max 3× with exponential backoff (100ms, 200ms, 400ms)
- Non-retryable failures: log error + rethrow — let the orchestrator decide whether to abort or skip

**Timeouts**
- HTTP calls: `AbortSignal.timeout(10_000)` or equivalent — never rely on server to close
- DB operations: 30 s
- LLM calls: 60 s
- Wrap with a helper if the same timeout logic repeats

**Logging**
- Log at start of every external call: `log.debug({ op, symbol }, 'fetching quote')`
- Log at end with duration: `log.info({ op, symbol, ms: Date.now() - t0 }, 'quote fetched')`
- Log every error with full context before rethrowing: `log.error({ op, symbol, err }, 'quote failed')`
- Use `pino` logger from `src/config/logger.ts` — never use `console.log` in production paths

**Zod validation**
- Validate every external API response at the boundary
- Schema lives next to the adapter, not inside the function

---

## Step 5 — Testing

**Ask the user first:** "What kind of test do you want for this?"

Options for this project (no UI, no browser):
- **CLI smoke test** — `npx tsx src/<path>.ts` with real or stubbed env vars, logs output to console. Use for quick verification of a single adapter.
- **Integration test** — hits the real external service (Yahoo Finance, Supabase) with test credentials. Use when the contract with the external service matters.
- **Unit test** — pure function only, no I/O. Use for scoring logic, indicator calculation, risk checks.

**Never suggest Playwright, browser testing, or UI testing** — this project has no frontend.

Default if user doesn't specify: CLI smoke test for the happy path + one error path (bad symbol, network timeout simulated).

Smoke test pattern:
```ts
// npx tsx src/data/providers/yahoo.smoke.ts
import { createDataProvider } from '../index.js'
const provider = createDataProvider()
const quote = await provider.getQuote('TATAMOTORS.NS')
console.log(JSON.stringify(quote, null, 2))
```

---

## Step 6 — Verify and report

Run in this order:
1. `npx tsc --noEmit` — must pass clean
2. Run the smoke/unit test — capture output
3. Check logs contain expected entries (op, symbol, duration)
4. Run the phase verify step from `implementation.md` if one exists

Report back: what ran, what the output was, any warnings. Do not claim done without running these.

---

## Hard stops — pause and ask the user

- Touching agent/orchestrator AND provider code in one change
- No npm package found and hand-rolling > 50 lines of logic
- Library docs contradict `plan.md` assumptions
- Change breaks a layer boundary (agent importing provider library directly)
- Retry/timeout behavior is unclear for this operation
