import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ---------------------------------------------------------------------------
// Module-level cache — loaded once on first call
// ---------------------------------------------------------------------------
let _symbolMap: Record<string, string> | null = null

function getSymbolMap(): Record<string, string> {
  if (!_symbolMap) {
    const path = join(__dirname, 'nse-symbols.json')
    _symbolMap = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>
  }
  return _symbolMap
}

// ---------------------------------------------------------------------------
// Normalisation — lowercase, strip common suffixes, collapse whitespace
// ---------------------------------------------------------------------------
const STRIP_WORDS = /\b(ltd|limited|industries|industry|corporation|company|co|pvt|private|inc)\b/gi

function normalize(s: string): string {
  return s.toLowerCase().replace(STRIP_WORDS, '').replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Public resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a human-readable company name to its NSE ticker (e.g. "TATAMOTORS.NS").
 * Returns null if no match found.
 */
export function resolveTicker(name: string): string | null {
  const symbolMap = getSymbolMap()
  const normInput = normalize(name)

  // 1. Exact match on original key (case-insensitive)
  const exactKey = Object.keys(symbolMap).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  )
  if (exactKey) return symbolMap[exactKey]

  // 2. Fuzzy: find the key whose normalized form is a substring of input or vice-versa
  let bestKey: string | null = null
  let bestLen = 0

  for (const key of Object.keys(symbolMap)) {
    const normKey = normalize(key)
    if (normKey === '' || normInput === '') continue

    if (normInput.includes(normKey) || normKey.includes(normInput)) {
      // Prefer the longer match to avoid overly short keys grabbing wrong tickers
      if (normKey.length > bestLen) {
        bestLen = normKey.length
        bestKey = key
      }
    }
  }

  return bestKey ? symbolMap[bestKey] : null
}
