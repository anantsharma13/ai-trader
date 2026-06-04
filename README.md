# ai-trader

Autonomous Indian-market paper-trading system. Runs daily via GitHub Actions — no real money, no UI.

**Pipeline:** RSS/news scan → technical analysis → macro check → consensus → order intents → mock fills → HTML report in Supabase Storage.

---

## Project structure

```
src/
  config/       env + config.json validation (zod), pino logger
  data/         Yahoo Finance v8 API, technical indicators, NSE ticker resolver
  research/     RSS feeds, Google News scraper, polite fetchPage
  db/           Supabase repos: portfolio, positions, orders, candidates, pnl, storage
  engine/       risk gate, mock broker fill, mark-to-market, daily P&L
  llm/          Azure OpenAI adapter (provider-agnostic interface)
  agents/       5 Strands agents: discovery, technical, macro, consensus, portfolioManager
  report/       HTML report builder + Supabase Storage uploader
  index.ts      orchestrator — wires all layers, runs the pipeline

.github/workflows/daily-trade.yml   cron: 16:00 IST Mon–Fri
supabase/schema.sql                 DB schema (run once to initialise)
config.json                         tunables (topN, risk limits, RSS URLs)
```

---

## Local setup

**Prerequisites:** Node.js 20+, a Supabase project, an Azure OpenAI deployment.

```bash
git clone https://github.com/anantsharma13/ai-trader
cd ai-trader
npm install
cp .env.example .env   # fill in your secrets
```

**.env values:**
```
AZURE_OPENAI_API_KEY=
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o
AZURE_OPENAI_API_VERSION=2024-02-01
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_KEY=<service-role key>
LOG_LEVEL=info
NODE_ENV=development
```

**Initialise the database** (run once in Supabase SQL editor):
```sql
-- paste contents of supabase/schema.sql
```

**Create storage bucket** (in Supabase Storage dashboard):
- Bucket name: `ai-trading-reports`
- Public bucket: Yes (for HTML report access)

---

## Running locally

```bash
# dry run — no DB writes, logs what would happen
npm run trade:dry

# full run — writes orders, positions, P&L to Supabase
npm run trade

# type-check only
npx tsc --noEmit
```

---

## GitHub Actions setup

1. Push to GitHub (already done if you cloned this repo).
2. Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret | Value |
|---|---|
| `AZURE_OPENAI_API_KEY` | Azure key |
| `AZURE_OPENAI_ENDPOINT` | e.g. `https://myresource.openai.azure.com` |
| `AZURE_OPENAI_DEPLOYMENT` | deployment name, e.g. `gpt-4o` |
| `AZURE_OPENAI_API_VERSION` | e.g. `2024-02-01` |
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_KEY` | service-role key |

3. The workflow (`.github/workflows/daily-trade.yml`) triggers automatically at **16:00 IST (10:30 UTC) Mon–Fri**.
4. To test manually: **Actions → Daily Trade → Run workflow**.

A failed run (non-zero exit) marks the Actions job red — check logs for the step that threw.

---

## Tuning

Edit `config.json` — no code changes needed:

| Key | Default | Meaning |
|---|---|---|
| `topN` | 5 | max stocks to trade per day |
| `maxCandidates` | 15 | discovery pool size |
| `maxPositionPct` | 0.20 | max portfolio % per position |
| `maxPositions` | 8 | max concurrent open positions |
| `stopLossPct` | 0.07 | auto-sell trigger (7% loss) |
| `rssFeedUrls` | 3 ET/Moneycontrol feeds | news sources |
