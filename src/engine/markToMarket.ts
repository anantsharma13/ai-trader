import { logger } from '../config/logger.js'
import type { Db } from '../db/index.js'
import type { DataProvider } from '../data/types.js'
import type { Config } from '../config/index.js'

export async function markToMarket(
  db: Db,
  dataProvider: DataProvider,
  config: Config,
  runDate: string,
): Promise<{ unrealizedPnl: number; autoSells: string[] }> {
  logger.info({ op: 'markToMarket', runDate }, 'markToMarket entry')
  const start = Date.now()

  try {
    const positions = await db.positions.getOpen()
    let unrealizedPnl = 0
    const autoSells: string[] = []

    for (const position of positions) {
      try {
        const quote = await dataProvider.getQuote(position.symbol)
        const currentPrice = quote.price
        const unrealizedGainPct = (currentPrice - position.avgPrice) / position.avgPrice

        if (unrealizedGainPct < -config.stopLossPct) {
          logger.warn(
            {
              op: 'markToMarket',
              symbol: position.symbol,
              unrealizedGainPct,
              stopLossPct: config.stopLossPct,
            },
            'stop-loss triggered, auto-selling',
          )

          await db.orders.insert({
            runDate,
            symbol: position.symbol,
            side: 'SELL',
            qty: position.qty,
            fillPrice: currentPrice,
            rationale: `Stop-loss triggered: ${(unrealizedGainPct * 100).toFixed(2)}% loss exceeds ${(config.stopLossPct * 100).toFixed(2)}% limit`,
            confidence: 0,
            signals: { stopLoss: true, unrealizedGainPct, stopLossPct: config.stopLossPct },
          })

          await db.positions.close(position.symbol)

          // Add proceeds to cash
          const portfolio = await db.portfolio.get()
          const newCash = portfolio.cash + currentPrice * position.qty
          await db.portfolio.updateCash(newCash)

          autoSells.push(position.symbol)
        } else {
          unrealizedPnl += (currentPrice - position.avgPrice) * position.qty
        }
      } catch (err: unknown) {
        // Log and continue — one bad quote shouldn't block all other positions
        logger.error(
          { op: 'markToMarket', symbol: position.symbol, err },
          'failed to mark position to market — skipping',
        )
      }
    }

    const ms = Date.now() - start
    logger.info(
      { op: 'markToMarket', unrealizedPnl, autoSells, positionCount: positions.length, ms },
      'markToMarket exit',
    )
    return { unrealizedPnl, autoSells }
  } catch (err: unknown) {
    logger.error({ op: 'markToMarket', runDate, err }, 'markToMarket failed')
    throw err
  }
}
