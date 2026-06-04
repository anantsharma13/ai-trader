# ai-trader

Autonomous Indian-market paper-trading multi-agent system. Daily GitHub Actions cron → multi-agent analysis (Strands Agents SDK) → mock orders in Supabase Postgres → HTML report in Supabase Storage. No real money, no UI.

## Stack
- Runtime: Node.js 20+, TypeScript strict
- Agents: `@strands-agents/sdk` (TypeScript v1.0)
- LLM: provider-agnostic via `src/llm/` adapter (default: Azure OpenAI)
- Data: `yahoo-finance2` (.NS tickers), `technicalindicators`
- Research: `rss-parser`, `cheerio`, `robots-parser`
- DB/Storage: `@supabase/supabase-js`
- Validation: `zod` everywhere external data enters the system
- Config: `config.json` + `.env` (zod-validated at startup)

## Layer rules
Agents and orchestrator import only from `src/llm`, `src/data`, `src/research`, `src/db`, `src/engine` — never from provider libraries directly. Every external dependency lives behind an interface in `src/*/types.ts`.

## General coding standards
- No hardcoded values — all tunables in `config.json`, secrets in `.env`
- Named exports, factory functions (`createXxx()`), interfaces over classes
- No `any` without a comment explaining why
- Comments only when the WHY is non-obvious

## Error handling
- Every async operation must have a try/catch
- Errors include context: what operation failed, what input caused it
- Transient failures (HTTP, DB): retry with exponential backoff (max 3 attempts)
- Fatal errors: log then exit with non-zero code so GitHub Actions marks the run failed

## Timeouts
- All HTTP calls: explicit timeout (default 10 s, configurable)
- DB operations: 30 s max
- Agent LLM calls: 60 s max
- Never let a hanging call block the entire run silently

## Logging
- Use a structured logger (e.g. `pino`) — JSON lines in production, pretty in dev
- Log at entry and exit of every major operation (data fetch, agent call, DB write)
- Log symbol + operation + duration on every external call
- Log level via `LOG_LEVEL` env var (default `info`; set `debug` locally)
- Never swallow errors silently — log then rethrow or handle explicitly

## Commands
- `npm run trade` — full run
- `npm run trade:dry` — dry run (no DB writes)
- `npm run build` — compile to dist/
- `npx tsc --noEmit` — type-check only
