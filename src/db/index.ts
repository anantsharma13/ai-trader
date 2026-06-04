import { createPortfolioRepo } from './providers/supabase/portfolio.js'
import { createPositionsRepo } from './providers/supabase/positions.js'
import { createOrdersRepo } from './providers/supabase/orders.js'
import { createCandidatesRepo } from './providers/supabase/candidates.js'
import { createPnlRepo } from './providers/supabase/pnl.js'
import { createStorageRepo } from './providers/supabase/storage.js'
import type { PortfolioRepo, PositionsRepo, OrdersRepo, CandidatesRepo, PnlRepo, StorageRepo } from './types.js'

export type { Position, Order, Candidate, DailyPnl, PortfolioRepo, PositionsRepo, OrdersRepo, CandidatesRepo, PnlRepo, StorageRepo } from './types.js'

export interface Db {
  portfolio: PortfolioRepo
  positions: PositionsRepo
  orders: OrdersRepo
  candidates: CandidatesRepo
  pnl: PnlRepo
  storage: StorageRepo
}

export function createDb(): Db {
  return {
    portfolio: createPortfolioRepo(),
    positions: createPositionsRepo(),
    orders: createOrdersRepo(),
    candidates: createCandidatesRepo(),
    pnl: createPnlRepo(),
    storage: createStorageRepo(),
  }
}
