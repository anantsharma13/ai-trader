import { getSupabaseClient } from './client.js'
import { logger } from '../../../config/logger.js'
import type { PositionsRepo, Position } from '../../types.js'

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

interface DbPosition {
  id?: number
  symbol: string
  qty: number
  avg_price: number
  opened_at: string
  status: 'open' | 'closed'
}

function toPosition(row: DbPosition): Position {
  return {
    id: row.id,
    symbol: row.symbol,
    qty: row.qty,
    avgPrice: row.avg_price,
    openedAt: row.opened_at,
    status: row.status,
  }
}

function toDbPosition(p: Position): Omit<DbPosition, 'id'> & { id?: number } {
  return {
    ...(p.id !== undefined ? { id: p.id } : {}),
    symbol: p.symbol,
    qty: p.qty,
    avg_price: p.avgPrice,
    opened_at: p.openedAt,
    status: p.status,
  }
}

export function createPositionsRepo(): PositionsRepo {
  return {
    async getOpen() {
      logger.info({ op: 'positions.getOpen' }, 'positions.getOpen entry')
      const start = Date.now()
      try {
        const rows = await withRetry(async () => {
          const supabase = getSupabaseClient()
          const { data, error } = await supabase
            .from('positions')
            .select('id, symbol, qty, avg_price, opened_at, status')
            .eq('status', 'open')

          if (error) {
            throw Object.assign(new Error(`positions.getOpen failed: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
          }
          return data as DbPosition[]
        })

        const positions = rows.map(toPosition)
        logger.info({ op: 'positions.getOpen', count: positions.length, durationMs: Date.now() - start }, 'positions.getOpen exit')
        return positions
      } catch (err: unknown) {
        logger.error({ op: 'positions.getOpen', err }, 'positions.getOpen failed')
        throw err
      }
    },

    async upsert(p: Position) {
      logger.info({ op: 'positions.upsert', symbol: p.symbol }, 'positions.upsert entry')
      const start = Date.now()
      try {
        await withRetry(async () => {
          const supabase = getSupabaseClient()
          const row = toDbPosition(p)
          const { error } = await supabase
            .from('positions')
            .upsert(row, { onConflict: 'symbol,status' })

          if (error) {
            const dbErr = Object.assign(new Error(`positions.upsert failed: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
            if (isNonRetryable(dbErr)) throw Object.assign(dbErr, { nonRetryable: true })
            throw dbErr
          }
        })
        logger.info({ op: 'positions.upsert', symbol: p.symbol, durationMs: Date.now() - start }, 'positions.upsert exit')
      } catch (err: unknown) {
        logger.error({ op: 'positions.upsert', symbol: p.symbol, err }, 'positions.upsert failed')
        throw err
      }
    },

    async close(symbol: string, closePrice: number) {
      logger.info({ op: 'positions.close', symbol, closePrice }, 'positions.close entry')
      const start = Date.now()
      try {
        await withRetry(async () => {
          const supabase = getSupabaseClient()
          const { error } = await supabase
            .from('positions')
            .update({ status: 'closed', avg_price: closePrice })
            .eq('symbol', symbol)
            .eq('status', 'open')

          if (error) {
            const dbErr = Object.assign(new Error(`positions.close failed for ${symbol}: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
            if (isNonRetryable(dbErr)) throw Object.assign(dbErr, { nonRetryable: true })
            throw dbErr
          }
        })
        logger.info({ op: 'positions.close', symbol, durationMs: Date.now() - start }, 'positions.close exit')
      } catch (err: unknown) {
        logger.error({ op: 'positions.close', symbol, err }, 'positions.close failed')
        throw err
      }
    },
  }
}
