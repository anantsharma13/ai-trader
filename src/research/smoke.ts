import { createResearchProvider } from './index.js'

const p = createResearchProvider()
const etHeadlines = await p.getRssHeadlines('https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms')
console.log('ET headlines:', etHeadlines.slice(0, 3).map(h => h.title))
const gnHeadlines = await p.searchGoogleNews('Reliance Industries NSE India')
console.log('Google News:', gnHeadlines.slice(0, 3).map(h => h.title))
