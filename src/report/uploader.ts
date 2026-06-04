import { logger } from '../config/logger.js'
import type { Db } from '../db/index.js'

export async function uploadReport(db: Db, html: string, runDate: string): Promise<string> {
  const filename = `report-${runDate}.html`
  const t0 = Date.now()
  logger.info({ op: 'uploadReport', filename }, 'uploading report to storage')

  try {
    const url = await db.storage.uploadReport(filename, html)
    logger.info({ op: 'uploadReport', filename, url, ms: Date.now() - t0 }, 'report uploaded successfully')
    return url
  } catch (err) {
    logger.error({ op: 'uploadReport', filename, runDate, err }, 'failed to upload report')
    throw new Error(`uploadReport failed for ${filename}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
