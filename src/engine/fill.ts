import { logger } from '../config/logger.js'
import type { Db } from '../db/index.js'
import type { DataProvider } from '../data/types.js'
import type { BrokerAdapter, OrderIntent } from './types.js'
import type { Config } from '../config/index.js'

export async function fillOrders(
  approved: OrderIntent[],
  db: Db,
  dataProvider: DataProvider,
  broker: BrokerAdapter,
  config: Config,
  runDate: string,
): Promise<void> {
  logger.info({ op: 'fillOrders', count: approved.length, runDate }, 'fillOrders entry')

  for (const order of approved) {
    const start = Date.now()
    try {
      const quote = await dataProvider.getQuote(order.symbol)
      const fill = await broker.fill(order, quote.price)

      if (!fill.filled) {
        logger.warn({ op: 'fill', symbol: order.symbol, reason: fill.reason }, 'order not filled')
        continue
      }

      // Insert order record
      await db.orders.insert({
        runDate,
        symbol: order.symbol,
        side: order.side,
        qty: order.qty,
        fillPrice: fill.fillPrice,
        rationale: order.rationale,
        confidence: order.confidence,
        signals: order.signals,
      })

      if (order.side === 'BUY') {
        await db.positions.upsert({
          symbol: order.symbol,
          qty: order.qty,
          avgPrice: fill.fillPrice,
          openedAt: runDate,
          status: 'open',
        })

        // Deduct cost from cash
        const portfolio = await db.portfolio.get()
        const newCash = portfolio.cash - fill.fillPrice * order.qty
        await db.portfolio.updateCash(newCash)
      } else {
        // SELL — close position and compute realized P&L
        const openPositions = await db.positions.getOpen()
        const position = openPositions.find(p => p.symbol === order.symbol)

        await db.positions.close(order.symbol, fill.fillPrice)

        if (position) {
          const realizedPnl = (fill.fillPrice - position.avgPrice) * order.qty
          logger.info(
            { op: 'fill', symbol: order.symbol, side: 'SELL', realizedPnl },
            'realized P&L on sell',
          )
        }

        // Add proceeds to cash
        const portfolio = await db.portfolio.get()
        const newCash = portfolio.cash + fill.fillPrice * order.qty
        await db.portfolio.updateCash(newCash)
      }

      const ms = Date.now() - start
      logger.info(
        { op: 'fill', symbol: order.symbol, side: order.side, qty: order.qty, fillPrice: fill.fillPrice, ms },
        'fill completed',
      )
    } catch (err: unknown) {
      logger.error(
        { op: 'fill', symbol: order.symbol, side: order.side, qty: order.qty, err },
        'fill failed',
      )
      throw err
    }
  }

  logger.info({ op: 'fillOrders', count: approved.length, runDate }, 'fillOrders exit')
}
