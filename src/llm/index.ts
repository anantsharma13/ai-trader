import { getConfig } from '../config/index.js'
import { AzureLLMProvider } from './providers/azure.js'
import type { LLMModel, LLMProvider } from './types.js'

export type { LLMModel, LLMProvider } from './types.js'

/**
 * Factory — reads config.llmProvider and returns the appropriate LLM provider.
 * Currently only 'azure' is supported; others will throw at startup.
 */
export function createLLMProvider(): LLMProvider {
  const config = getConfig()
  switch (config.llmProvider) {
    case 'azure':
      return new AzureLLMProvider()
    default:
      throw new Error(`Unsupported LLM provider: ${config.llmProvider}`)
  }
}

/**
 * Convenience — create a model from the configured provider in one call.
 */
export function createModel(): LLMModel {
  return createLLMProvider().createModel()
}
