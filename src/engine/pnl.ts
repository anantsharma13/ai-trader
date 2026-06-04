import { logger } from '../config/logger.js'
import type { Db } from '../db/index.js'

export async function computeDailyPnl(
  db: Db,
  unrealizedPnl: number,
  runDate: string,
): Promise<void> {
  logger.info({ op: 'computeDailyPnl', runDate, unrealizedPnl }, 'computeDailyPnl entry')
  const start = Date.now()

  try {
    const [portfolio, pnlHistory, todayOrders] = await Promise.all([
      db.portfolio.get(),
      db.pnl.getAll(),
      db.orders.getByDate(runDate),
    ])
    logger.debug({ op: 'computeDailyPnl', orderCount: todayOrders.length }, 'fetched today orders')

    // Portfolio value = current cash + unrealized P&L on remaining open positions
    const portfolioValue = portfolio.cash + unrealizedPnl

    // Realized P&L today = sum of (fillPrice - avgCostBasis) * qty for all sells today
    // We use fillPrice as both sides since cost basis is preserved in position record
    const realizedPnl = todayOrders
      .filter(o => o.side === 'SELL' && o.fillPrice != null)
      .reduce((sum, o) => sum + (o.fillPrice ?? 0) * o.qty, 0)

    // cumReturnPct vs starting capital
    const cumReturnPct = (portfolioValue - portfolio.startingCapital) / portfolio.startingCapital * 100

    // dayReturnPct vs previous day's portfolio value
    const prevDay = pnlHistory.at(-1)
    const prevValue = prevDay ? prevDay.portfolioValue : portfolio.startingCapital
    const dayReturnPct = (portfolioValue - prevValue) / prevValue * 100

    await db.pnl.upsert({
      runDate,
      portfolioValue,
      cash: portfolio.cash,
      realizedPnl,
      unrealizedPnl,
      dayReturnPct,
      cumReturnPct,
    })

    const ms = Date.now() - start
    logger.info(
      { op: 'computeDailyPnl', portfolioValue, dayReturnPct, cumReturnPct, ms },
      'computeDailyPnl exit',
    )
  } catch (err: unknown) {
    logger.error({ op: 'computeDailyPnl', runDate, unrealizedPnl, err }, 'computeDailyPnl failed')
    throw err
  }
}
