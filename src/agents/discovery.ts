import { Agent, type Model } from '@strands-agents/sdk'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AgentTools } from './tools.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface DiscoveryOutput {
  candidates: Array<{
    name: string
    headline: string
    sentiment: 'bullish' | 'bearish' | 'neutral'
    sourceCount: number
  }>
}

const discoveryOutputSchema = z.object({
  candidates: z.array(
    z.object({
      name: z.string(),
      headline: z.string(),
      sentiment: z.enum(['bullish', 'bearish', 'neutral']),
      sourceCount: z.number().int().nonnegative(),
    }),
  ),
})

export function createDiscoveryAgent(model: Model, tools: AgentTools): Agent {
  const systemPrompt = readFileSync(join(__dirname, 'prompts/discovery.md'), 'utf-8')

  return new Agent({
    model,
    systemPrompt,
    tools: [tools.getRssHeadlinesTool, tools.searchNewsTool, tools.resolveTickerTool],
    structuredOutputSchema: discoveryOutputSchema,
    printer: false,
    name: 'DiscoveryAgent',
    description: 'Scans news to identify candidate stocks for Indian equity trading',
  })
}
