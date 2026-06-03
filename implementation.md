# Implementation Guide — AI Trader

> Full design rationale in `plan.md`. This file is the build checklist.
> Work phase-by-phase. Each phase is independently testable before moving on.
> **Rule:** agents and orchestrator import only from `src/llm`, `src/data`, `src/research`, `src/db`, `src/engine` — never from provider libraries directly.

---

## Phase 0 — Scaffold

**Goal:** repo compiles, config loads, schema ready.

- [ ] `package.json` — name `ai-trader`, `"type": "module"`, scripts: `trade`, `trade:dry`, `build`
- [ ] Dependencies:
  ```
  @strands-agents/sdk
  @supabase/supabase-js
  yahoo-finance2
  technicalindicators
  rss-parser
  cheerio
  robots-parser
  zod
  ```
  Dev: `typescript`, `tsx`, `@types/node`
- [ ] `tsconfig.json` — `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `outDir: dist`
- [ ] `config.json`:
  ```json
  {
    "llmProvider": "azure",
    "topN": 5,
    "maxCandidates": 15,
    "startingCapital": 100000,
    "maxPositionPct": 0.20,
    "maxPositions": 8,
    "stopLossPct": 0.07,
    "rssFeedUrls": [
      "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
      "https://www.moneycontrol.com/rss/buzzingstocks.xml",
      "https://feeds.feedburner.com/NSEBSE"
    ],
    "dryRun": false
  }
  ```
- [ ] `src/config/index.ts` — load + zod-validate `config.json` + env vars; export typed `Config` and `Env`
  - Env vars: `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`, `AZURE_OPENAI_API_VERSION`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- [ ] `.env.example` — all env var keys, no values
- [ ] `supabase/schema.sql`:
  ```sql
  create table portfolio (id serial primary key, cash numeric not null, starting_capital numeric not null, created_at timestamptz default now());
  create table positions (id serial primary key, symbol text not null, qty integer not null, avg_price numeric not null, opened_at date not null, status text default 'open');
  create table orders (id serial primary key, run_date date not null, symbol text not null, side text not null, qty integer not null, fill_price numeric, rationale text, confidence numeric, signals jsonb, created_at timestamptz default now());
  create table candidates (id serial primary key, run_date date not null, symbol text not null, consensus text, target_price numeric, source_count integer, macro_flags jsonb, selected boolean default false);
  create table daily_pnl (id serial primary key, run_date date not null unique, portfolio_value numeric, cash numeric, realized_pnl numeric, unrealized_pnl numeric, day_return_pct numeric, cum_return_pct numeric);
  ```
- [ ] Create Supabase Storage bucket `reports` (public read, service-key write)

**Verify:** `npx tsc --noEmit` passes; `config.json` loads without throwing.

---

## Phase 1 — Data Layer

**Goal:** fetch live quotes + indicators for any NSE symbol.

### Interfaces (`src/data/types.ts`)
```ts
export interface Quote { symbol: string; price: number; open: number; high: number; low: number; volume: number; date: string }
export interface OHLCV { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface Indicators { sma20: number; sma50: number; rsi14: number; macd: { value: number; signal: number; histogram: number }; volumeTrend: 'rising' | 'falling' | 'flat' }
export interface DataProvider { getQuote(symbol: string): Promise<Quote>; getOHLCV(symbol: string, days: number): Promise<OHLCV[]>; getIndicators(symbol: string): Promise<Indicators>; getTickerNews(symbol: string): Promise<string[]> }
```

### Files
- [ ] `src/data/types.ts` — interfaces above
- [ ] `src/data/providers/yahoo.ts` — implements `DataProvider` using `yahoo-finance2`
  - `getQuote`: `yahooFinance.quote(symbol)`
  - `getOHLCV`: `yahooFinance.historical(symbol, { period1, interval: '1d' })`
  - `getIndicators`: compute from OHLCV using `technicalindicators` (SMA, RSI, MACD); volumeTrend = avg last 5 vs avg prior 5
  - `getTickerNews`: `yahooFinance.quoteSummary(symbol, { modules: ['news'] })`
- [ ] `src/data/nse-symbols.json` — top 200 NSE symbols, format: `{ "Tata Steel": "TATASTEEL.NS", "Reliance": "RELIANCE.NS", ... }`
  - Include all Nifty 50 + Nifty Next 50 at minimum
- [ ] `src/data/tickerResolver.ts` — `resolveTicker(name: string): string | null`
  - Primary: fuzzy match against `nse-symbols.json` (lowercase, strip "Ltd"/"Limited")
  - Fallback: return `null` (agent fallback handled in orchestrator)
- [ ] `src/data/index.ts` — `createDataProvider(): DataProvider` factory (reads `config.dataProvider`, defaults to `yahoo`)

**Verify:** `npx tsx src/data/providers/yahoo.ts` logs quote + indicators for `TATAMOTORS.NS`.

---

## Phase 2 — Research Layer

**Goal:** fetch news headlines + RSS feeds; no API keys required.

### Interfaces (`src/research/types.ts`)
```ts
export interface NewsItem { title: string; source: string; url: string; publishedAt: string }
export interface ResearchProvider {
  getRssHeadlines(feedUrl: string): Promise<NewsItem[]>
  searchGoogleNews(query: string): Promise<NewsItem[]>
  fetchPage(url: string): Promise<string>  // polite, cached
}
```

### Files
- [ ] `src/research/types.ts` — interfaces above
- [ ] `src/research/providers/rss.ts` — implements `ResearchProvider`
  - `getRssHeadlines`: `rss-parser` parse feed URL, return last 20 items
  - `searchGoogleNews`: fetch `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en` via rss-parser
  - `fetchPage`: cheerio HTML fetch with:
    - Check `robots-parser` before fetching (skip if disallowed)
    - Rate-limit: max 1 req/sec, max 10 pages/run (in-memory counter)
    - In-memory cache keyed by URL (per-run only)
    - Return cleaned text (strip scripts/styles/nav)
- [ ] `src/research/index.ts` — `createResearchProvider(): ResearchProvider` factory

**Verify:** script logs 5 headlines from ET RSS and 3 from Google News for "Reliance Industries NSE".

---

## Phase 3 — DB Layer

**Goal:** read/write all Supabase tables; seed portfolio on first run.

### Interfaces (`src/db/types.ts`)
```ts
export interface PortfolioRepo { get(): Promise<{ cash: number; startingCapital: number }>; updateCash(cash: number): Promise<void> }
export interface PositionsRepo { getOpen(): Promise<Position[]>; upsert(p: Position): Promise<void>; close(symbol: string, closePrice: number): Promise<void> }
export interface OrdersRepo { insert(o: Order): Promise<void>; getByDate(date: string): Promise<Order[]> }
export interface CandidatesRepo { insertBatch(cs: Candidate[]): Promise<void> }
export interface PnlRepo { upsert(row: DailyPnl): Promise<void>; getAll(): Promise<DailyPnl[]> }
export interface StorageRepo { uploadReport(filename: string, html: string): Promise<string> }  // returns public URL
```

### Files
- [ ] `src/db/types.ts` — interfaces + `Position`, `Order`, `Candidate`, `DailyPnl` types
- [ ] `src/db/providers/supabase/client.ts` — singleton Supabase client from env
- [ ] `src/db/providers/supabase/portfolio.ts` — `PortfolioRepo` impl; `get()` seeds ₹1,00,000 if table empty
- [ ] `src/db/providers/supabase/positions.ts` — `PositionsRepo` impl
- [ ] `src/db/providers/supabase/orders.ts` — `OrdersRepo` impl
- [ ] `src/db/providers/supabase/candidates.ts` — `CandidatesRepo` impl
- [ ] `src/db/providers/supabase/pnl.ts` — `PnlRepo` impl; upsert on `run_date`
- [ ] `src/db/providers/supabase/storage.ts` — `StorageRepo` impl; upload to `reports/` bucket
- [ ] `src/db/index.ts` — `createDb(): { portfolio, positions, orders, candidates, pnl, storage }` factory

**Verify:** run seed script → Supabase `portfolio` table shows 1 row with `cash = 100000`.

---

## Phase 4 — Engine

**Goal:** risk gate + mock fill + mark-to-market + P&L; no agents involved.

### Interfaces (`src/engine/types.ts`)
```ts
export interface OrderIntent { symbol: string; side: 'BUY' | 'SELL'; qty: number; rationale: string; confidence: number; signals: Record<string, unknown> }
export interface FillResult { filled: boolean; fillPrice: number; reason?: string }
export interface BrokerAdapter { fill(order: OrderIntent, currentPrice: number): Promise<FillResult> }
```

### Files
- [ ] `src/engine/types.ts` — interfaces above
- [ ] `src/engine/riskGate.ts` — `applyRiskGate(intents, portfolio, positions, quotes, config)`:
  - Reject if BUY cost > available cash
  - Reject/clip if position would exceed `maxPositionPct`
  - Reject if `maxPositions` already open and no SELL to free slot
  - Never let cash go negative
  - Return `{ approved: OrderIntent[], rejected: { intent, reason }[] }`
- [ ] `src/engine/brokers/mock.ts` — `BrokerAdapter` impl; fills at `currentPrice`; no slippage
- [ ] `src/engine/fill.ts` — `fillOrders(approved, db, dataProvider, broker)`: fetch current price, call broker.fill, write to `orders` + update `positions` + update `cash`
- [ ] `src/engine/markToMarket.ts` — `markToMarket(db, dataProvider)`:
  - Fetch current price for each open position
  - Compute unrealized P&L
  - Auto-sell positions breaching `stopLossPct`
  - Return `{ unrealizedPnl, autoSells }`
- [ ] `src/engine/pnl.ts` — `computeDailyPnl(db, unrealizedPnl)`: sum realized fills today + unrealized, compute day% and cumulative% vs starting capital; upsert to `daily_pnl`
- [ ] `src/engine/index.ts` — `createEngine(config, db, dataProvider): Engine` factory

**Verify:** unit test — inject oversized order → rejected; inject valid BUY + cash update → cash decreases correctly; inject stop-loss breach → auto-sell fires.

---

## Phase 5 — LLM + Agents

**Goal:** all 5 agents emit valid structured output. Azure wiring verified.

### LLM Layer (`src/llm/`)
- [ ] `src/llm/types.ts`:
  ```ts
  import type { Agent } from '@strands-agents/sdk'
  export interface LLMProvider { getModel(role: 'quick' | 'deep'): ConstructorParameters<typeof Agent>[0]['model'] }
  ```
- [ ] `src/llm/providers/azure.ts`:
  ```ts
  import { OpenAIModel } from '@strands-agents/sdk/models/openai'
  // IMPORTANT: do NOT append /v1 — SDK adds it internally
  const model = new OpenAIModel({
    api: 'chat',
    apiKey: env.AZURE_OPENAI_API_KEY,
    clientConfig: {
      baseURL: `${env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${env.AZURE_OPENAI_DEPLOYMENT}`,
    },
    modelId: env.AZURE_OPENAI_DEPLOYMENT,
  })
  ```
- [ ] `src/llm/index.ts` — `createLLMProvider(config, env): LLMProvider` factory; switch on `config.llmProvider`

### Agent Tools (`src/agents/tools.ts`)
All tools use Strands `tool()` + zod input schemas. Each tool calls its layer adapter — never a provider directly.
- [ ] `getQuote` — calls `dataProvider.getQuote(symbol)`
- [ ] `getIndicators` — calls `dataProvider.getIndicators(symbol)`
- [ ] `getTickerNews` — calls `dataProvider.getTickerNews(symbol)`
- [ ] `getRssHeadlines` — calls `researchProvider.getRssHeadlines(feedUrl)`
- [ ] `searchGoogleNews` — calls `researchProvider.searchGoogleNews(query)`
- [ ] `resolveTicker` — calls `tickerResolver.resolveTicker(name)`
- [ ] `getPortfolio` — calls `db.portfolio.get()` + `db.positions.getOpen()`; READ-ONLY, no writes
- [ ] `placeOrder` — validates schema + appends to in-memory order queue (engine fills later; LLM cannot directly write DB)

### System Prompts (`src/agents/prompts/`)
- [ ] `shared.md` — "You only know what tools return. Never invent prices, balances, or quotes. If data is missing, say so and lower confidence. Always respond with valid JSON matching the schema."
- [ ] `discovery.md` — find stocks with genuine multi-source expert attention today via RSS + Google News; return `{ candidates: [{ name, reason, sources[] }] }`; avoid penny/illiquid stocks
- [ ] `technical.md` — given symbol, use getQuote + getIndicators; return `{ symbol, trend: 'bullish'|'bearish'|'neutral', momentum: string, keyLevels: string, confidence: number, evidence: string[] }`
- [ ] `consensus.md` — given symbol, use getTickerNews + getRssHeadlines + searchGoogleNews; aggregate opinions; return `{ symbol, recommendation: 'BUY'|'SELL'|'HOLD', targetPrice: number|null, consensusStrength: 'strong'|'moderate'|'weak', confidence: number, sourceCount: number, evidence: string[] }`
- [ ] `macro.md` — scan RSS + Google News for macro/sector signals (oil, rates, war, regulation); return `{ macroFlags: string[], sectorRisks: Record<string, 'high'|'medium'|'low'>, marketSentiment: 'bullish'|'bearish'|'neutral', confidence: number }`
- [ ] `portfolioManager.md` — given all analyst reports + current portfolio; require ≥2 corroborating signals to BUY; size by conviction within risk limits; return `{ orders: [{ symbol, side, qty, rationale, confidence, signals }], reasoning: string }`

### Role Agents (`src/agents/`)
Each agent: instantiate `Agent` from `@strands-agents/sdk` with role prompt + relevant tools + `llmProvider.getModel(role)`.
- [ ] `src/agents/discovery.ts` — tools: `getRssHeadlines`, `searchGoogleNews`; model: quick
- [ ] `src/agents/technical.ts` — tools: `getQuote`, `getIndicators`; model: quick
- [ ] `src/agents/consensus.ts` — tools: `getTickerNews`, `getRssHeadlines`, `searchGoogleNews`; model: quick
- [ ] `src/agents/macro.ts` — tools: `getRssHeadlines`, `searchGoogleNews`; model: quick
- [ ] `src/agents/portfolioManager.ts` — tools: `getPortfolio`, `placeOrder`; model: deep

**Verify:** spike script runs each agent individually on today's data; each returns valid JSON matching its schema.

---

## Phase 6 — Report Builder

**Goal:** generate self-contained HTML report, upload to Supabase Storage.

- [ ] `src/report/builder.ts` — `buildReport(runData): string` returns full HTML
  - Sections: run summary (date, market sentiment), candidates considered (table: symbol, consensus, technical, macro score, selected?), trades placed (table: symbol, side, qty, fill price, rationale), P&L (day + cumulative chart using inline SVG or ASCII), open positions
  - Self-contained: inline CSS, no external deps
  - `<meta charset="utf-8">` + mobile-friendly viewport
- [ ] `src/report/uploader.ts` — `uploadReport(html, db): Promise<string>` — filename `reports/YYYY-MM-DD.html`; returns public URL
- [ ] `src/report/index.ts` — export `{ buildReport, uploadReport }`

**Verify:** run builder with mock data → open HTML in browser → readable, no broken styles.

---

## Phase 7 — Orchestrator

**Goal:** full pipeline wired in `src/index.ts`; `--dry-run` skips DB writes.

```
src/index.ts flow:
1. loadConfig() + loadEnv()
2. createDb(), createDataProvider(), createResearchProvider(), createLLMProvider(), createEngine()
3. portfolio = db.portfolio.get()  [seeds ₹1L if first run]
4. discoveryResult = await discoveryAgent.run(rssFeeds)
5. candidates = resolveCandidates(discoveryResult)  [static map + drop unresolved; cap at maxCandidates]
6. for each candidate (parallel, max 5 concurrent):
     technical = await technicalAgent.run(symbol)
     consensus = await consensusAgent.run(symbol)
   macro = await macroAgent.run()  [once, not per-candidate]
7. orders = await portfolioManagerAgent.run({ candidates, technical[], consensus[], macro, portfolio })
8. { approved, rejected } = riskGate.applyRiskGate(orders, ...)
9. if !dryRun: fillOrders(approved, ...)
10. if !dryRun: markToMarket(...)
11. if !dryRun: computeDailyPnl(...)
12. if !dryRun: db.candidates.insertBatch(candidates with selected flag)
13. html = buildReport(runData)
14. if !dryRun: uploadReport(html, db)
15. console.log summary
```

- [ ] `src/index.ts` — implement flow above; `--dry-run` flag skips steps 9–12, 14
- [ ] `package.json` scripts:
  - `"trade": "tsx src/index.ts"`
  - `"trade:dry": "tsx src/index.ts --dry-run"`

**Verify:**
1. `npm run trade:dry` — completes without DB writes, prints candidate list + proposed orders
2. `npm run trade` — Supabase shows `candidates`, `orders`, `positions`, `daily_pnl` rows; `reports/YYYY-MM-DD.html` in Storage

---

## Phase 8 — GitHub Actions Cron

**Goal:** daily automated run at 16:00 IST (10:30 UTC).

- [ ] `.github/workflows/daily-trade.yml`:
  ```yaml
  name: Daily Trade
  on:
    schedule:
      - cron: '30 10 * * 1-5'  # 16:00 IST Mon-Fri; edit this line to change time
    workflow_dispatch:
  jobs:
    trade:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: '20', cache: 'npm' }
        - run: npm ci
        - run: npm run trade
          env:
            AZURE_OPENAI_API_KEY: ${{ secrets.AZURE_OPENAI_API_KEY }}
            AZURE_OPENAI_ENDPOINT: ${{ secrets.AZURE_OPENAI_ENDPOINT }}
            AZURE_OPENAI_DEPLOYMENT: ${{ secrets.AZURE_OPENAI_DEPLOYMENT }}
            AZURE_OPENAI_API_VERSION: ${{ secrets.AZURE_OPENAI_API_VERSION }}
            SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
            SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
  ```
- [ ] Add all 6 secrets to GitHub repo Settings → Secrets

**Verify:** trigger via `workflow_dispatch` → green run → same Supabase artifacts as local. Then enable the schedule.

---

## Adapter Swap Reference

When swapping any layer, only touch the provider file + `config.json`. Zero agent changes.

| Want to swap | Change `config.json` | Create / swap file |
|---|---|---|
| LLM to Bedrock | `"llmProvider": "bedrock"` | `src/llm/providers/bedrock.ts` |
| Price data | `"dataProvider": "polygon"` | `src/data/providers/polygon.ts` |
| DB to SQLite (local dev) | `"dbProvider": "sqlite"` | `src/db/providers/sqlite/` |
| Broker to real | `"brokerAdapter": "angelone"` | `src/engine/brokers/angelone.ts` |

---

## Definition of Done

- [ ] `npm run trade:dry` completes without errors on a weekday
- [ ] `npm run trade` populates all 5 Supabase tables
- [ ] HTML report viewable from Supabase Storage URL
- [ ] Risk gate unit tests: oversized order rejected, cash never negative
- [ ] GitHub Actions `workflow_dispatch` green
- [ ] Daily `schedule` enabled
