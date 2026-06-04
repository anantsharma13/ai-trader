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
    // Get today's orders for context (realized P&L tracking is done in markToMarket)
    const todayOrders = await db.orders.getByDate(runDate)
    logger.debug({ op: 'computeDailyPnl', orderCount: todayOrders.length }, 'fetched today orders')

    const portfolio = await db.portfolio.get()

    // Portfolio value = current cash + unrealized P&L on remaining open positions
    const portfolioValue = portfolio.cash + unrealizedPnl

    const dayReturnPct =
      (portfolioValue - portfolio.startingCapital) / portfolio.startingCapital * 100

    // cumReturnPct = same as dayReturnPct since we compare vs starting capital each time
    const cumReturnPct = dayReturnPct

    await db.pnl.upsert({
      runDate,
      portfolioValue,
      cash: portfolio.cash,
      realizedPnl: 0,
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
