/**
 * Yahoo Finance DataProvider
 *
 * All data is fetched via the Yahoo Finance v8 chart API and v1 search API
 * — these endpoints do not require a crumb/cookie and are reliably available.
 *
 * The chart `meta` object contains live quote fields (price, open, high, low,
 * volume), so we use it for both getQuote() and getOHLCV().
 *
 * yahoo-finance2 v2.14.x only ships `quote` and `autoc` modules (the crumb-
 * gated endpoints) — we avoid those to prevent 429 rate-limit failures.
 */
import { SMA, RSI, MACD } from 'technicalindicators'
import { z } from 'zod'
import { logger } from '../../config/logger.js'
import type { DataProvider, Quote, OHLCV, Indicators } from '../types.js'

// ---------------------------------------------------------------------------
// Yahoo Finance API base URLs — query1 is primary, query2 is fallback
// ---------------------------------------------------------------------------
const YF_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']

// ---------------------------------------------------------------------------
// Zod schemas — validate at the external boundary
// ---------------------------------------------------------------------------

const ChartMetaSchema = z.object({
  symbol: z.string(),
  regularMarketPrice: z.number(),
  regularMarketOpen: z.number().optional(),
  regularMarketDayHigh: z.number().optional(),
  regularMarketDayLow: z.number().optional(),
  regularMarketVolume: z.number().optional(),
  regularMarketTime: z.number().optional(),
})

const ChartResultSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: ChartMetaSchema,
          timestamp: z.array(z.number()).optional(),
          indicators: z
            .object({
              quote: z.array(
                z.object({
                  open: z.array(z.number().nullable()),
                  high: z.array(z.number().nullable()),
                  low: z.array(z.number().nullable()),
                  close: z.array(z.number().nullable()),
                  volume: z.array(z.number().nullable()),
                }),
              ),
            })
            .optional(),
        }),
      )
      .nullable(),
    error: z
      .object({ code: z.string(), description: z.string() })
      .nullable()
      .optional(),
  }),
})

const SearchNewsSchema = z.object({
  news: z
    .array(z.object({ title: z.string() }).passthrough())
    .optional(),
})

// ---------------------------------------------------------------------------
// Retry helper — 3 attempts, exponential backoff (100ms → 200ms → 400ms)
// ---------------------------------------------------------------------------

const TRANSIENT_PATTERNS = ['ECONNRESET', 'ETIMEDOUT', 'fetch failed', '502', '503', '504']

function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return TRANSIENT_PATTERNS.some((p) => err.message.includes(p))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  op: string,
  symbol: string,
): Promise<T> {
  const delays = [100, 200, 400]
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (!isTransient(err) || attempt === 2) break
      logger.warn({ op, symbol, attempt: attempt + 1, err }, 'transient error — retrying')
      await new Promise((res) => setTimeout(res, delays[attempt]))
    }
  }
  logger.error({ op, symbol, err: lastErr }, `${op} failed after retries`)
  throw new Error(
    `${op}(${symbol}) failed: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  )
}

// ---------------------------------------------------------------------------
// Low-level chart fetch — tries both query hosts
// ---------------------------------------------------------------------------

async function fetchChart(symbol: string, range: string): Promise<z.infer<typeof ChartResultSchema>> {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`

  let lastErr: unknown
  for (const host of YF_HOSTS) {
    try {
      const resp = await fetch(`https://${host}${path}`, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${resp.statusText}`)
      }
      const json: unknown = await resp.json()
      const parsed = ChartResultSchema.safeParse(json)
      if (!parsed.success) {
        throw new Error(`schema mismatch: ${parsed.error.message}`)
      }
      if (parsed.data.chart.error) {
        const { code, description } = parsed.data.chart.error
        throw new Error(`Yahoo error ${code}: ${description}`)
      }
      return parsed.data
    } catch (err) {
      lastErr = err
      // try the other host
    }
  }
  throw lastErr
}

// ---------------------------------------------------------------------------
// Public DataProvider factory
// ---------------------------------------------------------------------------

export function createYahooProvider(): DataProvider {
  // -------------------------------------------------------------------------
  // getQuote — uses chart meta for live price (no crumb needed)
  // -------------------------------------------------------------------------
  async function getQuote(symbol: string): Promise<Quote> {
    const op = 'getQuote'
    const t0 = Date.now()
    logger.debug({ op, symbol }, 'fetching quote')

    const data = await withRetry(() => fetchChart(symbol, '1d'), op, symbol)
    const result = data.chart.result
    if (!result || result.length === 0) {
      throw new Error(`${op}(${symbol}): no chart result returned`)
    }
    const meta = result[0].meta
    const price = meta.regularMarketPrice
    const open = meta.regularMarketOpen ?? price
    const high = meta.regularMarketDayHigh ?? price
    const low = meta.regularMarketDayLow ?? price
    const volume = meta.regularMarketVolume ?? 0
    const date = meta.regularMarketTime
      ? new Date(meta.regularMarketTime * 1000).toISOString().split('T')[0]
      : new Date().toISOString().split('T')[0]

    const quote: Quote = { symbol, price, open, high, low, volume, date }
    logger.info({ op, symbol, ms: Date.now() - t0, price }, 'quote fetched')
    return quote
  }

  // -------------------------------------------------------------------------
  // getOHLCV — historical daily bars from chart API
  // -------------------------------------------------------------------------
  async function getOHLCV(symbol: string, days: number): Promise<OHLCV[]> {
    const op = 'getOHLCV'
    const t0 = Date.now()
    logger.debug({ op, symbol, days }, 'fetching OHLCV')

    // Map days → Yahoo range string
    const range = days <= 5 ? '5d' : days <= 30 ? '1mo' : days <= 60 ? '3mo' : '6mo'
    const data = await withRetry(() => fetchChart(symbol, range), op, symbol)

    const result = data.chart.result
    if (!result || result.length === 0) {
      throw new Error(`${op}(${symbol}): no chart result returned`)
    }

    const { timestamp, indicators } = result[0]
    if (!timestamp || !indicators?.quote?.[0]) {
      // No historical bars — return empty (e.g. market closed, weekend)
      logger.warn({ op, symbol }, 'no OHLCV bars in response')
      return []
    }

    const q = indicators.quote[0]
    const rows: OHLCV[] = []
    for (let i = 0; i < timestamp.length; i++) {
      const close = q.close[i]
      if (close == null) continue
      rows.push({
        date: new Date(timestamp[i] * 1000).toISOString().split('T')[0],
        open: q.open[i] ?? close,
        high: q.high[i] ?? close,
        low: q.low[i] ?? close,
        close,
        volume: q.volume[i] ?? 0,
      })
    }

    logger.info({ op, symbol, days, rows: rows.length, ms: Date.now() - t0 }, 'OHLCV fetched')
    return rows
  }

  // -------------------------------------------------------------------------
  // getIndicators — SMA20/50, RSI14, MACD, volumeTrend from 60-day OHLCV
  // -------------------------------------------------------------------------
  async function getIndicators(symbol: string): Promise<Indicators> {
    const op = 'getIndicators'
    const t0 = Date.now()
    logger.debug({ op, symbol }, 'computing indicators')

    const ohlcv = await getOHLCV(symbol, 60)
    if (ohlcv.length < 26) {
      throw new Error(`${op}(${symbol}): insufficient data (${ohlcv.length} rows, need ≥26)`)
    }

    const closes = ohlcv.map((r) => r.close)
    const volumes = ohlcv.map((r) => r.volume)

    const smaArr20 = SMA.calculate({ period: 20, values: closes })
    const smaArr50 = SMA.calculate({ period: 50, values: closes })
    const rsiArr = RSI.calculate({ period: 14, values: closes })
    const macdArr = MACD.calculate({
      fastPeriod: 12,
      slowPeriod: 26,
      signalPeriod: 9,
      values: closes,
      SimpleMAOscillator: false,
      SimpleMASignal: false,
    })

    const sma20 = smaArr20.at(-1)
    const sma50 = smaArr50.at(-1)
    const rsi14 = rsiArr.at(-1)
    const macdLast = macdArr.at(-1)

    if (sma20 == null || sma50 == null || rsi14 == null || macdLast == null) {
      throw new Error(
        `${op}(${symbol}): indicator calculation returned empty — not enough data (${closes.length} bars)`,
      )
    }

    // volumeTrend: avg of last 5 vs prior 5 — >10% change = rising/falling
    const last5 = volumes.slice(-5)
    const prior5 = volumes.slice(-10, -5)
    const avgLast = last5.reduce((a, b) => a + b, 0) / last5.length
    const avgPrior =
      prior5.length > 0
        ? prior5.reduce((a, b) => a + b, 0) / prior5.length
        : avgLast

    let volumeTrend: 'rising' | 'falling' | 'flat'
    if (avgPrior === 0) {
      volumeTrend = 'flat'
    } else if (avgLast > avgPrior * 1.1) {
      volumeTrend = 'rising'
    } else if (avgLast < avgPrior * 0.9) {
      volumeTrend = 'falling'
    } else {
      volumeTrend = 'flat'
    }

    const indicators: Indicators = {
      sma20,
      sma50,
      rsi14,
      macd: {
        value: macdLast.MACD ?? 0,
        signal: macdLast.signal ?? 0,
        histogram: macdLast.histogram ?? 0,
      },
      volumeTrend,
    }

    logger.info({ op, symbol, ms: Date.now() - t0, volumeTrend }, 'indicators computed')
    return indicators
  }

  // -------------------------------------------------------------------------
  // getTickerNews — Yahoo Finance v1 search endpoint
  // -------------------------------------------------------------------------
  async function getTickerNews(symbol: string): Promise<string[]> {
    const op = 'getTickerNews'
    const t0 = Date.now()
    logger.debug({ op, symbol }, 'fetching ticker news')

    const titles = await withRetry(async () => {
      const url =
        `https://query1.finance.yahoo.com/v1/finance/search` +
        `?q=${encodeURIComponent(symbol)}&newsCount=10&quotesCount=0`
      const resp = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
      })
      if (!resp.ok) throw new Error(`news API HTTP ${resp.status}`)
      const json: unknown = await resp.json()
      const parsed = SearchNewsSchema.safeParse(json)
      if (!parsed.success) throw new Error(`news schema mismatch: ${parsed.error.message}`)
      return (parsed.data.news ?? []).map((item) => item.title)
    }, op, symbol)

    logger.info({ op, symbol, count: titles.length, ms: Date.now() - t0 }, 'ticker news fetched')
    return titles
  }

  return { getQuote, getOHLCV, getIndicators, getTickerNews }
}
