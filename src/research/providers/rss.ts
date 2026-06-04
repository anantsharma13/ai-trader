import Parser from 'rss-parser'
import { load } from 'cheerio'
// robots-parser CJS module — type declaration uses ambient module form, cast needed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import _robotsParserModule from 'robots-parser'
type RobotsParserFn = (url: string, robotstxt: string) => { isAllowed(url: string, ua?: string): boolean | undefined }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseRobots = (_robotsParserModule as any) as RobotsParserFn
import { logger } from '../../config/logger.js'
import type { NewsItem, ResearchProvider } from '../types.js'

// Module-level state for fetchPage rate-limiting and caching
const pageCache = new Map<string, string>()
let fetchCount = 0
let lastFetchTime = 0

const FETCH_PAGE_MAX = 10
const RATE_LIMIT_MS = 1000
const HTTP_TIMEOUT_MS = 10_000
const ROBOTS_TIMEOUT_MS = 5_000
const MAX_RETRIES = 3

async function withRetry<T>(
  op: string,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const isTransient =
        err instanceof Error &&
        (err.message.includes('ECONNRESET') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('ENOTFOUND') ||
          err.message.includes('fetch') ||
          err.message.includes('network') ||
          err.message.includes('timeout') ||
          (err as NodeJS.ErrnoException).code === 'UND_ERR_CONNECT_TIMEOUT')
      if (!isTransient) throw err
      const backoff = 100 * Math.pow(2, attempt) // 100ms, 200ms, 400ms
      logger.warn({ op, attempt, backoffMs: backoff }, 'transient error, retrying')
      await new Promise((resolve) => setTimeout(resolve, backoff))
    }
  }
  throw lastErr
}

export class RssResearchProvider implements ResearchProvider {
  private parser: Parser

  constructor() {
    this.parser = new Parser({
      requestOptions: { timeout: 10000 },
    })
  }

  async getRssHeadlines(feedUrl: string): Promise<NewsItem[]> {
    const start = Date.now()
    logger.info({ op: 'getRssHeadlines', feedUrl }, 'fetching RSS feed')

    try {
      const feed = await withRetry('getRssHeadlines', () =>
        this.parser.parseURL(feedUrl),
      )
      const items: NewsItem[] = (feed.items ?? [])
        .slice(0, 20)
        .map((item) => ({
          title: item.title ?? '',
          source: feed.title ?? feedUrl,
          url: item.link ?? '',
          publishedAt: item.pubDate ?? new Date().toISOString(),
        }))

      const ms = Date.now() - start
      logger.info({ op: 'getRssHeadlines', feedUrl, ms, count: items.length }, 'RSS feed fetched')
      return items
    } catch (err) {
      logger.error({ op: 'getRssHeadlines', feedUrl, err }, 'failed to fetch RSS feed')
      throw err
    }
  }

  async searchGoogleNews(query: string): Promise<NewsItem[]> {
    const feedUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`
    const start = Date.now()
    logger.info({ op: 'searchGoogleNews', query }, 'fetching Google News RSS')

    try {
      const feed = await withRetry('searchGoogleNews', () =>
        this.parser.parseURL(feedUrl),
      )
      const items: NewsItem[] = (feed.items ?? [])
        .slice(0, 10)
        .map((item) => ({
          title: item.title ?? '',
          source: feed.title ?? 'Google News',
          url: item.link ?? '',
          publishedAt: item.pubDate ?? new Date().toISOString(),
        }))

      const ms = Date.now() - start
      logger.info({ op: 'searchGoogleNews', query, ms, count: items.length }, 'Google News RSS fetched')
      return items
    } catch (err) {
      logger.error({ op: 'searchGoogleNews', query, feedUrl, err }, 'failed to fetch Google News RSS')
      throw err
    }
  }

  async fetchPage(url: string): Promise<string> {
    // Return cached result if available
    const cached = pageCache.get(url)
    if (cached !== undefined) {
      logger.debug({ op: 'fetchPage', url }, 'returning cached page')
      return cached
    }

    // Enforce max pages per run
    if (fetchCount >= FETCH_PAGE_MAX) {
      logger.warn({ op: 'fetchPage', url, fetchCount }, 'max page fetch limit reached, skipping')
      return ''
    }

    // Rate limiting: 1 req/sec
    const now = Date.now()
    const elapsed = now - lastFetchTime
    if (lastFetchTime > 0 && elapsed < RATE_LIMIT_MS) {
      const wait = RATE_LIMIT_MS - elapsed
      logger.debug({ op: 'fetchPage', url, waitMs: wait }, 'rate limiting, waiting')
      await new Promise((resolve) => setTimeout(resolve, wait))
    }

    const start = Date.now()
    logger.info({ op: 'fetchPage', url }, 'fetching page')

    try {
      // Check robots.txt
      const origin = new URL(url).origin
      const robotsUrl = `${origin}/robots.txt`
      try {
        const robotsRes = await fetch(robotsUrl, {
          signal: AbortSignal.timeout(ROBOTS_TIMEOUT_MS),
        })
        if (robotsRes.ok) {
          const robotsTxt = await robotsRes.text()
          const robots = parseRobots(robotsUrl, robotsTxt)
          if (!robots.isAllowed(url, '*')) {
            logger.warn({ op: 'fetchPage', url, robotsUrl }, 'robots.txt disallows fetching this URL')
            return ''
          }
        }
      } catch (_robotsErr) {
        // Ignore robots.txt errors — proceed with fetch
        logger.debug({ op: 'fetchPage', url, robotsUrl }, 'could not fetch robots.txt, proceeding anyway')
      }

      // Fetch the page
      lastFetchTime = Date.now()
      fetchCount++

      const res = await fetch(url, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      })

      const html = await res.text()
      const $ = load(html)

      // Remove noise elements
      $('script, style, nav, header, footer').remove()

      const text = ($('body').text() ?? '')
        .replace(/\s+/g, ' ')
        .trim()

      // Cache and return
      pageCache.set(url, text)

      const ms = Date.now() - start
      logger.info({ op: 'fetchPage', url, ms, chars: text.length }, 'page fetched and parsed')

      return text
    } catch (err) {
      logger.error({ op: 'fetchPage', url, err }, 'failed to fetch page')
      throw err
    }
  }
}
