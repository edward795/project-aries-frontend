/**
 * periodFilter.js — shared period-filtering utilities used across all pages.
 */
export function periodStart(period) {
  const now = new Date()
  if (period === 'D') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'W') return new Date(now.getTime() - 7  * 86400000)
  if (period === 'M') return new Date(now.getTime() - 30 * 86400000)
  return null // Overall = no filter
}

export function filterByPeriod(items, period, dateField = null) {
  const start = periodStart(period)
  if (!start) return items
  return items.filter(x => {
    const raw = dateField
      ? x[dateField]
      : (x.updatedAt || x.updated_at || x.createdAt || x.created_at || x.syncedAt || null)
    if (!raw) return true // items with no date always pass through
    const d = new Date(raw)
    return !isNaN(d) && d >= start
  })
}

export function periodLabel(period) {
  if (period === 'D') return 'Today'
  if (period === 'W') return 'Last 7 Days'
  if (period === 'M') return 'Last 30 Days'
  return 'All Time'
}

export function periodShort(period) {
  if (period === 'D') return 'Daily'
  if (period === 'W') return 'Weekly'
  if (period === 'M') return 'Monthly'
  return 'Overall'
}
