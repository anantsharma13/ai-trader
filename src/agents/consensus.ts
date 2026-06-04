import { Agent, type Model } from '@strands-agents/sdk'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface ConsensusOutput {
  recommendations: Array<{
    symbol: string
    direction: 'buy' | 'sell' | 'hold'
    confidence: number
    targetPrice?: number
    rationale: string
    macroRiskFlags: string[]
  }>
}

const consensusOutputSchema = z.object({
  recommendations: z.array(
    z.object({
      symbol: z.string(),
      direction: z.enum(['buy', 'sell', 'hold']),
      confidence: z.number().min(0).max(1),
      targetPrice: z.number().optional(),
      rationale: z.string(),
      macroRiskFlags: z.array(z.string()),
    }),
  ),
})

export function createConsensusAgent(model: Model): Agent {
  const systemPrompt = readFileSync(join(__dirname, 'prompts/consensus.md'), 'utf-8')

  // Consensus is pure synthesis — no tools needed, reasoning over provided text inputs
  return new Agent({
    model,
    systemPrompt,
    tools: [],
    structuredOutputSchema: consensusOutputSchema,
    printer: false,
    name: 'ConsensusAgent',
    description: 'Synthesizes discovery, technical, and macro outputs into ranked trade recommendations',
  })
}
