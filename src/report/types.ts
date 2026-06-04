export interface ReportData {
  runDate: string           // YYYY-MM-DD
  portfolioValue: number
  cash: number
  realizedPnl: number
  unrealizedPnl: number
  dayReturnPct: number
  cumReturnPct: number
  openPositions: Array<{
    symbol: string
    qty: number
    avgPrice: number
    currentValue?: number
  }>
  todayOrders: Array<{
    symbol: string
    side: string
    qty: number
    fillPrice?: number
    rationale?: string
    confidence?: number
  }>
  pnlHistory: Array<{
    date: string
    portfolioValue: number
    dayReturnPct: number
    cumReturnPct: number
  }>
}
