import { type Agent, type Model } from '@strands-agents/sdk'
import { createTools, type AgentTools } from './tools.js'
import { createDiscoveryAgent } from './discovery.js'
import { createTechnicalAgent } from './technical.js'
import { createMacroAgent } from './macro.js'
import { createConsensusAgent } from './consensus.js'
import { createPortfolioManagerAgent } from './portfolioManager.js'
import type { DataProvider } from '../data/index.js'
import type { ResearchProvider } from '../research/index.js'
import type { Db } from '../db/index.js'

export { createTools, type AgentTools } from './tools.js'
export { createDiscoveryAgent, type DiscoveryOutput } from './discovery.js'
export { createTechnicalAgent, type TechnicalOutput } from './technical.js'
export { createMacroAgent, type MacroOutput } from './macro.js'
export { createConsensusAgent, type ConsensusOutput } from './consensus.js'
export { createPortfolioManagerAgent, type OrderIntent, type PortfolioManagerOutput } from './portfolioManager.js'

export interface AgentSuite {
  discovery: Agent
  technical: Agent
  macro: Agent
  consensus: Agent
  portfolioManager: Agent
}

/**
 * Factory — creates all 5 agents wired to a shared model and tool set.
 */
export function createAgentSuite(
  model: Model,
  dataProvider: DataProvider,
  researchProvider: ResearchProvider,
  db: Db,
): AgentSuite {
  const tools: AgentTools = createTools(dataProvider, researchProvider, db)

  return {
    discovery: createDiscoveryAgent(model, tools),
    technical: createTechnicalAgent(model, tools),
    macro: createMacroAgent(model, tools),
    consensus: createConsensusAgent(model),
    portfolioManager: createPortfolioManagerAgent(model, tools),
  }
}
