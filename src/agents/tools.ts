import { tool } from '@strands-agents/sdk'
import { z } from 'zod'
import type { DataProvider } from '../data/index.js'
import { resolveTicker } from '../data/index.js'
import type { ResearchProvider } from '../research/index.js'
import type { Db } from '../db/index.js'

/**
 * Factory — builds all 8 shared agent tools wired to the given providers.
 * Returns a plain object so callers can spread subsets into each agent's tool list.
 */
export function createTools(
  dataProvider: DataProvider,
  researchProvider: ResearchProvider,
  db: Db,
) {
  const getQuoteTool = tool({
    name: 'get_quote',
    description: 'Fetch the latest market quote for an NSE ticker symbol (e.g. RELIANCE.NS)',
    inputSchema: z.object({ symbol: z.string() }),
    callback: async ({ symbol }: { symbol: string }) => {
      try {
        const quote = await dataProvider.getQuote(symbol)
        return JSON.stringify(quote)
      } catch (err) {
        return JSON.stringify({ error: `Failed to fetch quote for ${symbol}: ${String(err)}` })
      }
    },
  })

  const getHistoryTool = tool({
    name: 'get_history',
    description: 'Fetch OHLCV price history for an NSE ticker symbol over the last N days',
    inputSchema: z.object({
      symbol: z.string(),
      days: z.number().int().positive(),
    }),
    callback: async ({ symbol, days }: { symbol: string; days: number }) => {
      try {
        const history = await dataProvider.getOHLCV(symbol, days)
        return JSON.stringify(history)
      } catch (err) {
        return JSON.stringify({ error: `Failed to fetch history for ${symbol}: ${String(err)}` })
      }
    },
  })

  const getIndicatorsTool = tool({
    name: 'get_indicators',
    description: 'Fetch computed technical indicators (SMA20, SMA50, RSI14, MACD, volumeTrend) for an NSE ticker',
    inputSchema: z.object({ symbol: z.string() }),
    callback: async ({ symbol }: { symbol: string }) => {
      try {
        const indicators = await dataProvider.getIndicators(symbol)
        return JSON.stringify(indicators)
      } catch (err) {
        return JSON.stringify({ error: `Failed to fetch indicators for ${symbol}: ${String(err)}` })
      }
    },
  })

  const searchNewsTool = tool({
    name: 'search_news',
    description: 'Search Google News for recent articles matching the given query. Returns an array of NewsItem objects.',
    inputSchema: z.object({ query: z.string() }),
    callback: async ({ query }: { query: string }) => {
      try {
        const news = await researchProvider.searchGoogleNews(query)
        return JSON.stringify(news)
      } catch (err) {
        return JSON.stringify({ error: `Failed to search news for "${query}": ${String(err)}` })
      }
    },
  })

  const getRssHeadlinesTool = tool({
    name: 'get_rss_headlines',
    description: 'Fetch latest RSS feed headlines from configured Indian market news feeds. Returns an array of NewsItem objects.',
    inputSchema: z.object({ feedUrl: z.string() }),
    callback: async ({ feedUrl }: { feedUrl: string }) => {
      try {
        const headlines = await researchProvider.getRssHeadlines(feedUrl)
        return JSON.stringify(headlines)
      } catch (err) {
        return JSON.stringify({ error: `Failed to fetch RSS headlines from ${feedUrl}: ${String(err)}` })
      }
    },
  })

  const resolveTickerTool = tool({
    name: 'resolve_ticker',
    description: 'Resolve a company name to its NSE ticker symbol (e.g. "Reliance Industries" → "RELIANCE.NS"). Returns null if not found.',
    inputSchema: z.object({ name: z.string() }),
    callback: ({ name }: { name: string }) => {
      try {
        const ticker = resolveTicker(name)
        return JSON.stringify({ name, ticker })
      } catch (err) {
        return JSON.stringify({ error: `Failed to resolve ticker for "${name}": ${String(err)}` })
      }
    },
  })

  const getOpenPositionsTool = tool({
    name: 'get_open_positions',
    description: 'Retrieve all currently open positions from the paper-trading portfolio.',
    inputSchema: z.object({}),
    callback: async () => {
      try {
        const positions = await db.positions.getOpen()
        return JSON.stringify(positions)
      } catch (err) {
        return JSON.stringify({ error: `Failed to fetch open positions: ${String(err)}` })
      }
    },
  })

  const getPortfolioTool = tool({
    name: 'get_portfolio',
    description: 'Retrieve current portfolio summary including cash balance and starting capital.',
    inputSchema: z.object({}),
    callback: async () => {
      try {
        const portfolio = await db.portfolio.get()
        return JSON.stringify(portfolio)
      } catch (err) {
        return JSON.stringify({ error: `Failed to fetch portfolio: ${String(err)}` })
      }
    },
  })

  return {
    getQuoteTool,
    getHistoryTool,
    getIndicatorsTool,
    searchNewsTool,
    getRssHeadlinesTool,
    resolveTickerTool,
    getOpenPositionsTool,
    getPortfolioTool,
  }
}

export type AgentTools = ReturnType<typeof createTools>
