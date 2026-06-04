import { Agent, type Model } from '@strands-agents/sdk'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AgentTools } from './tools.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface TechnicalOutput {
  ratings: Array<{
    symbol: string
    rating: 'buy' | 'hold' | 'sell'
    rsi14: number
    sma20: number
    sma50: number
    volumeTrend: 'rising' | 'falling' | 'flat'
    confidence: number
  }>
}

const technicalOutputSchema = z.object({
  ratings: z.array(
    z.object({
      symbol: z.string(),
      rating: z.enum(['buy', 'hold', 'sell']),
      rsi14: z.number(),
      sma20: z.number(),
      sma50: z.number(),
      volumeTrend: z.enum(['rising', 'falling', 'flat']),
      confidence: z.number().min(0).max(1),
    }),
  ),
})

export function createTechnicalAgent(model: Model, tools: AgentTools): Agent {
  const systemPrompt = readFileSync(join(__dirname, 'prompts/technical.md'), 'utf-8')

  return new Agent({
    model,
    systemPrompt,
    tools: [tools.getQuoteTool, tools.getHistoryTool, tools.getIndicatorsTool],
    structuredOutputSchema: technicalOutputSchema,
    printer: false,
    name: 'TechnicalAgent',
    description: 'Analyzes technical indicators and price action for candidate stocks',
  })
}
