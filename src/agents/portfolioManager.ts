import { Agent, type Model } from '@strands-agents/sdk'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AgentTools } from './tools.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface OrderIntent {
  symbol: string
  side: 'buy' | 'sell'
  qty: number
  rationale: string
  confidence: number
  signals: Record<string, unknown>
}

export interface PortfolioManagerOutput {
  intents: OrderIntent[]
}

const portfolioManagerOutputSchema = z.object({
  intents: z.array(
    z.object({
      symbol: z.string(),
      side: z.enum(['buy', 'sell']),
      qty: z.number().int().positive(),
      rationale: z.string(),
      confidence: z.number().min(0).max(1),
      // Record<string, unknown> — values may be any JSON-compatible type
      signals: z.record(z.string(), z.unknown()),
    }),
  ),
})

export function createPortfolioManagerAgent(model: Model, tools: AgentTools): Agent {
  const systemPrompt = readFileSync(join(__dirname, 'prompts/portfolioManager.md'), 'utf-8')

  return new Agent({
    model,
    systemPrompt,
    tools: [tools.getOpenPositionsTool, tools.getPortfolioTool],
    structuredOutputSchema: portfolioManagerOutputSchema,
    printer: false,
    name: 'PortfolioManagerAgent',
    description: 'Converts consensus recommendations into concrete order intents with position sizing',
  })
}
