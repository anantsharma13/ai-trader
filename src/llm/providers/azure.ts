import { OpenAIModel } from '@strands-agents/sdk/models/openai'
import { AzureOpenAI } from 'openai'
import { getEnv } from '../../config/index.js'
import type { LLMModel, LLMProvider } from '../types.js'

/**
 * Factory for Azure OpenAI model using the Strands SDK OpenAIModel with Chat Completions.
 * Uses AzureOpenAI client from openai v6 for proper endpoint routing.
 */
export function createAzureModel(): LLMModel {
  const env = getEnv()

  const azureClient = new AzureOpenAI({
    apiKey: env.AZURE_OPENAI_API_KEY,
    endpoint: env.AZURE_OPENAI_ENDPOINT,
    deployment: env.AZURE_OPENAI_DEPLOYMENT,
    apiVersion: env.AZURE_OPENAI_API_VERSION,
  })

  return new OpenAIModel({
    api: 'chat',
    modelId: env.AZURE_OPENAI_DEPLOYMENT,
    client: azureClient,
    params: {
      // Enable JSON mode for Azure OpenAI structured outputs
      response_format: { type: 'json_object' },
    },
  })
}

export class AzureLLMProvider implements LLMProvider {
  createModel(): LLMModel {
    return createAzureModel()
  }
}
