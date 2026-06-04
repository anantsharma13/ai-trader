export interface OrderIntent {
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  rationale: string
  confidence: number
  signals: Record<string, unknown>
}

export interface FillResult {
  filled: boolean
  fillPrice: number
  reason?: string
}

export interface BrokerAdapter {
  fill(order: OrderIntent, currentPrice: number): Promise<FillResult>
}

export interface RiskGateResult {
  approved: OrderIntent[]
  rejected: Array<{ intent: OrderIntent; reason: string }>
}
