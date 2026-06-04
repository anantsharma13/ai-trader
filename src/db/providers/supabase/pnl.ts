import { getSupabaseClient } from './client.js'
import { logger } from '../../../config/logger.js'
import type { PnlRepo, DailyPnl } from '../../types.js'

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

interface DbDailyPnl {
  run_date: string
  portfolio_value: number
  cash: number
  realized_pnl: number
  unrealized_pnl: number
  day_return_pct: number
  cum_return_pct: number
}

function toDailyPnl(row: DbDailyPnl): DailyPnl {
  return {
    runDate: row.run_date,
    portfolioValue: row.portfolio_value,
    cash: row.cash,
    realizedPnl: row.realized_pnl,
    unrealizedPnl: row.unrealized_pnl,
    dayReturnPct: row.day_return_pct,
    cumReturnPct: row.cum_return_pct,
  }
}

function toDbDailyPnl(row: DailyPnl): DbDailyPnl {
  return {
    run_date: row.runDate,
    portfolio_value: row.portfolioValue,
    cash: row.cash,
    realized_pnl: row.realizedPnl,
    unrealized_pnl: row.unrealizedPnl,
    day_return_pct: row.dayReturnPct,
    cum_return_pct: row.cumReturnPct,
  }
}

export function createPnlRepo(): PnlRepo {
  return {
    async upsert(row: DailyPnl) {
      logger.info({ op: 'pnl.upsert', runDate: row.runDate }, 'pnl.upsert entry')
      const start = Date.now()
      try {
        await withRetry(async () => {
          const supabase = getSupabaseClient()
          const dbRow = toDbDailyPnl(row)
          const { error } = await supabase
            .from('daily_pnl')
            .upsert(dbRow, { onConflict: 'run_date' })

          if (error) {
            const dbErr = Object.assign(new Error(`pnl.upsert failed for ${row.runDate}: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
            if (isNonRetryable(dbErr)) throw Object.assign(dbErr, { nonRetryable: true })
            throw dbErr
          }
        })
        logger.info({ op: 'pnl.upsert', runDate: row.runDate, durationMs: Date.now() - start }, 'pnl.upsert exit')
      } catch (err: unknown) {
        logger.error({ op: 'pnl.upsert', runDate: row.runDate, err }, 'pnl.upsert failed')
        throw err
      }
    },

    async getAll() {
      logger.info({ op: 'pnl.getAll' }, 'pnl.getAll entry')
      const start = Date.now()
      try {
        const rows = await withRetry(async () => {
          const supabase = getSupabaseClient()
          const { data, error } = await supabase
            .from('daily_pnl')
            .select('run_date, portfolio_value, cash, realized_pnl, unrealized_pnl, day_return_pct, cum_return_pct')
            .order('run_date', { ascending: true })

          if (error) {
            throw Object.assign(new Error(`pnl.getAll failed: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
          }
          return data as DbDailyPnl[]
        })

        const pnlRows = rows.map(toDailyPnl)
        logger.info({ op: 'pnl.getAll', count: pnlRows.length, durationMs: Date.now() - start }, 'pnl.getAll exit')
        return pnlRows
      } catch (err: unknown) {
        logger.error({ op: 'pnl.getAll', err }, 'pnl.getAll failed')
        throw err
      }
    },
  }
}
