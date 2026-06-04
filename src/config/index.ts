import 'dotenv/config'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const ConfigSchema = z.object({
  llmProvider: z.enum(['azure', 'bedrock', 'anthropic']).default('azure'),
  topN: z.number().int().positive().default(5),
  maxCandidates: z.number().int().positive().default(15),
  startingCapital: z.number().positive().default(100000),
  maxPositionPct: z.number().min(0).max(1).default(0.20),
  maxPositions: z.number().int().positive().default(8),
  stopLossPct: z.number().min(0).max(1).default(0.07),
  rssFeedUrls: z.array(z.string().url()).default([]),
  dryRun: z.boolean().default(false),
})

const EnvSchema = z.object({
  AZURE_OPENAI_API_KEY: z.string().min(1),
  AZURE_OPENAI_ENDPOINT: z.string().url(),
  AZURE_OPENAI_DEPLOYMENT: z.string().min(1),
  AZURE_OPENAI_API_VERSION: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  NODE_ENV: z.string().default('production'),
})

export type Config = z.infer<typeof ConfigSchema>
export type Env = z.infer<typeof EnvSchema>

let _config: Config | null = null
let _env: Env | null = null

export function getConfig(): Config {
  if (!_config) {
    const configPath = join(__dirname, '../../config.json')
    const raw = JSON.parse(readFileSync(configPath, 'utf-8'))
    const result = ConfigSchema.safeParse(raw)
    if (!result.success) {
      throw new Error(`Invalid config.json: ${result.error.message}`)
    }
    _config = result.data
  }
  return _config
}

export function getEnv(): Env {
  if (!_env) {
    const result = EnvSchema.safeParse(process.env)
    if (!result.success) {
      throw new Error(`Missing/invalid env vars: ${result.error.message}`)
    }
    _env = result.data
  }
  return _env
}
