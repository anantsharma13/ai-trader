export interface Position {
  id?: number
  symbol: string
  qty: number
  avgPrice: number
  openedAt: string  // ISO date string
  status: 'open' | 'closed'
}

export interface Order {
  id?: number
  runDate: string
  symbol: string
  side: 'BUY' | 'SELL'
  qty: number
  fillPrice?: number
  rationale?: string
  confidence?: number
  signals?: Record<string, unknown>
}

export interface Candidate {
  id?: number
  runDate: string
  symbol: string
  consensus?: string
  targetPrice?: number
  sourceCount?: number
  macroFlags?: string[]
  selected: boolean
}

export interface DailyPnl {
  runDate: string
  portfolioValue: number
  cash: number
  realizedPnl: number
  unrealizedPnl: number
  dayReturnPct: number
  cumReturnPct: number
}

export interface PortfolioRepo {
  get(): Promise<{ cash: number; startingCapital: number }>
  updateCash(cash: number): Promise<void>
}

export interface PositionsRepo {
  getOpen(): Promise<Position[]>
  upsert(p: Position): Promise<void>
  close(symbol: string, closePrice: number): Promise<void>
}

export interface OrdersRepo {
  insert(o: Order): Promise<void>
  getByDate(date: string): Promise<Order[]>
}

export interface CandidatesRepo {
  insertBatch(cs: Candidate[]): Promise<void>
}

export interface PnlRepo {
  upsert(row: DailyPnl): Promise<void>
  getAll(): Promise<DailyPnl[]>
}

export interface StorageRepo {
  uploadReport(filename: string, html: string): Promise<string>  // returns public URL
}
