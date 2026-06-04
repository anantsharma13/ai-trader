import { RssResearchProvider } from './providers/rss.js'
import type { ResearchProvider } from './types.js'

export { type ResearchProvider, type NewsItem } from './types.js'

export function createResearchProvider(): ResearchProvider {
  return new RssResearchProvider()
}
