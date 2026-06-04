import { Agent, type Model } from '@strands-agents/sdk'
import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { AgentTools } from './tools.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface MacroOutput {
  riskLevel: 'low' | 'medium' | 'high'
  flags: string[]
  allowNewLongs: boolean
}

const macroOutputSchema = z.object({
  riskLevel: z.enum(['low', 'medium', 'high']),
  flags: z.array(z.string()),
  allowNewLongs: z.boolean(),
})

export function createMacroAgent(model: Model, tools: AgentTools): Agent {
  const systemPrompt = readFileSync(join(__dirname, 'prompts/macro.md'), 'utf-8')

  return new Agent({
    model,
    systemPrompt,
    tools: [tools.searchNewsTool, tools.getRssHeadlinesTool],
    structuredOutputSchema: macroOutputSchema,
    printer: false,
    name: 'MacroAgent',
    description: 'Assesses Indian macro and sector conditions to flag systemic risks',
  })
}
