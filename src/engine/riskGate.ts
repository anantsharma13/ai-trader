import { logger } from '../config/logger.js'
import type { OrderIntent, RiskGateResult } from './types.js'
import type { Config } from '../config/index.js'

export function applyRiskGate(
  intents: readonly OrderIntent[],
  portfolio: { cash: number; startingCapital: number },
  openPositions: Array<{ symbol: string; qty: number; avgPrice: number }>,
  quotes: Map<string, number>,
  config: Config,
): RiskGateResult {
  logger.info({ op: 'riskGate.apply', intentCount: intents.length }, 'riskGate.apply entry')

  const approved: OrderIntent[] = []
  const rejected: Array<{ intent: OrderIntent; reason: string }> = []

  // Symbols being sold this run — used to check max-positions limit
  const sellSymbols = new Set(
    intents.filter(i => i.side === 'SELL').map(i => i.symbol),
  )

  let availableCash = portfolio.cash

  // Portfolio value for position-size check: cash + current value of all open positions
  const positionsValue = openPositions.reduce((sum, p) => {
    const price = quotes.get(p.symbol) ?? p.avgPrice
    return sum + p.qty * price
  }, 0)
  const totalPortfolioValue = availableCash + positionsValue

  // Count currently open positions not being closed this run
  const openPositionCount = openPositions.filter(p => !sellSymbols.has(p.symbol)).length

  for (const rawIntent of intents) {
    if (rawIntent.side === 'SELL') {
      // SELL always approved — LLM already owns it per position data
      approved.push(rawIntent)
      logger.debug({ op: 'riskGate.apply', symbol: rawIntent.symbol, side: 'SELL' }, 'approved sell')
      continue
    }

    // BUY checks — work on a mutable copy so we can clip qty
    let intent: OrderIntent = { ...rawIntent }

    const price = quotes.get(intent.symbol)
    if (price === undefined) {
      rejected.push({ intent, reason: 'no quote' })
      logger.warn({ op: 'riskGate.apply', symbol: intent.symbol }, 'rejected: no quote')
      continue
    }

    const cost = price * intent.qty

    if (cost > availableCash) {
      rejected.push({ intent, reason: 'insufficient cash' })
      logger.warn({ op: 'riskGate.apply', symbol: intent.symbol, cost, availableCash }, 'rejected: insufficient cash')
      continue
    }

    // Check maxPositionPct — clip qty if needed
    const positionValue = price * intent.qty
    if (positionValue / totalPortfolioValue > config.maxPositionPct) {
      const clippedQty = Math.floor(availableCash * config.maxPositionPct / price)
      if (clippedQty <= 0) {
        rejected.push({ intent, reason: 'position size too small after clipping' })
        logger.warn({ op: 'riskGate.apply', symbol: intent.symbol, clippedQty }, 'rejected: position size too small after clipping')
        continue
      }
      intent = { ...intent, qty: clippedQty }
    }

    // Check maxPositions — only for new positions (symbol not already open)
    const alreadyOpen = openPositions.some(p => p.symbol === intent.symbol)
    if (!alreadyOpen && openPositionCount >= config.maxPositions) {
      rejected.push({ intent, reason: 'max positions reached' })
      logger.warn({ op: 'riskGate.apply', symbol: intent.symbol, openPositionCount }, 'rejected: max positions reached')
      continue
    }

    // Approved
    availableCash -= price * intent.qty
    approved.push(intent)
    logger.debug({ op: 'riskGate.apply', symbol: intent.symbol, qty: intent.qty, cost: price * intent.qty }, 'approved buy')
  }

  logger.info(
    { op: 'riskGate.apply', approvedCount: approved.length, rejectedCount: rejected.length },
    'riskGate.apply exit',
  )
  return { approved, rejected }
}
