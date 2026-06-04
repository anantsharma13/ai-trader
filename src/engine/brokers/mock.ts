import type { BrokerAdapter } from '../types.js'

export function createMockBroker(): BrokerAdapter {
  return {
    async fill(order, currentPrice) {
      // Mock fill: always fills at currentPrice, no slippage
      return { filled: true, fillPrice: currentPrice }
    },
  }
}
