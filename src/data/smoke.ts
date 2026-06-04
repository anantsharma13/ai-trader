import { createDataProvider } from './index.js'
const p = createDataProvider()
const q = await p.getQuote('RELIANCE.NS')
console.log('quote:', JSON.stringify(q))
const ind = await p.getIndicators('RELIANCE.NS')
console.log('indicators:', JSON.stringify(ind))
