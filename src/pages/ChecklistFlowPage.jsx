/**
 * ChecklistFlowPage
 *
 * Two sections inspired by the commissioning tracking slides:
 *
 * 1. CHECKLIST DISTRIBUTION TABLE
 *    Rows = checklist types (L3 Vendor, Red Tags, Yellow Tags, Green Tags, L2 Vendor, Unspecified)
 *    Columns = 5 CxAlloy workflow statuses + Total
 *    Each cell = count card with a mini progress bar
 *
 * 2. CHECKLIST STATUS TIMELINE
 *    5 circular nodes connected by progress arrows showing the pipeline
 *    Not Started → In Progress → Complete → Checklist Approved → Returned with Comments
 *    Below: Workflow Integrity Alerts + Outliers Detected
 *
 * Status tokens (backend now emits these 5 canonical values):
 *   not_started | in_progress | complete | checklist_approved | returned_with_comments
 */
import React, { useState, useEffect, useMemo } from 'react'
import { AlertTriangle, ArrowRight, CheckCircle2, RotateCcw, RefreshCw } from 'lucide-react'
import { useProject } from '../context/ProjectContext'
import { checklistsApi } from '../services/api'

// ─── Canonical 5-status pipeline ──────────────────────────────────────────────
const PIPELINE = [
  { key: 'not_started',          label: 'Not Started',          short: 'Not\nStarted',    color: '#64748b', ring: 'rgba(100,116,139,0.25)' },
  { key: 'in_progress',          label: 'In Progress',          short: 'In\nProgress',    color: '#f59e0b', ring: 'rgba(245,158,11,0.25)'  },
  { key: 'complete',             label: 'Complete',             short: 'Complete',         color: '#0ea5e9', ring: 'rgba(14,165,233,0.25)'  },
  { key: 'checklist_approved',   label: 'Checklist Approved',   short: 'Checklist\nApproved', color: '#22c55e', ring: 'rgba(34,197,94,0.25)'   },
  { key: 'returned_with_comments', label: 'Returned with Comments', short: 'Returned\nw/ Comments', color: '#ef4444', ring: 'rgba(239,68,68,0.25)'   },
]

// Row order for the distribution table — fixed, not sorted by count
const TYPE_ORDER = [
  'L3 Vendor', 'Red Tags', 'Yellow Tags', 'Green Tags', 'L2 Vendor', 'Unspecified',
]

// ─── Status normaliser (client-side, mirrors backend) ─────────────────────────
function normStatus(raw) {
  const s = (raw || '').toLowerCase().replace(/[ \-]/g, '_')
  if (s === 'checklist_approved' || s === 'approved' || s === 'signed_off' || s === 'accepted_by_owner') return 'checklist_approved'
  if (s.includes('returned') || s === 'rejected' || s === 'rework') return 'returned_with_comments'
  if (s === 'complete' || s === 'completed' || s === 'finished' || s === 'done' || s === 'closed') return 'complete'
  if (s === 'in_progress' || s === 'inprogress' || s === 'started' || s === 'active') return 'in_progress'
  if (s === 'not_started' || s === 'notstarted' || s === 'new' || s === 'open') return 'not_started'
  return 'not_started'
}

// ─── Checklist type classifier ─────────────────────────────────────────────────
function classifyType(c) {
  const src = (c.tagLevel || c.tag_level || c.checklistType || c.checklist_type || c.name || '').toLowerCase()
  if (/\bl3\b|level.?3|green/.test(src)) return 'L3 Vendor'
  if (/\bl1\b|level.?1|red/.test(src))   return 'Red Tags'
  if (/\bl2\b|level.?2|yellow/.test(src)) return 'Yellow Tags'
  if (/\bl4\b|level.?4|blue/.test(src))   return 'L2 Vendor'  // L4/Blue = L2 Vendor sign-off
  if (/green/.test(src))                   return 'Green Tags'
  if (/vendor|l3/.test(src))               return 'L3 Vendor'
  return 'Unspecified'
}

// ─── Period filter ─────────────────────────────────────────────────────────────
function filterByPeriod(items, period) {
  if (period === 'Overall') return items
  const now = new Date()
  const cutoff = period === 'D' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
    : period === 'W' ? new Date(now.getTime() - 7 * 86400000)
    : new Date(now.getTime() - 30 * 86400000)
  return items.filter(c => {
    const d = new Date(c.updatedAt || c.updated_at || c.createdAt || c.created_at || 0)
    return !isNaN(d) && d >= cutoff
  })
}

// ─── Core computation ──────────────────────────────────────────────────────────
function computeDistribution(checklists) {
  // type → status → count
  const matrix = {}
  TYPE_ORDER.forEach(t => {
    matrix[t] = {}
    PIPELINE.forEach(p => { matrix[t][p.key] = 0 })
    matrix[t]._total = 0
  })

  // Overall status counts for timeline
  const statusTotals = {}
  PIPELINE.forEach(p => { statusTotals[p.key] = 0 })

  // Workflow integrity: items that skipped a required prior step
  const alerts = { complete: 0, in_progress: 0, not_started: 0, checklist_approved: 0 }
  // Outliers: completed in < 12 hours
  let outliers = 0

  checklists.forEach(c => {
    const type   = classifyType(c)
    const status = normStatus(c.status)
    const row    = matrix[type] || matrix['Unspecified']

    row[status] = (row[status] || 0) + 1
    row._total++
    statusTotals[status] = (statusTotals[status] || 0) + 1

    // Workflow integrity: checklist_approved but was never in_progress
    if (status === 'checklist_approved' && !c.updatedAt && !c.completedDate) alerts.checklist_approved++
    // Items stuck in_progress > 21 days
    const age = (new Date() - new Date(c.updatedAt || c.created_at || 0)) / 86400000
    if (status === 'in_progress' && age > 21) alerts.in_progress++
    // Outlier: very fast completion
    if ((status === 'complete' || status === 'checklist_approved') && c.createdAt && c.completedDate) {
      const hrs = (new Date(c.completedDate) - new Date(c.createdAt)) / 3600000
      if (hrs > 0 && hrs < 12) outliers++
    }
  })

  const totalAlerts = Object.values(alerts).reduce((s, v) => s + v, 0)
  const grandTotal  = checklists.length

  // Column totals row
  const colTotals = {}
  PIPELINE.forEach(p => {
    colTotals[p.key] = TYPE_ORDER.reduce((s, t) => s + (matrix[t][p.key] || 0), 0)
  })
  colTotals._total = grandTotal

  return { matrix, statusTotals, colTotals, grandTotal, totalAlerts, alerts, outliers }
}

// ─── Hooks ─────────────────────────────────────────────────────────────────────
function useChecklistData() {
  const { selectedProjects, activeProject, period } = useProject()
  const targets = selectedProjects.length > 0 ? selectedProjects : (activeProject ? [activeProject] : [])
  const [raw, setRaw] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!targets.length) return
    setLoading(true)
    Promise.all(targets.map(p =>
      checklistsApi.getAll(p.externalId).then(r => r.data?.data || []).catch(() => [])
    )).then(res => setRaw(res.flat())).finally(() => setLoading(false))
  }, [targets.map(p => p.externalId).join(',')])  // eslint-disable-line

  const checklists = useMemo(() => filterByPeriod(raw, period), [raw, period])
  return { checklists, loading, count: raw.length }
}

// ─── Cell card component ───────────────────────────────────────────────────────
function DistCell({ count, total, statusKey, isTotal }) {
  const st = PIPELINE.find(p => p.key === statusKey)
  const pct = total > 0 ? Math.round(count / total * 100) : 0

  if (isTotal) {
    return (
      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
        <div style={{
          background: 'rgba(59,130,246,0.12)',
          border: '1px solid rgba(59,130,246,0.25)',
          borderRadius: 8, padding: '10px 6px', minWidth: 56,
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#60a5fa', lineHeight: 1 }}>{count.toLocaleString()}</div>
          <div style={{ height: 2, background: 'rgba(96,165,250,0.3)', borderRadius: 1, marginTop: 5 }}>
            <div style={{ height: '100%', width: '100%', background: '#3b82f6', borderRadius: 1 }} />
          </div>
        </div>
      </td>
    )
  }

  if (count === 0) {
    return (
      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
        <div style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.04)',
          borderRadius: 8, padding: '10px 6px', minWidth: 56,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#334155', lineHeight: 1 }}>0</div>
          <div style={{ height: 2, background: 'rgba(255,255,255,0.04)', borderRadius: 1, marginTop: 5 }} />
        </div>
      </td>
    )
  }

  const color = st?.color || '#64748b'
  return (
    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
      <div style={{
        background: `${color}14`,
        border: `1px solid ${color}30`,
        borderRadius: 8, padding: '10px 6px', minWidth: 56,
        transition: 'all 0.15s',
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color, lineHeight: 1 }}>{count.toLocaleString()}</div>
        <div style={{ height: 2, background: 'rgba(255,255,255,0.07)', borderRadius: 1, marginTop: 5, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 1, transition: 'width 0.6s ease' }} />
        </div>
      </div>
    </td>
  )
}

// ─── Timeline node ─────────────────────────────────────────────────────────────
function TimelineNode({ stage, count, total, isLast }) {
  const pct = total > 0 ? Math.round(count / total * 100) : 0
  // Ring progress: stroke-dasharray trick
  const R = 38, C = 2 * Math.PI * R
  const dash = (pct / 100) * C

  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
        {/* Circle with progress ring */}
        <div style={{ position: 'relative', width: 96, height: 96, marginBottom: 12 }}>
          <svg width="96" height="96" style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
            <circle cx="48" cy="48" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
            <circle cx="48" cy="48" r={R} fill="none"
              stroke={stage.color} strokeWidth="4"
              strokeDasharray={`${dash} ${C}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.8s ease' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 8,
            borderRadius: '50%',
            background: `${stage.color}15`,
            border: `1px solid ${stage.color}30`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: stage.color, lineHeight: 1 }}>
              {count.toLocaleString()}
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#64748b', marginTop: 2 }}>{pct}%</div>
          </div>
        </div>

        {/* Label + item count */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 3, whiteSpace: 'pre-line' }}>
            {stage.short}
          </div>
          <div style={{ fontSize: 10, color: '#64748b' }}>{count.toLocaleString()} items</div>
        </div>
      </div>

      {/* Arrow connector */}
      {!isLast && (
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 4px', marginBottom: 28 }}>
          <ArrowRight size={18} color="#334155" />
        </div>
      )}
    </div>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function ChecklistFlowPage() {
  const { checklists, loading, count: rawCount } = useChecklistData()
  const { period } = useProject()
  const [hideEmpty, setHideEmpty] = useState(false)

  const dist = useMemo(() => computeDistribution(checklists), [checklists])

  const periodLabel = period === 'D' ? 'Today' : period === 'W' ? 'This Week' : period === 'M' ? 'This Month' : 'All Time'

  const visibleTypes = hideEmpty
    ? TYPE_ORDER.filter(t => dist.matrix[t]._total > 0)
    : TYPE_ORDER

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, height: 320,
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', gap: 10 }}>
        <RefreshCw size={18} style={{ animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13 }}>Loading checklist data…</span>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Checklist Flow</h2>
          <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
            {rawCount.toLocaleString()} items · {visibleTypes.length} types · 5 statuses
            <span style={{ marginLeft: 10, padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
              background: 'rgba(14,165,233,0.1)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.2)' }}>
              {periodLabel}
            </span>
          </p>
        </div>
        {/* Hide empty toggle */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: '#64748b' }}>
          <div
            onClick={() => setHideEmpty(v => !v)}
            style={{
              width: 36, height: 20, borderRadius: 999,
              background: hideEmpty ? '#0ea5e9' : '#1e293b',
              border: `1px solid ${hideEmpty ? '#0ea5e9' : 'rgba(255,255,255,0.1)'}`,
              position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
            }}>
            <div style={{
              position: 'absolute', top: 2, left: hideEmpty ? 17 : 2,
              width: 14, height: 14, borderRadius: '50%', background: 'white',
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
            }} />
          </div>
          Hide empty rows
        </label>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 1: CHECKLIST DISTRIBUTION TABLE
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
        {/* Card header */}
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
              Checklist Distribution
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Count by checklist type × workflow status
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Total: <strong style={{ color: 'var(--text-primary)' }}>{dist.grandTotal.toLocaleString()}</strong>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
            <colgroup>
              <col style={{ width: '18%' }} />
              {PIPELINE.map(p => <col key={p.key} style={{ width: '14%' }} />)}
              <col style={{ width: '10%' }} />
            </colgroup>

            {/* Column headers */}
            <thead>
              <tr style={{ background: 'var(--bg-card-light)' }}>
                <th style={thStyle()}>Checklist Type</th>
                {PIPELINE.map(p => (
                  <th key={p.key} style={{ ...thStyle(), color: p.color, textAlign: 'center' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      {/* Coloured underline bar */}
                      <div style={{ width: 24, height: 3, background: p.color, borderRadius: 2, marginBottom: 4 }} />
                      {p.label.toUpperCase()}
                    </div>
                  </th>
                ))}
                <th style={{ ...thStyle(), textAlign: 'center', color: '#60a5fa' }}>TOTAL</th>
              </tr>
            </thead>

            <tbody>
              {visibleTypes.map((typeName, rowIdx) => {
                const row  = dist.matrix[typeName]
                const rowTotal = row._total
                return (
                  <tr key={typeName} style={{
                    background: rowIdx % 2 === 1 ? 'rgba(255,255,255,0.012)' : 'transparent',
                    borderTop: '1px solid var(--divider)',
                  }}>
                    {/* Row label */}
                    <td style={{ padding: '6px 12px 6px 20px' }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{typeName}</div>
                      <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{rowTotal} total</div>
                    </td>
                    {/* Status cells */}
                    {PIPELINE.map(p => (
                      <DistCell key={p.key} count={row[p.key] || 0} total={rowTotal} statusKey={p.key} />
                    ))}
                    {/* Row total */}
                    <DistCell count={rowTotal} total={dist.grandTotal} isTotal />
                  </tr>
                )
              })}

              {/* Grand total row */}
              {dist.grandTotal > 0 && (
                <tr style={{ borderTop: '2px solid var(--border)', background: 'rgba(255,255,255,0.03)' }}>
                  <td style={{ padding: '10px 12px 10px 20px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 1 }}>{dist.grandTotal.toLocaleString()} checklists</div>
                  </td>
                  {PIPELINE.map(p => (
                    <DistCell key={p.key} count={dist.colTotals[p.key] || 0} total={dist.grandTotal} statusKey={p.key} />
                  ))}
                  <DistCell count={dist.grandTotal} total={dist.grandTotal} isTotal />
                </tr>
              )}

              {dist.grandTotal === 0 && (
                <tr><td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
                  No checklist data for this period. Sync a project first.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════
          SECTION 2: CHECKLIST STATUS TIMELINE
      ════════════════════════════════════════════════════════════════════ */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '22px 24px' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Checklist Status Timeline
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 28 }}>
          Track checklist progression and bottlenecks ({dist.grandTotal.toLocaleString()} total)
        </div>

        {/* Pipeline nodes */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto', paddingBottom: 8 }}>
          {PIPELINE.map((stage, i) => (
            <TimelineNode
              key={stage.key}
              stage={stage}
              count={dist.statusTotals[stage.key] || 0}
              total={dist.grandTotal}
              isLast={i === PIPELINE.length - 1}
            />
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'var(--divider)', margin: '24px 0' }} />

        {/* Workflow Integrity Alerts */}
        <div style={{
          border: '1px solid rgba(245,158,11,0.25)',
          borderLeft: '4px solid #f59e0b',
          borderRadius: 10, padding: '16px 18px', marginBottom: 14,
          background: 'rgba(245,158,11,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={15} color="#f59e0b" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>Workflow Integrity Alerts</span>
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {dist.totalAlerts} deviation{dist.totalAlerts !== 1 ? 's' : ''} detected
            </span>
          </div>

          {/* Alert pill badges */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: dist.totalAlerts > 0 ? 10 : 0 }}>
            {PIPELINE.filter(p => p.key !== 'not_started').map(p => {
              const alertKey = p.key === 'returned_with_comments' ? 'checklist_approved' : p.key
              const n = dist.alerts[alertKey] || 0
              if (n === 0) return null
              return (
                <span key={p.key} style={{
                  fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                  background: `${p.color}15`, border: `1px solid ${p.color}35`, color: p.color,
                }}>
                  {p.label.toUpperCase()} +{n}
                </span>
              )
            }).filter(Boolean)}
            {dist.totalAlerts === 0 && (
              <span style={{ fontSize: 12, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 5 }}>
                <CheckCircle2 size={13} /> No workflow integrity issues detected
              </span>
            )}
          </div>

          {dist.totalAlerts > 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {dist.alerts.in_progress > 0 && `${dist.alerts.in_progress} checklist${dist.alerts.in_progress !== 1 ? 's' : ''} stuck in In Progress for 21+ days. `}
              {dist.alerts.checklist_approved > 0 && `${dist.alerts.checklist_approved} checklist${dist.alerts.checklist_approved !== 1 ? 's' : ''} approved without completion date recorded.`}
            </div>
          )}
        </div>

        {/* Outliers Detected */}
        <div style={{
          border: '1px solid rgba(239,68,68,0.2)',
          borderLeft: '4px solid #ef4444',
          borderRadius: 10, padding: '14px 18px',
          background: 'rgba(239,68,68,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <RotateCcw size={14} color="#ef4444" />
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>Outliers Detected</span>
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {dist.outliers} transition{dist.outliers !== 1 ? 's' : ''} outside normal range
            </span>
          </div>
          {dist.outliers > 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              {dist.outliers} checklist{dist.outliers !== 1 ? 's' : ''} completed in under 12 hours — verify these transitions are legitimate.
            </div>
          )}
          {dist.outliers === 0 && (
            <div style={{ fontSize: 12, color: '#22c55e', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
              <CheckCircle2 size={13} /> All completion timelines within normal range
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function thStyle() {
  return {
    padding: '12px 10px',
    fontSize: 9.5,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    textAlign: 'left',
    borderRight: '1px solid var(--divider)',
    background: 'var(--bg-card-light)',
    position: 'sticky',
    top: 0,
    whiteSpace: 'nowrap',
  }
}
