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
    // structuredOutputSchema disabled due to Azure OpenAI tool forcing incompatibility
    // Parse JSON from response text instead
    printer: false,
    name: 'PortfolioManagerAgent',
    description: 'Converts consensus recommendations into concrete order intents with position sizing',
  })
}

/**
 * Parse portfolio manager output from text response.
 * Handles cases where model returns JSON without using structured output tool.
 */
export function parsePortfolioManagerOutput(text: string): PortfolioManagerOutput {
  // Extract JSON from markdown code blocks or raw text
  const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) || text.match(/(\{[\s\S]*\})/)
  if (!jsonMatch) {
    throw new Error('No JSON found in portfolio manager response')
  }

  const parsed = JSON.parse(jsonMatch[1])
  return portfolioManagerOutputSchema.parse(parsed)
}
