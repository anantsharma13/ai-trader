import { getSupabaseClient } from './client.js'
import { getConfig } from '../../../config/index.js'
import { logger } from '../../../config/logger.js'
import type { PortfolioRepo } from '../../types.js'

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

export function createPortfolioRepo(): PortfolioRepo {
  return {
    async get() {
      logger.info({ op: 'portfolio.get' }, 'portfolio.get entry')
      const start = Date.now()
      try {
        const result = await withRetry(async () => {
          const supabase = getSupabaseClient()
          const { data, error } = await supabase
            .from('portfolio')
            .select('cash, starting_capital')
            .limit(1)
            .single()

          if (error && error.code === 'PGRST116') {
            // No rows — seed initial portfolio
            const { startingCapital } = getConfig()
            const { data: inserted, error: insertError } = await supabase
              .from('portfolio')
              .insert({ cash: startingCapital, starting_capital: startingCapital })
              .select('cash, starting_capital')
              .single()
            if (insertError) {
              throw Object.assign(new Error(`portfolio seed failed: ${insertError.message}`), { status: insertError.code ? Number(insertError.code) : undefined })
            }
            return inserted
          }

          if (error) {
            throw Object.assign(new Error(`portfolio.get failed: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
          }
          return data
        })

        const row = result as { cash: number; starting_capital: number }
        logger.info({ op: 'portfolio.get', durationMs: Date.now() - start }, 'portfolio.get exit')
        return { cash: row.cash, startingCapital: row.starting_capital }
      } catch (err: unknown) {
        logger.error({ op: 'portfolio.get', err }, 'portfolio.get failed')
        throw err
      }
    },

    async updateCash(cash: number) {
      logger.info({ op: 'portfolio.updateCash', cash }, 'portfolio.updateCash entry')
      const start = Date.now()
      try {
        await withRetry(async () => {
          if (isNonRetryable({ status: 0 })) return // type-narrowing placeholder
          const supabase = getSupabaseClient()
          const { error } = await supabase
            .from('portfolio')
            .update({ cash })
            .not('id', 'is', null) // update the single row

          if (error) {
            const dbErr = Object.assign(new Error(`portfolio.updateCash failed: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
            if (isNonRetryable(dbErr)) throw Object.assign(dbErr, { nonRetryable: true })
            throw dbErr
          }
        })
        logger.info({ op: 'portfolio.updateCash', durationMs: Date.now() - start }, 'portfolio.updateCash exit')
      } catch (err: unknown) {
        logger.error({ op: 'portfolio.updateCash', cash, err }, 'portfolio.updateCash failed')
        throw err
      }
    },
  }
}
