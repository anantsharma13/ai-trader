import 'dotenv/config'
import { logger } from './config/logger.js'
import { getConfig, getEnv } from './config/index.js'
import { createDataProvider, resolveTicker } from './data/index.js'
import { createResearchProvider } from './research/index.js'
import { createDb } from './db/index.js'
import { createEngine } from './engine/index.js'
import type { OrderIntent as EngineOrderIntent } from './engine/index.js'
import { createModel } from './llm/index.js'
import { createAgentSuite } from './agents/index.js'
import type { DiscoveryOutput } from './agents/discovery.js'
import type { TechnicalOutput } from './agents/technical.js'
import type { MacroOutput } from './agents/macro.js'
import type { ConsensusOutput } from './agents/consensus.js'
import type { PortfolioManagerOutput } from './agents/portfolioManager.js'
import { generateReport } from './report/index.js'
import type { AgentResult } from '@strands-agents/sdk'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const AGENT_TIMEOUT_MS = 60_000

async function invokeAgent(agent: { invoke(prompt: string): Promise<AgentResult> }, prompt: string, label: string): Promise<AgentResult> {
  return Promise.race([
    agent.invoke(prompt),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label}: agent timed out after ${AGENT_TIMEOUT_MS}ms`)), AGENT_TIMEOUT_MS),
    ),
  ])
}

/**
 * Extract typed structured output from an AgentResult, falling back to
 * parsing the AgentResult.toString() as JSON when structuredOutput is absent.
 * AgentResult.toString() surfaces structuredOutput JSON, then text blocks —
 * matching the priority we need for the fallback path.
 */
function extractOutput<T>(result: AgentResult, label: string): T {
  if (result.structuredOutput !== undefined) {
    return result.structuredOutput as T
  }
  // Fall back: use SDK toString() which extracts text from content blocks
  const raw = result.toString()
  if (!raw) {
    throw new Error(`${label}: agent returned no text content and no structuredOutput`)
  }
  try {
    return JSON.parse(raw) as T
  } catch (parseErr) {
    throw new Error(`${label}: failed to parse lastMessage as JSON — ${String(parseErr)}\nraw: ${raw.slice(0, 200)}`)
  }
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run')
  const runDate = new Date().toISOString().slice(0, 10)

  logger.info({ op: 'orchestrator', runDate, isDryRun }, 'orchestrator entry')

  // -------------------------------------------------------------------------
  // 1. Load config + env — fatal on invalid
  // -------------------------------------------------------------------------
  let config: ReturnType<typeof getConfig>
  try {
    config = getConfig()
    getEnv() // validate env vars; throws on missing
  } catch (err) {
    logger.fatal({ op: 'startup', err }, 'invalid config or env — cannot start')
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // 2. Create all providers via factories
  // -------------------------------------------------------------------------
  const dataProvider = createDataProvider()
  const researchProvider = createResearchProvider()
  const db = createDb()
  const engine = createEngine(config, db, dataProvider)

  // -------------------------------------------------------------------------
  // 3. Create model and agent suite
  // -------------------------------------------------------------------------
  const model = createModel()
  const agents = createAgentSuite(model, dataProvider, researchProvider, db)

  // -------------------------------------------------------------------------
  // Step 1: Discovery
  // -------------------------------------------------------------------------
  logger.info({ op: 'step.discovery', runDate }, 'step.discovery entry')
  const discoveryStart = Date.now()
  let discoveryOutput: DiscoveryOutput

  try {
    const prompt = `Scan RSS feeds and Google News for Indian stock market news from ${runDate}. Identify 10-15 Nifty 50 or Next 50 stocks with news catalysts today.`
    const result = await invokeAgent(agents.discovery, prompt, 'discovery')
    discoveryOutput = extractOutput<DiscoveryOutput>(result, 'discovery')
    logger.info(
      { op: 'step.discovery', ms: Date.now() - discoveryStart, candidateCount: discoveryOutput.candidates.length },
      'step.discovery exit',
    )
  } catch (err) {
    logger.error({ op: 'step.discovery', ms: Date.now() - discoveryStart, err }, 'discovery step failed')
    throw err
  }

  // Resolve candidate names to NSE ticker symbols
  const resolvedSymbols: string[] = []
  for (const candidate of discoveryOutput.candidates) {
    const ticker = resolveTicker(candidate.name)
    if (ticker !== null) {
      resolvedSymbols.push(ticker)
    } else {
      logger.warn({ op: 'resolveTicker', name: candidate.name }, 'could not resolve ticker — skipping')
    }
  }

  if (resolvedSymbols.length === 0) {
    logger.warn({ op: 'step.discovery' }, 'no symbols resolved from discovery — pipeline will run with empty candidate list')
  }

  logger.info({ op: 'resolveTicker', resolvedCount: resolvedSymbols.length, symbols: resolvedSymbols }, 'tickers resolved')

  // -------------------------------------------------------------------------
  // Step 2: Technical analysis
  // -------------------------------------------------------------------------
  logger.info({ op: 'step.technical', runDate, symbolCount: resolvedSymbols.length }, 'step.technical entry')
  const technicalStart = Date.now()
  let technicalOutput: TechnicalOutput

  try {
    const prompt = `Perform technical analysis for the following NSE symbols: ${JSON.stringify(resolvedSymbols)}. Use the available tools to fetch quotes, history, and indicators.`
    const result = await invokeAgent(agents.technical, prompt, 'technical')
    technicalOutput = extractOutput<TechnicalOutput>(result, 'technical')
    logger.info(
      { op: 'step.technical', ms: Date.now() - technicalStart, ratingCount: technicalOutput.ratings.length },
      'step.technical exit',
    )
  } catch (err) {
    logger.error({ op: 'step.technical', ms: Date.now() - technicalStart, err }, 'technical step failed')
    throw err
  }

  // -------------------------------------------------------------------------
  // Step 3: Macro analysis
  // -------------------------------------------------------------------------
  logger.info({ op: 'step.macro', runDate }, 'step.macro entry')
  const macroStart = Date.now()
  let macroOutput: MacroOutput

  try {
    const prompt = `Assess current Indian macro-economic and sector conditions for ${runDate}. Identify systemic risks and determine whether new long positions should be taken today.`
    const result = await invokeAgent(agents.macro, prompt, 'macro')
    macroOutput = extractOutput<MacroOutput>(result, 'macro')
    logger.info(
      { op: 'step.macro', ms: Date.now() - macroStart, riskLevel: macroOutput.riskLevel, allowNewLongs: macroOutput.allowNewLongs },
      'step.macro exit',
    )
  } catch (err) {
    logger.error({ op: 'step.macro', ms: Date.now() - macroStart, err }, 'macro step failed')
    throw err
  }


  // -------------------------------------------------------------------------
  // Step 4: Consensus
  // -------------------------------------------------------------------------
  logger.info({ op: 'step.consensus', runDate }, 'step.consensus entry')
  const consensusStart = Date.now()
  let consensusOutput: ConsensusOutput

  try {
    const consensusInput = JSON.stringify({ discovery: discoveryOutput, technical: technicalOutput, macro: macroOutput })
    const result = await invokeAgent(agents.consensus, consensusInput, 'consensus')
    consensusOutput = extractOutput<ConsensusOutput>(result, 'consensus')

    // Filter to top N per config
    consensusOutput = {
      recommendations: consensusOutput.recommendations
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, config.topN),
    }

    logger.info(
      { op: 'step.consensus', ms: Date.now() - consensusStart, recommendationCount: consensusOutput.recommendations.length },
      'step.consensus exit',
    )
  } catch (err) {
    logger.error({ op: 'step.consensus', ms: Date.now() - consensusStart, err }, 'consensus step failed')
    throw err
  }

  // -------------------------------------------------------------------------
  // Step 5: Portfolio manager → OrderIntents
  // -------------------------------------------------------------------------
  logger.info({ op: 'step.portfolioManager', runDate }, 'step.portfolioManager entry')
  const pmStart = Date.now()
  let pmOutput: PortfolioManagerOutput

  try {
    const pmInput = JSON.stringify({
      consensus: consensusOutput,
      config: {
        maxPositionPct: config.maxPositionPct,
        maxPositions: config.maxPositions,
        startingCapital: config.startingCapital,
      },
    })
    const result = await invokeAgent(agents.portfolioManager, pmInput, 'portfolioManager')
    pmOutput = extractOutput<PortfolioManagerOutput>(result, 'portfolioManager')
    logger.info(
      { op: 'step.portfolioManager', ms: Date.now() - pmStart, intentCount: pmOutput.intents.length },
      'step.portfolioManager exit',
    )
  } catch (err) {
    logger.error({ op: 'step.portfolioManager', ms: Date.now() - pmStart, err }, 'portfolioManager step failed')
    throw err
  }

  // Normalize side to uppercase for the engine layer (portfolioManager uses 'buy'/'sell')
  let rawIntents: EngineOrderIntent[] = pmOutput.intents.map((i) => ({
    ...i,
    side: i.side.toUpperCase() as 'BUY' | 'SELL',
  }))

  // Enforce macro gate — block new BUY intents when macro flags high risk
  if (macroOutput.riskLevel === 'high' && !macroOutput.allowNewLongs) {
    const before = rawIntents.length
    rawIntents = rawIntents.filter(i => i.side !== 'BUY')
    logger.warn(
      { op: 'step.macroGate', blocked: before - rawIntents.length },
      'macro HIGH — blocked all new buy intents',
    )
  }

  // -------------------------------------------------------------------------
  // Step 6: Risk gate + fill orders
  // -------------------------------------------------------------------------
  if (isDryRun) {
    logger.info(
      { op: 'step.riskGate', isDryRun, intentCount: rawIntents.length },
      '[DRY RUN] would apply risk gate and fill orders',
    )
    for (const intent of rawIntents) {
      logger.info(
        { op: 'dryRun.intent', symbol: intent.symbol, side: intent.side, qty: intent.qty, confidence: intent.confidence },
        `[DRY RUN] would execute: ${intent.side} ${intent.qty} x ${intent.symbol}`,
      )
    }
  } else {
    logger.info({ op: 'step.riskGate', intentCount: rawIntents.length }, 'step.riskGate entry')
    const riskStart = Date.now()

    let portfolio: { cash: number; startingCapital: number }
    let openPositions: Array<{ symbol: string; qty: number; avgPrice: number }>
    try {
      ;[portfolio, openPositions] = await Promise.all([
        db.portfolio.get(),
        db.positions.getOpen(),
      ])
    } catch (err) {
      logger.error({ op: 'step.riskGate', err }, 'failed to fetch portfolio/positions for risk gate')
      throw err
    }

    // Fetch current quotes for all BUY intents (needed by risk gate)
    const buySymbols = [...new Set(rawIntents.filter(i => i.side === 'BUY').map(i => i.symbol))]
    const quotes = new Map<string, number>()
    for (const symbol of buySymbols) {
      try {
        const quote = await dataProvider.getQuote(symbol)
        quotes.set(symbol, quote.price)
      } catch (err) {
        logger.warn({ op: 'step.riskGate', symbol, err }, 'failed to fetch quote for risk gate — symbol may be rejected')
      }
    }

    const gateResult = engine.applyRiskGate(rawIntents, portfolio, openPositions, quotes, config)
    logger.info(
      {
        op: 'step.riskGate',
        ms: Date.now() - riskStart,
        approvedCount: gateResult.approved.length,
        rejectedCount: gateResult.rejected.length,
        rejected: gateResult.rejected.map(r => ({ symbol: r.intent.symbol, reason: r.reason })),
      },
      'step.riskGate exit',
    )

    // Idempotency: skip fill if orders already recorded for today (re-run protection)
    const existingOrders = await db.orders.getByDate(runDate)
    if (existingOrders.length > 0) {
      logger.warn(
        { op: 'step.fillOrders', existingCount: existingOrders.length, runDate },
        'orders already exist for today — skipping fill to prevent duplicate execution',
      )
    } else if (gateResult.approved.length > 0) {
      logger.info({ op: 'step.fillOrders', approvedCount: gateResult.approved.length }, 'step.fillOrders entry')
      const fillStart = Date.now()
      try {
        await engine.fillOrders(gateResult.approved, runDate)
        logger.info({ op: 'step.fillOrders', ms: Date.now() - fillStart }, 'step.fillOrders exit')
      } catch (err) {
        logger.error({ op: 'step.fillOrders', ms: Date.now() - fillStart, err }, 'fillOrders step failed')
        throw err
      }
    } else {
      logger.info({ op: 'step.fillOrders' }, 'no approved orders to fill')
    }

    // -----------------------------------------------------------------------
    // Step 7: Mark to market
    // -----------------------------------------------------------------------
    logger.info({ op: 'step.markToMarket', runDate }, 'step.markToMarket entry')
    const mtmStart = Date.now()
    let unrealizedPnl = 0
    try {
      const mtmResult = await engine.markToMarket(runDate)
      unrealizedPnl = mtmResult.unrealizedPnl
      logger.info(
        { op: 'step.markToMarket', ms: Date.now() - mtmStart, unrealizedPnl, autoSells: mtmResult.autoSells },
        'step.markToMarket exit',
      )
    } catch (err) {
      logger.error({ op: 'step.markToMarket', ms: Date.now() - mtmStart, err }, 'markToMarket step failed')
      throw err
    }

    // -----------------------------------------------------------------------
    // Step 8: Compute daily P&L
    // -----------------------------------------------------------------------
    logger.info({ op: 'step.computeDailyPnl', runDate }, 'step.computeDailyPnl entry')
    const pnlStart = Date.now()
    try {
      await engine.computeDailyPnl(unrealizedPnl, runDate)
      logger.info({ op: 'step.computeDailyPnl', ms: Date.now() - pnlStart }, 'step.computeDailyPnl exit')
    } catch (err) {
      logger.error({ op: 'step.computeDailyPnl', ms: Date.now() - pnlStart, err }, 'computeDailyPnl step failed')
      throw err
    }

    // -----------------------------------------------------------------------
    // Step 9: Generate HTML report
    // -----------------------------------------------------------------------
    logger.info({ op: 'step.generateReport', runDate }, 'step.generateReport entry')
    const reportStart = Date.now()
    try {
      const reportUrl = await generateReport(db, runDate)
      logger.info({ op: 'step.generateReport', ms: Date.now() - reportStart, reportUrl }, 'step.generateReport exit')
      logger.info({ reportUrl }, 'report available at URL')
    } catch (err) {
      logger.error({ op: 'step.generateReport', ms: Date.now() - reportStart, err }, 'generateReport step failed')
      // Non-fatal — report failure should not fail the trading run
      logger.warn({ op: 'step.generateReport' }, 'continuing despite report failure')
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const tradedSymbols = rawIntents.map(i => i.symbol)
  logger.info(
    {
      op: 'orchestrator',
      runDate,
      isDryRun,
      tradedSymbols,
      tradedCount: tradedSymbols.length,
      intentCount: rawIntents.length,
    },
    'orchestrator exit — pipeline complete',
  )
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((err: unknown) => {
    logger.fatal({ err }, 'orchestrator failed — unhandled error')
    process.exit(1)
  })
