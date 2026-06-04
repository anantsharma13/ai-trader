import { getSupabaseClient } from './client.js'
import { logger } from '../../../config/logger.js'
import type { OrdersRepo, Order } from '../../types.js'

async function withRetry<T>(op: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await op()
    } catch (err: unknown) {
      lastErr = err
      if (attempt < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)))
      }
    }
  }
  throw lastErr
}

function isNonRetryable(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status
    return status === 400 || status === 401 || status === 404
  }
  return false
}

interface DbOrder {
  id?: number
  run_date: string
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  fill_price?: number
  rationale?: string
  confidence?: number
  signals?: Record<string, unknown>
}

function toOrder(row: DbOrder): Order {
  return {
    id: row.id,
    runDate: row.run_date,
    symbol: row.symbol,
    side: row.side,
    qty: row.qty,
    fillPrice: row.fill_price,
    rationale: row.rationale,
    confidence: row.confidence,
    signals: row.signals,
  }
}

function toDbOrder(o: Order): Omit<DbOrder, 'id'> & { id?: number } {
  return {
    ...(o.id !== undefined ? { id: o.id } : {}),
    run_date: o.runDate,
    symbol: o.symbol,
    side: o.side,
    qty: o.qty,
    ...(o.fillPrice !== undefined ? { fill_price: o.fillPrice } : {}),
    ...(o.rationale !== undefined ? { rationale: o.rationale } : {}),
    ...(o.confidence !== undefined ? { confidence: o.confidence } : {}),
    ...(o.signals !== undefined ? { signals: o.signals } : {}),
  }
}

export function createOrdersRepo(): OrdersRepo {
  return {
    async insert(o: Order) {
      logger.info({ op: 'orders.insert', symbol: o.symbol, side: o.side, runDate: o.runDate }, 'orders.insert entry')
      const start = Date.now()
      try {
        await withRetry(async () => {
          const supabase = getSupabaseClient()
          const row = toDbOrder(o)
          const { error } = await supabase
            .from('orders')
            .insert(row)

          if (error) {
            const dbErr = Object.assign(new Error(`orders.insert failed for ${o.symbol}: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
            if (isNonRetryable(dbErr)) throw Object.assign(dbErr, { nonRetryable: true })
            throw dbErr
          }
        })
        logger.info({ op: 'orders.insert', symbol: o.symbol, durationMs: Date.now() - start }, 'orders.insert exit')
      } catch (err: unknown) {
        logger.error({ op: 'orders.insert', symbol: o.symbol, err }, 'orders.insert failed')
        throw err
      }
    },

    async getByDate(date: string) {
      logger.info({ op: 'orders.getByDate', date }, 'orders.getByDate entry')
      const start = Date.now()
      try {
        const rows = await withRetry(async () => {
          const supabase = getSupabaseClient()
          const { data, error } = await supabase
            .from('orders')
            .select('id, run_date, symbol, side, qty, fill_price, rationale, confidence, signals')
            .eq('run_date', date)

          if (error) {
            throw Object.assign(new Error(`orders.getByDate failed for ${date}: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
          }
          return data as DbOrder[]
        })

        const orders = rows.map(toOrder)
        logger.info({ op: 'orders.getByDate', date, count: orders.length, durationMs: Date.now() - start }, 'orders.getByDate exit')
        return orders
      } catch (err: unknown) {
        logger.error({ op: 'orders.getByDate', date, err }, 'orders.getByDate failed')
        throw err
      }
    },
  }
}
