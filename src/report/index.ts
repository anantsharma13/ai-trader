import { logger } from '../config/logger.js'
import type { Db } from '../db/index.js'
import type { ReportData } from './types.js'
import { buildHtmlReport } from './builder.js'
import { uploadReport } from './uploader.js'

export { buildHtmlReport } from './builder.js'
export { uploadReport } from './uploader.js'
export type { ReportData } from './types.js'

export async function generateReport(db: Db, runDate: string): Promise<string> {
  logger.info({ op: 'generateReport', runDate }, 'generating report')

  let pnlHistory: Awaited<ReturnType<Db['pnl']['getAll']>>
  let todayOrdersRaw: Awaited<ReturnType<Db['orders']['getByDate']>>
  let openPositionsRaw: Awaited<ReturnType<Db['positions']['getOpen']>>
  let portfolio: { cash: number; startingCapital: number }

  try {
    ;[pnlHistory, todayOrdersRaw, openPositionsRaw, portfolio] = await Promise.all([
      db.pnl.getAll(),
      db.orders.getByDate(runDate),
      db.positions.getOpen(),
      db.portfolio.get(),
    ])
  } catch (err) {
    logger.error({ op: 'generateReport', runDate, err }, 'failed to fetch data for report')
    throw new Error(`generateReport data fetch failed for ${runDate}: ${err instanceof Error ? err.message : String(err)}`)
  }

  // Find today's PnL row; fall back to zeroes if not yet written
  const todayPnl = pnlHistory.find(r => r.runDate === runDate)

  // Last 30 days, newest-first sorted → oldest-first for display
  const sortedHistory = [...pnlHistory]
    .sort((a, b) => a.runDate.localeCompare(b.runDate))
    .slice(-30)

  const data: ReportData = {
    runDate,
    portfolioValue: todayPnl?.portfolioValue ?? portfolio.cash,
    cash: portfolio.cash,
    realizedPnl: todayPnl?.realizedPnl ?? 0,
    unrealizedPnl: todayPnl?.unrealizedPnl ?? 0,
    dayReturnPct: todayPnl?.dayReturnPct ?? 0,
    cumReturnPct: todayPnl?.cumReturnPct ?? 0,
    openPositions: openPositionsRaw.map(p => ({
      symbol: p.symbol,
      qty: p.qty,
      avgPrice: p.avgPrice,
    })),
    todayOrders: todayOrdersRaw.map(o => ({
      symbol: o.symbol,
      side: o.side,
      qty: o.qty,
      fillPrice: o.fillPrice,
      rationale: o.rationale,
      confidence: o.confidence,
    })),
    pnlHistory: sortedHistory.map(r => ({
      date: r.runDate,
      portfolioValue: r.portfolioValue,
      dayReturnPct: r.dayReturnPct,
      cumReturnPct: r.cumReturnPct,
    })),
  }

  const html = buildHtmlReport(data)
  const url = await uploadReport(db, html, runDate)

  logger.info({ op: 'generateReport', runDate, url }, 'report generated and uploaded')
  return url
}
