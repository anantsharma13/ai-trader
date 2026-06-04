export interface Quote {
  symbol: string
  price: number
  open: number
  high: number
  low: number
  volume: number
  date: string
}

export interface OHLCV {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Indicators {
  sma20: number
  sma50: number
  rsi14: number
  macd: { value: number; signal: number; histogram: number }
  volumeTrend: 'rising' | 'falling' | 'flat'
}

export interface DataProvider {
  getQuote(symbol: string): Promise<Quote>
  getOHLCV(symbol: string, days: number): Promise<OHLCV[]>
  getIndicators(symbol: string): Promise<Indicators>
  getTickerNews(symbol: string): Promise<string[]>
}
