import type { ReportData } from './types.js'

function fmtInr(value: number): string {
  return '₹' + value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtPct(value: number): string {
  return value.toFixed(2) + '%'
}

function colorPct(value: number): string {
  const color = value >= 0 ? '#22c55e' : '#ef4444'
  return `<span style="color:${color};font-family:monospace">${fmtPct(value)}</span>`
}

export function buildHtmlReport(data: ReportData): string {
  const ordersRows = data.todayOrders.map(o => `
    <tr>
      <td>${o.symbol}</td>
      <td style="color:${o.side === 'BUY' ? '#22c55e' : '#ef4444'}">${o.side}</td>
      <td style="font-family:monospace">${o.qty}</td>
      <td style="font-family:monospace">${o.fillPrice != null ? fmtInr(o.fillPrice) : '—'}</td>
      <td style="font-family:monospace">${o.confidence != null ? fmtPct(o.confidence * 100) : '—'}</td>
      <td>${o.rationale ?? '—'}</td>
    </tr>`).join('')

  const positionsRows = data.openPositions.map(p => `
    <tr>
      <td>${p.symbol}</td>
      <td style="font-family:monospace">${p.qty}</td>
      <td style="font-family:monospace">${fmtInr(p.avgPrice)}</td>
    </tr>`).join('')

  const pnlRows = data.pnlHistory.map(r => `
    <tr>
      <td>${r.date}</td>
      <td style="font-family:monospace">${fmtInr(r.portfolioValue)}</td>
      <td>${colorPct(r.dayReturnPct)}</td>
      <td>${colorPct(r.cumReturnPct)}</td>
    </tr>`).join('')

  const dayColor = data.dayReturnPct >= 0 ? '#22c55e' : '#ef4444'

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Trader Report — ${data.runDate}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; font-size: 14px; line-height: 1.5; }
    header { background: #0f172a; color: #f8fafc; padding: 24px 32px; display: flex; align-items: baseline; gap: 24px; }
    header h1 { font-size: 20px; font-weight: 700; letter-spacing: 0.02em; }
    header .pv { font-family: monospace; font-size: 22px; font-weight: 700; }
    header .day { font-family: monospace; font-size: 18px; font-weight: 600; color: ${dayColor}; }
    main { max-width: 1100px; margin: 32px auto; padding: 0 16px; display: flex; flex-direction: column; gap: 32px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
    .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
    .card .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .card .value { font-family: monospace; font-size: 20px; font-weight: 700; }
    section { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
    section h2 { font-size: 14px; font-weight: 600; padding: 14px 20px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #f8fafc; text-align: left; padding: 10px 16px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; border-bottom: 1px solid #e2e8f0; }
    td { padding: 10px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: #f8fafc; }
    .empty { padding: 20px 16px; color: #94a3b8; font-style: italic; }
  </style>
</head>
<body>
  <header>
    <h1>AI Trader Report — ${data.runDate}</h1>
    <span class="pv">${fmtInr(data.portfolioValue)}</span>
    <span class="day">${data.dayReturnPct >= 0 ? '+' : ''}${fmtPct(data.dayReturnPct)}</span>
  </header>
  <main>
    <div class="cards">
      <div class="card">
        <div class="label">Portfolio Value</div>
        <div class="value">${fmtInr(data.portfolioValue)}</div>
      </div>
      <div class="card">
        <div class="label">Cash</div>
        <div class="value">${fmtInr(data.cash)}</div>
      </div>
      <div class="card">
        <div class="label">Day Return</div>
        <div class="value" style="color:${dayColor}">${data.dayReturnPct >= 0 ? '+' : ''}${fmtPct(data.dayReturnPct)}</div>
      </div>
      <div class="card">
        <div class="label">Cumulative Return</div>
        <div class="value" style="color:${data.cumReturnPct >= 0 ? '#22c55e' : '#ef4444'}">${data.cumReturnPct >= 0 ? '+' : ''}${fmtPct(data.cumReturnPct)}</div>
      </div>
    </div>

    <section>
      <h2>Today's Orders</h2>
      ${data.todayOrders.length === 0
        ? '<p class="empty">No orders placed today.</p>'
        : `<table>
        <thead><tr><th>Symbol</th><th>Side</th><th>Qty</th><th>Fill Price</th><th>Confidence</th><th>Rationale</th></tr></thead>
        <tbody>${ordersRows}</tbody>
      </table>`}
    </section>

    <section>
      <h2>Open Positions</h2>
      ${data.openPositions.length === 0
        ? '<p class="empty">No open positions.</p>'
        : `<table>
        <thead><tr><th>Symbol</th><th>Qty</th><th>Avg Price</th></tr></thead>
        <tbody>${positionsRows}</tbody>
      </table>`}
    </section>

    <section>
      <h2>P&amp;L History (last 30 days)</h2>
      ${data.pnlHistory.length === 0
        ? '<p class="empty">No P&amp;L history available.</p>'
        : `<table>
        <thead><tr><th>Date</th><th>Portfolio Value</th><th>Day Return %</th><th>Cumulative Return %</th></tr></thead>
        <tbody>${pnlRows}</tbody>
      </table>`}
    </section>
  </main>
</body>
</html>`
}
