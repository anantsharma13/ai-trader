import { getSupabaseClient } from './client.js'
import { logger } from '../../../config/logger.js'
import type { StorageRepo } from '../../types.js'

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

export function createStorageRepo(): StorageRepo {
  return {
    async uploadReport(filename: string, html: string) {
      logger.info({ op: 'storage.uploadReport', filename }, 'storage.uploadReport entry')
      const start = Date.now()
      try {
        const publicUrl = await withRetry(async () => {
          const supabase = getSupabaseClient()

          const { error: uploadError } = await supabase.storage
            .from('ai-trading-reports')
            .upload(filename, html, { contentType: 'text/html', upsert: true })

          if (uploadError) {
            throw Object.assign(
              new Error(`storage.uploadReport failed for ${filename}: ${uploadError.message}`),
              { status: (uploadError as unknown as { status?: number }).status }
            )
          }

          const { data } = supabase.storage
            .from('ai-trading-reports')
            .getPublicUrl(filename)

          return data.publicUrl
        })

        logger.info({ op: 'storage.uploadReport', filename, publicUrl, durationMs: Date.now() - start }, 'storage.uploadReport exit')
        return publicUrl
      } catch (err: unknown) {
        logger.error({ op: 'storage.uploadReport', filename, err }, 'storage.uploadReport failed')
        throw err
      }
    },
  }
}
