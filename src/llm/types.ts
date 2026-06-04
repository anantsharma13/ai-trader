// Re-export SDK Model as LLMModel so the llm layer owns the type boundary.
// The src/llm/ and src/agents/ layers are the only layers permitted to import the SDK.
export type { Model as LLMModel } from '@strands-agents/sdk'

export interface LLMProvider {
  createModel(): import('@strands-agents/sdk').Model
}
