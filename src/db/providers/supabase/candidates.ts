import { getSupabaseClient } from './client.js'
import { logger } from '../../../config/logger.js'
import type { CandidatesRepo, Candidate } from '../../types.js'

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

interface DbCandidate {
  id?: number
  run_date: string
  symbol: string
  consensus?: string
  target_price?: number
  source_count?: number
  macro_flags?: string[]
  selected: boolean
}

function toDbCandidate(c: Candidate): Omit<DbCandidate, 'id'> & { id?: number } {
  return {
    ...(c.id !== undefined ? { id: c.id } : {}),
    run_date: c.runDate,
    symbol: c.symbol,
    ...(c.consensus !== undefined ? { consensus: c.consensus } : {}),
    ...(c.targetPrice !== undefined ? { target_price: c.targetPrice } : {}),
    ...(c.sourceCount !== undefined ? { source_count: c.sourceCount } : {}),
    ...(c.macroFlags !== undefined ? { macro_flags: c.macroFlags } : {}),
    selected: c.selected,
  }
}

export function createCandidatesRepo(): CandidatesRepo {
  return {
    async insertBatch(cs: Candidate[]) {
      logger.info({ op: 'candidates.insertBatch', count: cs.length }, 'candidates.insertBatch entry')
      const start = Date.now()
      if (cs.length === 0) {
        logger.info({ op: 'candidates.insertBatch', count: 0 }, 'candidates.insertBatch exit — nothing to insert')
        return
      }
      try {
        await withRetry(async () => {
          const supabase = getSupabaseClient()
          const rows = cs.map(toDbCandidate)
          const { error } = await supabase
            .from('candidates')
            .insert(rows)

          if (error) {
            const dbErr = Object.assign(new Error(`candidates.insertBatch failed: ${error.message}`), { status: error.code ? Number(error.code) : undefined })
            if (isNonRetryable(dbErr)) throw Object.assign(dbErr, { nonRetryable: true })
            throw dbErr
          }
        })
        logger.info({ op: 'candidates.insertBatch', count: cs.length, durationMs: Date.now() - start }, 'candidates.insertBatch exit')
      } catch (err: unknown) {
        logger.error({ op: 'candidates.insertBatch', count: cs.length, err }, 'candidates.insertBatch failed')
        throw err
      }
    },
  }
}
