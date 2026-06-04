import { getConfig } from '../config/index.js'
import { createYahooProvider } from './providers/yahoo.js'
import type { DataProvider } from './types.js'

export { type DataProvider, type Quote, type OHLCV, type Indicators } from './types.js'
export { resolveTicker } from './tickerResolver.js'

/**
 * Factory — reads config and returns the active DataProvider.
 * Currently always returns the Yahoo Finance provider.
 */
export function createDataProvider(): DataProvider {
  // Config is read here so any startup errors surface early.
  // Future: config.dataProvider could select alternate providers.
  getConfig()
  return createYahooProvider()
}
