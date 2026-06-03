# Plan: Autonomous Indian-Market Paper-Trading AI Agent (Multi-Agent)

## Context

**Problem / need.** You want to test whether an AI agent can pick Indian equities profitably *before* risking real capital. The agent must run itself daily, **discover which stocks experts are recommending**, reason over expert-consensus + technicals + macro/news, place "mock" orders into a database, and produce a reasoned daily P&L report. Once it consistently profits on real market data, you'd graduate to a real broker account.

**Hard constraints (from you).**
- **Least infra.** Daily cron on **GitHub Actions** (free, no servers). Configurable schedule.
- **Fully autonomous.** No human approval in the loop.
- **Intelligent, multi-agent** design via **AWS Strands Agents (TypeScript SDK)** — chosen for future AWS/Bedrock migration.
- **Node.js / TypeScript** codebase. **Azure OpenAI** as the LLM.
- **Dynamic universe** — *no fixed Nifty/name lock*. The agent explores the market, finds what experts recommend, and picks the **top 5 bets** (configurable N).
- **Expert-consensus engine** — gather ~10–20 opinions per candidate, find the common recommendation pattern, decide with confidence.
- **Macro/news factor** — war, oil, rates, sector shocks feed the decision.
- **Everything reasoned** — every order carries an auditable rationale; report explains the market pattern behind the P&L.
- **Data sourcing (legal-safe).** yahoo-finance2 quotes + official RSS + free news API + agent web-search of public pages. Plus a **polite, once-daily, robots-respecting `fetchPage`** for specific-stock comparison (low-volume, personal-use, no redistribution). **No aggressive scraping.**
- **Supabase free tier** as the "broker": Postgres holds mock orders/positions/P&L; Storage holds the daily report.
- Start: **₹1,00,000 virtual capital, swing/positional (end-of-day) trading**, report to **Supabase Storage only**.

**Real-time note.** A daily cron is one batch per run, so "real-time" = the latest quote available at run time (yahoo-finance2 ~15-min delay — fine for EOD swing). Run near market close to capture the day. True intraday streaming needs always-on infra — out of "least infra" scope.

**Intended outcome.** One repo that, once per trading day, autonomously discovers expert-favored stocks, runs a multi-agent trading-firm analysis, places risk-bounded mock orders into Supabase, marks the book to market, and uploads a reasoned daily report — zero manual steps.

---

## Stack Decisions (resolved)

| Concern | Choice | Why |
|---|---|---|
| Language/runtime | TypeScript on Node 20+ | Your requirement |
| Agent framework | `@strands-agents/sdk` (TS, v1.0) | AWS-native; supports multi-agent orchestration; rides on Vercel AI SDK providers |
| LLM | **Provider-agnostic** via `src/llm/` adapter layer. Default: Azure OpenAI (`OpenAIModel`). Swap to Bedrock/Anthropic/local by changing one config value — agents never import a provider directly. |
| Price data | `yahoo-finance2` (npm), `.NS` tickers | Free, no auth, quote + EOD OHLCV |
| Indicators | `technicalindicators` (npm) | SMA/EMA/RSI/MACD without hand-rolling |
| News / sentiment | RSS feeds (ET, Moneycontrol, NSE) + Google News RSS + `yahoo-finance2` per-ticker news — zero API keys | No auth required |
| On-demand pages | Polite `fetchPage` (cheerio + `robots-parser`, rate-limited) | Once-daily, specific stocks, personal use, low risk |
| Mock broker / state | Supabase Postgres (`@supabase/supabase-js`) | Free 500MB; daily cron prevents 7-day idle pause |
| Reports | Supabase Storage bucket (HTML) | Free 1GB; single file, rich view |
| Schedule | GitHub Actions `schedule` + `workflow_dispatch` | Free, serverless, configurable |
| Config / validation | `config.json` + `zod` | One file to tune topN/capital/risk/sources |

**LLM abstraction (`src/llm/`):**

```ts
// src/llm/types.ts — provider-agnostic interface
export interface LLMProvider { getModel(role: 'quick' | 'deep'): unknown }

// src/llm/index.ts — factory reads config.llmProvider
export function createProvider(): LLMProvider { ... }

// src/llm/providers/azure.ts — current default
import { OpenAIModel } from '@strands-agents/sdk/models/openai'
// Azure: baseURL = resource root only — Strands SDK appends /v1 internally (do NOT add /v1 yourself)
baseURL: `${AZURE_ENDPOINT}/openai/deployments/${DEPLOYMENT}`

// src/llm/providers/bedrock.ts   — swap-in (future)
// src/llm/providers/anthropic.ts — swap-in (future)
```

Agents import from `src/llm/` only — zero provider coupling in agent code. Swap provider via `config.json` `llmProvider` field. Optionally configure **quick** (discovery/summarization) vs **deep** (Portfolio Manager) models; single deployment also works.

---

## Adapter Pattern — Everything Replaceable

Every external dependency lives behind an interface. Swap by changing `config.json` + one adapter file; zero agent or orchestrator changes.

| Layer | Interface in | Current adapter | Swap-in options |
|---|---|---|---|
| LLM | `src/llm/types.ts` | Azure OpenAI | Bedrock, Anthropic, Ollama, any Strands provider |
| Price data | `src/data/types.ts` | `yahoo-finance2` | NSEpy, Polygon.io, Alpha Vantage, Tiingo |
| Indicators | `src/data/types.ts` | `technicalindicators` | `tulind`, hand-rolled, TA-Lib WASM |
| News/research | `src/research/types.ts` | RSS + free news API | Finnhub, Bloomberg RSS, any feed |
| On-demand pages | `src/research/types.ts` | polite `fetchPage` (cheerio) | disable entirely, replace with paid scraper |
| State / DB | `src/db/types.ts` | Supabase Postgres | any Postgres, SQLite (local dev), PlanetScale |
| File storage | `src/db/types.ts` | Supabase Storage | S3, R2, local filesystem |
| Broker / fill | `src/engine/types.ts` | mock fill | Angel One SmartAPI, Upstox, Zerodha Kite |
| Scheduler | `.github/workflows/` | GitHub Actions cron | any cron, Supabase pg_cron (triggers only), local |

**Rule:** agents and the orchestrator `import` only from `src/llm`, `src/data`, `src/research`, `src/db`, `src/engine` — never from a provider library directly.

---

## Prior Art & References

Validated against existing solutions before finalizing this design:

- **TradingAgents** ([github.com/TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents), arXiv 2412.20138) — LangGraph, 7 specialist nodes. Key borrow: **Bull/Bear researcher debate** before the PM acts (forces explicit bearish counterargument). Optional future agent: add a `bearResearcher.ts` that argues against each candidate; PM must rebut or lower confidence.
- **ATLAS** (arXiv 2510.15949) — validates our multi-analyst-to-single-trader topology. Introduces **Adaptive-OPRO**: system rewrites its own prompts based on real P&L feedback. Deferred to post-launch; `prompts/` versioning makes this drop-in.
- **FinRobot** ([github.com/AI4Finance-Foundation/FinRobot](https://github.com/AI4Finance-Foundation/FinRobot)) — four-layer LLM + RL + quantitative pipeline. Validates tool-augmented agent pattern.
- **Vibe Trading** — open-source, closest Indian market match (NSE/BSE, 7 LLM analyst agents, LangGraph). Reference for prompt structure and Indian data sources.
- **Alpaca** ([alpaca.markets](https://alpaca.markets)) — best-in-class paper trading API + MCP server. If Supabase mock proves limiting, Alpaca's paper account is a direct swap behind the broker adapter.
- **Gap confirmed:** no existing project combines NSE + multi-agent expert-consensus + Node.js + GitHub Actions free tier. This is the niche.

---

## Multi-Agent Architecture (sequential "trading firm")

Grounded in the TradingAgents framework (arXiv 2412.20138) and LLM-trading best practices (ATLAS). **Sequential pipeline**, not free-form debate — cheaper, deterministic, auditable.

**Core principles baked in:**
- **Portfolio state is READ-ONLY to the LLM.** Cash/positions/P&L live in Supabase, exposed only via tools. Agents never "remember" balances → kills the #1 hallucination class.
- **Order-aware outputs.** Agents emit executable orders (`{symbol, side, qty, rationale, confidence}`); the engine validates + fills.
- **Confidence-weighted consensus.** Each analyst returns a structured report with a confidence score; the PM weighs accordingly.
- **Auditable.** Every order stores its rationale + which signals drove it.

### Daily run stages (`src/index.ts` orchestrator)

1. **Load config + portfolio state** from Supabase (seed ₹1L on first run).
2. **Discovery / Screener agent** (quick model). Scans the market for what experts are recommending today — pulls from RSS feeds + news API + agent web-search of public analyst/screener pages. Output: **candidate list** (~10–20 stock names + raw opinions/headlines).
3. **Ticker resolution.** Map candidate names → NSE `.NS` symbols via **static seed map first** (`src/data/nse-symbols.json`, top 200 NSE stocks), agent fallback only for unknowns; drop unresolved. Static map prevents hallucinated tickers (e.g. "Tata Steel" → wrong symbol) causing silent bad fills.
4. **Per-candidate analysis** — three specialist agents produce structured reports:
   - **Technical Analyst** — `yahoo-finance2` quote/OHLCV + indicators (SMA20/50, RSI14, MACD, volume trend) → trend/momentum read.
   - **Expert-Consensus Analyst** — aggregates ~10–20 opinions (news API + RSS + on-demand `fetchPage` of specific comparison pages) → `{recommendation, targetPrice, consensusStrength, confidence, sourceCount}`.
   - **News/Macro Analyst** — scans macro + sector headlines (war, oil, rates, regulation) → event flags + sector risk score affecting each candidate.
5. **Portfolio-Manager agent** (deep model). Synthesizes the three reports per candidate + current book → ranks candidates → selects **top N=5 bets**, sizes positions within cash + risk limits, and reviews existing positions for SELL/HOLD. Emits orders with reasoning.
6. **Risk gate (code, not LLM).** Enforces: no leverage (≤ available cash), `maxPositionPct` per symbol, `maxPositions` open, optional `stopLossPct`. Clips/rejects violating orders.
7. **Execution engine.** Mock-fills surviving orders at current quote/close, updates `orders` + `positions` + `cash` in Supabase, computes realized P&L.
8. **Mark-to-market** all open positions → unrealized P&L; apply stop-loss auto-sells.
9. **Report builder.** Daily `.html`: styled, self-contained — candidates considered, consensus pattern per pick, macro factors, trades + rationale, day & cumulative P&L vs ₹1L → upload to Supabase Storage. Directly viewable from browser.

To bound cost on a dynamic universe: discovery is a cheap scan that narrows the field; deep analysis runs only on candidates; PM picks 5. Cap candidates via `maxCandidates` config.

### Agent tools (Strands `tool()` + zod schemas)
- `getQuote(symbol)` / `getIndicators(symbol)` — yahoo-finance2 + technicalindicators.
- `searchNews(query)` / `getRssHeadlines(feed)` — news API + RSS.
- `fetchPage(url)` — polite, robots-respecting, rate-limited, cached, on-demand page read for specific-stock comparison.
- `resolveTicker(name)` — name → NSE symbol.
- `getPortfolio()` — read-only cash/positions/unrealized P&L.
- `placeOrder({symbol, side, qty, rationale, confidence})` — records intent for engine validation+fill.

---

## Supabase Schema (`supabase/schema.sql`)

- **`portfolio`** — `id`, `cash`, `starting_capital`, `created_at`.
- **`positions`** — `symbol`, `qty`, `avg_price`, `opened_at`, `status`.
- **`orders`** — `id`, `run_date`, `symbol`, `side`, `qty`, `fill_price`, `rationale`, `confidence`, `signals` (jsonb: technical/consensus/macro), `created_at`.
- **`candidates`** — `run_date`, `symbol`, `consensus`, `target_price`, `source_count`, `macro_flags`, `selected` (bool). Audit of what was considered.
- **`daily_pnl`** — `id serial` (PK), `run_date` (unique index), `portfolio_value`, `cash`, `realized_pnl`, `unrealized_pnl`, `day_return_pct`, `cum_return_pct`. Upsert on `run_date` so re-runs same day overwrite cleanly.
- **Storage bucket** `reports/` — daily `.html` (styled, self-contained, directly viewable).

---

## Project Structure

```
my-project/
├─ src/
│  ├─ config/        # load + zod-validate config.json, env
│  ├─ llm/           # LLM abstraction: provider interface + adapters (Azure OpenAI, Bedrock, Anthropic, …)
│  ├─ data/          # yahoo-finance2 client + indicators + ticker resolution + nse-symbols.json (top 200 static map)
│  ├─ research/      # rss-parser, news API client, polite fetchPage (cheerio + robots)
│  ├─ db/            # supabase client + repos (portfolio, positions, orders, candidates, pnl)
│  ├─ agents/        # strands setup + role agents:
│  │   ├─ discovery.ts        # screener / candidate finder
│  │   ├─ technical.ts        # technical analyst
│  │   ├─ consensus.ts        # expert-consensus analyst
│  │   ├─ macro.ts            # news/macro analyst
│  │   ├─ portfolioManager.ts # decision agent
│  │   ├─ tools.ts            # shared tool defs (zod)
│  │   └─ prompts/            # versioned system prompts per role
│  ├─ engine/        # risk gate, order fill, mark-to-market, P&L
│  ├─ report/        # HTML builder + Storage upload
│  └─ index.ts       # daily orchestrator (cron entrypoint)
├─ .github/workflows/daily-trade.yml
├─ supabase/schema.sql
├─ config.json       # topN=5, maxCandidates=15, capital, risk limits, sources, dry-run
├─ .env.example  /  package.json  /  tsconfig.json  /  README.md
```

**GitHub Actions** (`daily-trade.yml`): `schedule` cron ~10:30 UTC (16:00 IST, post-close; comment notes how to change) + `workflow_dispatch`. Steps: checkout → setup-node → `npm ci` → `npm run trade`. Secrets: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

---

## System-Prompt Strategy (per role, versioned in `prompts/`)

- **Shared rules:** "You only know what tools return. Never invent prices, balances, or quotes. State confidence. If data is missing, say so and lower confidence." (read-only state + anti-hallucination)
- **Discovery:** find stocks with genuine multi-source expert attention today; return names + why; avoid penny/illiquid unless strong signal.
- **Each analyst:** narrow scope, structured JSON output with `confidence` and `evidence[]`; no trade decisions (separation of duties).
- **Portfolio Manager:** weigh the three reports by confidence; require ≥2 corroborating signals to BUY; size by conviction within risk limits; explain the *pattern* (e.g. "consensus BUY + bullish MACD, but oil spike caps energy exposure"). Output executable orders only.

---

## Build Phases (incremental, each independently testable)

- **Phase 0 — Scaffold.** package/tsconfig/deps, `config.json` + zod loader, `.env.example`, `supabase/schema.sql`.
- **Phase 1 — Data layer.** yahoo-finance2 quote/OHLCV + indicators + ticker resolution. Verify on Tata Motors (`TATAMOTORS.NS`).
- **Phase 2 — Research layer.** RSS parser, news API client, polite `fetchPage` (robots + rate-limit + cache). Verify headlines + one page fetch.
- **Phase 3 — DB layer.** Supabase repos; seed ₹1L. Verify rows in Supabase.
- **Phase 4 — Engine.** Risk gate + mock fill + mark-to-market + P&L. Verify with hardcoded orders (no agents).
- **Phase 5 — Agents.** Strands Azure wiring + tools + the 5 role agents + prompts. Verify each role emits valid structured output on a sample day.
- **Phase 6 — Report.** HTML builder + Storage upload. Verify file downloadable and viewable in browser.
- **Phase 7 — Orchestrator.** Wire full pipeline in `index.ts`; local `--dry-run` then real run.
- **Phase 8 — Cron.** GitHub Actions + secrets; test via `workflow_dispatch`, then enable schedule.
- **Phase 9 (future, real capital).** Swap mock fill for a real broker API (Angel One SmartAPI / Upstox — free) behind the same `engine` interface; no agent changes.

---

## Indian Platform Reference (future real-capital phase)

- **Broker APIs:** Angel One SmartAPI (free), Upstox (free), Zerodha Kite (₹2k/mo), Groww Trade API (₹499/mo), Dhan/5paisa (free), ICICI Breeze (free).
- **Signal/screener sources (read for consensus):** screener.in, Tickertape, Trendlyne, Moneycontrol, Economic Times — via RSS/news API/on-demand page read, not bulk scraping.
- **Data libs:** `yahoo-finance2` (JS, our pick); `nsepython`/`NSEpy` (Python alternatives).

Broker stays behind the `engine` interface so mock-fill → real order is a single adapter swap.

---

## Verification (end-to-end)

1. **Local dry run:** `npm run trade -- --dry-run` → discovery finds candidates, agents produce reports, PM picks ≤5, report builds, no DB writes.
2. **Local real run:** `npm run trade` → Supabase shows `candidates`, `orders`, `positions`, `daily_pnl`; `reports/<today>.html` in Storage, downloadable and viewable in browser; report explains each pick's reasoning + macro context.
3. **Guardrail test:** unit-test the engine with an oversized / over-cash / >maxPositions order → rejected or clipped; cash never negative.
4. **Polite-fetch test:** confirm `fetchPage` honors robots.txt, rate-limits, and caches within a run.
5. **CI run:** `workflow_dispatch` → green run, same Supabase artifacts. Then enable the daily `schedule`.
6. **Ongoing:** track `daily_pnl.cum_return_pct` over N trading days to judge readiness for real capital.

---

## Open / Deferred (not blocking build)

- Daily run time configurable (default 16:00 IST). Change the cron line in `daily-trade.yml`.
- Additional news sources (Finnhub, NewsAPI) available if RSS + yahoo-finance2 news proves insufficient — add `NEWS_API_KEY` secret then.
- Quick-vs-deep dual LLM deployment optional; start single, split if cost/latency warrants.
- Real-capital cutover criteria (target cumulative return / max drawdown) decided after observing simulated results.
- **Bull/Bear researcher** (from TradingAgents): add `src/agents/bearResearcher.ts` that argues against each candidate; PM must rebut or lower confidence. Drop-in — `prompts/` versioning ready.
- **Adaptive-OPRO** (from ATLAS): system rewrites its own prompts based on real P&L feedback. Drop-in after launch — `prompts/` are versioned files, swap is one file update.
- **`fetchPage`** deferred: start without it; add if RSS + news API consensus quality proves insufficient.
