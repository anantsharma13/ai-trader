import { OpenAIModel } from '@strands-agents/sdk/models/openai'
import { getEnv } from '../../config/index.js'
import type { LLMModel, LLMProvider } from '../types.js'

/**
 * Factory for Azure OpenAI model using the Strands SDK OpenAIModel with Chat Completions.
 * Azure requires api: 'chat' because its endpoint structure matches Chat Completions.
 */
export function createAzureModel(): LLMModel {
  const env = getEnv()
  return new OpenAIModel({
    api: 'chat',
    apiKey: env.AZURE_OPENAI_API_KEY,
    modelId: env.AZURE_OPENAI_DEPLOYMENT,
    clientConfig: {
      baseURL: `${env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${env.AZURE_OPENAI_DEPLOYMENT}`,
      defaultQuery: { 'api-version': env.AZURE_OPENAI_API_VERSION },
      defaultHeaders: { 'api-key': env.AZURE_OPENAI_API_KEY },
    },
  })
}

export class AzureLLMProvider implements LLMProvider {
  createModel(): LLMModel {
    return createAzureModel()
  }
}
