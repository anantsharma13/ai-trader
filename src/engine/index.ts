import type { Config } from '../config/index.js'
import type { Db } from '../db/index.js'
import type { DataProvider } from '../data/types.js'
import { applyRiskGate } from './riskGate.js'
import { createMockBroker } from './brokers/mock.js'
import { fillOrders } from './fill.js'
import { markToMarket } from './markToMarket.js'
import { computeDailyPnl } from './pnl.js'
import type { OrderIntent, RiskGateResult } from './types.js'

export type { OrderIntent, FillResult, BrokerAdapter, RiskGateResult } from './types.js'

export interface Engine {
  applyRiskGate: typeof applyRiskGate
  fillOrders(approved: OrderIntent[], runDate: string): Promise<void>
  markToMarket(runDate: string): Promise<{ unrealizedPnl: number; autoSells: string[] }>
  computeDailyPnl(unrealizedPnl: number, runDate: string): Promise<void>
}

export function createEngine(config: Config, db: Db, dataProvider: DataProvider): Engine {
  const broker = createMockBroker()
  return {
    applyRiskGate,
    fillOrders: (approved, runDate) => fillOrders(approved, db, dataProvider, broker, config, runDate),
    markToMarket: (runDate) => markToMarket(db, dataProvider, config, runDate),
    computeDailyPnl: (unrealizedPnl, runDate) => computeDailyPnl(db, unrealizedPnl, runDate),
  }
}
