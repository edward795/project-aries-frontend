/**
 * AssetReadinessPage — three-tab layout matching modum.me screenshots:
 *
 *  Tab 1: Status & Timeline  — status progression circles + momentum chart
 *  Tab 2: Equipment Matrix   — cross-reference table (EquipmentChecklistMatrix)
 *  Tab 3: Risk Analytics     — equipment risk cards with score, staleness, priority
 *
 * Backend APIs used:
 *  GET /api/equipment?projectId=X        — equipment list (status, type, discipline, counts)
 *  GET /api/equipment/matrix?projectId=X — matrix DTO for Tab 2
 *  GET /api/equipment/live?projectId=X   — fallback when DB empty
 */
import React, { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { Search } from 'lucide-react'
import { useProject } from '../context/ProjectContext'
import { equipmentApi } from '../services/api'
import EquipmentChecklistMatrix from '../components/ui/EquipmentChecklistMatrix'

// ─── Constants ────────────────────────────────────────────────────────────────
const STATUS_ORDER = ['Not Assigned','Asset Assigned','Pre-Cx','Cx In Progress','Cx Complete','Ready For Startup','In Service']
const DONE_STATUSES = new Set(['Cx Complete','Ready For Startup','In Service'])
const TABS = ['Status & Timeline', 'Equipment Matrix', 'Risk Analytics']

// Risk level thresholds (from screenshot: Critical/High/Medium/Low/Blocking/Urgent/Stale)
const RISK_LEVELS = [
  { key: 'Critical', color: '#ef4444', bg: 'rgba(239,68,68,0.15)',   min: 80 },
  { key: 'High',     color: '#f97316', bg: 'rgba(249,115,22,0.15)',  min: 60 },
  { key: 'Medium',   color: '#eab308', bg: 'rgba(234,179,8,0.15)',   min: 40 },
  { key: 'Low',      color: '#22c55e', bg: 'rgba(34,197,94,0.15)',   min: 0  },
]

// ─── Status normaliser — maps backend tokens to display names ─────────────────
function normStatus(e) {
  const raw = e.status || e.equipmentStatus || ''
  if (STATUS_ORDER.includes(raw)) return raw
  const s = raw.toLowerCase().replace(/ /g,'_').replace(/-/g,'_')
  if (!s || s.includes('not_assigned') || s === 'unassigned') return 'Not Assigned'
  if (s.includes('asset_assigned') || (s.includes('assigned') && !s.includes('not'))) return 'Asset Assigned'
  if (s.includes('pre_cx') || s.includes('precx')) return 'Pre-Cx'
  if (s.includes('cx_in') || (s.includes('in_progress') && s.includes('cx'))) return 'Cx In Progress'
  if (s.includes('cx_complete') || s.includes('cx_done')) return 'Cx Complete'
  if (s.includes('ready') || s.includes('startup')) return 'Ready For Startup'
  if (s.includes('in_service') || s.includes('commissioned')) return 'In Service'
  return 'Not Assigned'
}

// ─── Stale days: days since last update ──────────────────────────────────────
function staleDays(e) {
  const now = new Date()
  const d = new Date(e.updatedAt || e.updated_at || e.createdAt || e.created_at || e.syncedAt || now)
  return isNaN(d) ? 0 : Math.max(0, Math.round((now - d) / 86400000))
}

// ─── Risk score computation (0-100) ──────────────────────────────────────────
// Mirrors the screenshot: score 100 = Critical, stale 149d, P1-Critical
function computeRiskScore(e, stale) {
  const statusIdx  = STATUS_ORDER.indexOf(normStatus(e))
  const stateScore = statusIdx === -1 ? 100 : Math.round((1 - statusIdx / (STATUS_ORDER.length - 1)) * 60)
  const staleScore = Math.min(30, Math.round(stale / 5))
  const issueScore = Math.min(10, (e.issueCount || 0) * 2)
  return Math.min(100, stateScore + staleScore + issueScore)
}

function riskLevel(score) {
  for (const lv of RISK_LEVELS) if (score >= lv.min) return lv
  return RISK_LEVELS[RISK_LEVELS.length - 1]
}

function riskPriority(score) {
  if (score >= 80) return 'P1 - Critical'
  if (score >= 60) return 'P2 - High'
  if (score >= 40) return 'P3 - Medium'
  return 'P4 - Low'
}

// ─── ISO week helper ──────────────────────────────────────────────────────────
function isoWeekLabel(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
  const yr = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const wk = Math.ceil((((tmp - yr) / 86400000) + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(wk).padStart(2,'0')}`
}

// ─── Build all computed data from equipment list ──────────────────────────────
function computeAll(equipment) {
  if (!equipment.length) return null
  const now = new Date()

  // Status distribution
  const statusCounts = new Map()
  STATUS_ORDER.forEach(s => statusCounts.set(s, 0))
  equipment.forEach(e => {
    const s = normStatus(e)
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1)
  })

  const total = equipment.length
  const doneCount = equipment.filter(e => DONE_STATUSES.has(normStatus(e))).length
  const completionPct = +(doneCount / total * 100).toFixed(1)

  // Equipment with risk scores
  const withRisk = equipment.map(e => {
    const stale = staleDays(e)
    const score = computeRiskScore(e, stale)
    return { ...e, _status: normStatus(e), _stale: stale, _score: score, _priority: riskPriority(score) }
  }).sort((a, b) => b._score - a._score)

  // Risk category counts (screenshot shows: Critical 204, High 0, Medium 0, Low 0, Blocking 204, Urgent 22, Stale 204)
  const criticalCount  = withRisk.filter(e => e._score >= 80).length
  const highCount      = withRisk.filter(e => e._score >= 60 && e._score < 80).length
  const mediumCount    = withRisk.filter(e => e._score >= 40 && e._score < 60).length
  const lowCount       = withRisk.filter(e => e._score < 40).length
  const blockingCount  = withRisk.filter(e => (e.issueCount || 0) > 0).length
  const urgentCount    = withRisk.filter(e => e._stale > 7 && e._score >= 60).length
  const staleCount     = withRisk.filter(e => e._stale > 30).length

  // Momentum chart — weekly cumulative
  const createdDates = equipment.map(e => new Date(e.createdAt || e.created_at || e.syncedAt || now)).filter(d => !isNaN(d))
  const minDate = createdDates.length ? new Date(Math.min(...createdDates)) : new Date(now.getTime() - 10 * 7 * 86400000)
  const weekStarts = []
  const cur = new Date(minDate)
  cur.setDate(cur.getDate() - ((cur.getDay() + 6) % 7)) // prev Monday
  while (cur <= now && weekStarts.length < 14) { weekStarts.push(new Date(cur)); cur.setDate(cur.getDate() + 7) }

  const momentumData = weekStarts.map(wkStart => {
    const wkEnd = new Date(wkStart.getTime() + 7 * 86400000)
    const label = isoWeekLabel(wkStart).replace('20','')
    const allByWeek = equipment.filter(e => new Date(e.createdAt || e.created_at || e.syncedAt || now) <= wkEnd).length
    const doneByWeek = equipment.filter(e => {
      const d = new Date(e.createdAt || e.created_at || e.syncedAt || now)
      if (d > wkEnd) return false
      const upd = new Date(e.updatedAt || e.updated_at || e.syncedAt || now)
      return DONE_STATUSES.has(normStatus(e)) && upd <= wkEnd
    }).length
    return { week: label, all: allByWeek, cumulative: allByWeek - doneByWeek }
  })

  return {
    total, doneCount, completionPct, statusCounts, withRisk,
    criticalCount, highCount, mediumCount, lowCount,
    blockingCount, urgentCount, staleCount,
    momentumData,
  }
}

// ─── Data hooks ───────────────────────────────────────────────────────────────
function useEquipmentData() {
  const { selectedProjects, activeProject } = useProject()
  const targets = selectedProjects.length > 0 ? selectedProjects : (activeProject ? [activeProject] : [])
  const [equipment, setEquipment] = useState([])
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)

  useEffect(() => {
    if (!targets.length) { setEquipment([]); return }
    setLoading(true); setError(null)
    Promise.all(targets.map(p =>
      equipmentApi.getAll(p.externalId).then(r => r.data?.data || []).catch(() => [])
    ))
    .then(async results => {
      const flat = results.flat()
      if (flat.length > 0) { setEquipment(flat); setLoading(false); return }
      // Fallback: live fetch when DB empty
      try {
        const live = await Promise.all(targets.map(p => equipmentApi.getLive(p.externalId).then(r => r.data?.data || []).catch(() => [])))
        setEquipment(live.flat())
      } catch { setEquipment([]) }
      setLoading(false)
    })
    .catch(e => { setError(e.message); setEquipment([]); setLoading(false) })
  }, [targets.map(p => p.externalId).join(',')])

  return { equipment, loading, error }
}

function useMatrixData() {
  const { selectedProjects, activeProject } = useProject()
  const targets = selectedProjects.length > 0 ? selectedProjects : (activeProject ? [activeProject] : [])
  const [matrix, setMatrix]         = useState(null)
  const [matrixLoading, setLoading] = useState(false)

  useEffect(() => {
    if (!targets.length) { setMatrix(null); return }
    setLoading(true)
    equipmentApi.getMatrix(targets[0].externalId)
      .then(r => { setMatrix(r.data?.data || null); setLoading(false) })
      .catch(() => { setMatrix(null); setLoading(false) })
  }, [targets.map(p => p.externalId).join(',')])

  return { matrix, matrixLoading }
}

// ─── Status & Timeline Tab ────────────────────────────────────────────────────
const STATUS_COLORS = {
  'Not Assigned':     '#475569',
  'Asset Assigned':   '#64748b',
  'Pre-Cx':           '#f59e0b',
  'Cx In Progress':   '#3b82f6',
  'Cx Complete':      '#22c55e',
  'Ready For Startup':'#4ade80',
  'In Service':       '#a78bfa',
}

// ─── Status & Timeline Tab — matches slides 12 & 13 ──────────────────────────
// Slide 12: Equipment Status Distribution — horizontal bar rows per commissioning level
// Slide 13: Equipment Status Timeline — circular progress nodes + Workflow Integrity Alerts

function StatusTimelineNode({ status, count, total, color, isLast }) {
  const pct = total > 0 ? Math.round(count / total * 100) : 0
  const R = 34, circum = 2 * Math.PI * R
  const dash = (pct / 100) * circum

  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1 }}>
        <div style={{ position: 'relative', width: 86, height: 86, marginBottom: 10 }}>
          <svg width="86" height="86" style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
            <circle cx="43" cy="43" r={R} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
            <circle cx="43" cy="43" r={R} fill="none"
              stroke={color} strokeWidth="4"
              strokeDasharray={`${dash} ${circum}`}
              strokeLinecap="round"
              style={{ transition: 'stroke-dasharray 0.8s ease' }}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 8, borderRadius: '50%',
            background: `${color}12`, border: `1px solid ${color}25`,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{count}</div>
            <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>{pct}%</div>
          </div>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center', lineHeight: 1.3, maxWidth: 80 }}>
          {status}
        </div>
        <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>{count} items</div>
      </div>
      {!isLast && (
        <div style={{ flexShrink: 0, color: '#334155', paddingBottom: 28, fontSize: 18 }}>→</div>
      )}
    </div>
  )
}

function StatusTimeline({ data }) {
  const total = data.total

  // Identify bottleneck: status with most items that isn't the first or last
  const mid = STATUS_ORDER.slice(1, -1)
  const bottleneck = mid.reduce((best, s) => {
    const cnt = data.statusCounts.get(s) || 0
    return cnt > (data.statusCounts.get(best) || 0) ? s : best
  }, mid[0])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* ── KPI row ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 14 }}>
        {[
          { label: 'Tracked Equipment', value: total,              sub: 'Total in project',           color: '#60a5fa' },
          { label: 'Completed',         value: data.doneCount,     sub: `${data.completionPct}% done`, color: '#4ade80' },
          { label: 'Cx In Progress',    value: data.statusCounts.get('Cx In Progress') || 0, sub: 'Currently commissioning', color: '#f59e0b' },
          { label: 'Not Started',       value: (data.statusCounts.get('Not Assigned')||0) + (data.statusCounts.get('Asset Assigned')||0), sub: 'Awaiting commissioning', color: '#f87171' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 10, color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{sub}</div>
          </div>
        ))}
      </div>

      {/* ── Equipment Status Distribution (Slide 12) ──────────────────────── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
              Equipment Status Distribution
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>Current commissioning status breakdown</div>
          </div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            Total: <strong style={{ color: 'var(--text-primary)' }}>{total.toLocaleString()}</strong>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {STATUS_ORDER.map(s => {
            const count = data.statusCounts.get(s) || 0
            const pct   = total > 0 ? (count / total * 100) : 0
            const color = STATUS_COLORS[s] || '#475569'
            if (count === 0) return null // hide zero rows
            return (
              <div key={s} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 80px', gap: 16, alignItems: 'center' }}>
                {/* Status label with dot */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: `0 0 6px ${color}50` }} />
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{s}</span>
                </div>
                {/* Full-width bar */}
                <div style={{ height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${pct}%`, background: color,
                    borderRadius: 4, transition: 'width 0.6s ease',
                    opacity: 0.85,
                  }} />
                </div>
                {/* Count + pct */}
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color }}>{count.toLocaleString()}</span>
                  <span style={{ fontSize: 11, color: '#475569', marginLeft: 6 }}>({pct.toFixed(1)}%)</span>
                </div>
              </div>
            )
          })}
          {/* Show zero-count rows dimmed */}
          {STATUS_ORDER.filter(s => (data.statusCounts.get(s) || 0) === 0).map(s => (
            <div key={s} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 80px', gap: 16, alignItems: 'center', opacity: 0.3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: STATUS_COLORS[s] || '#475569', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#475569' }}>{s}</span>
              </div>
              <div style={{ height: 8, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }} />
              <div style={{ textAlign: 'right', fontSize: 12, color: '#334155' }}>0 (0.0%)</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Equipment Status Timeline (Slide 13) ──────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 22px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
          Equipment Status Timeline
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 24 }}>
          Track equipment progression and bottlenecks ({total.toLocaleString()} total)
        </div>

        {/* Timeline nodes */}
        <div style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', paddingBottom: 8 }}>
          {STATUS_ORDER.map((s, i) => (
            <StatusTimelineNode
              key={s}
              status={s}
              count={data.statusCounts.get(s) || 0}
              total={total}
              color={STATUS_COLORS[s] || '#475569'}
              isLast={i === STATUS_ORDER.length - 1}
            />
          ))}
        </div>

        <div style={{ height: 1, background: 'var(--divider)', margin: '20px 0' }} />

        {/* Workflow Integrity Alerts */}
        <div style={{
          border: '1px solid rgba(245,158,11,0.25)', borderLeft: '4px solid #f59e0b',
          borderRadius: 10, padding: '14px 18px', marginBottom: 12,
          background: 'rgba(245,158,11,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#f59e0b', fontSize: 14 }}>⚠</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b' }}>Workflow Integrity Alerts</span>
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {bottleneck} has the most items ({data.statusCounts.get(bottleneck) || 0})
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {STATUS_ORDER.filter(s => (data.statusCounts.get(s) || 0) > 0 && s !== 'In Service' && s !== 'Cx Complete').map(s => (
              <span key={s} style={{
                fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
                background: `${STATUS_COLORS[s] || '#475569'}15`,
                border: `1px solid ${STATUS_COLORS[s] || '#475569'}35`,
                color: STATUS_COLORS[s] || '#475569',
              }}>
                {s.toUpperCase()} ×{data.statusCounts.get(s) || 0}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {(data.statusCounts.get('Asset Assigned') || 0)} equipment items assigned but not started commissioning.
            {(data.statusCounts.get('Cx In Progress') || 0) > 0 && ` ${data.statusCounts.get('Cx In Progress')} currently in active commissioning.`}
          </div>
        </div>

        {/* Outliers */}
        <div style={{
          border: '1px solid rgba(239,68,68,0.2)', borderLeft: '4px solid #ef4444',
          borderRadius: 10, padding: '12px 18px',
          background: 'rgba(239,68,68,0.04)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: '#ef4444', fontSize: 13 }}>⟳</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#ef4444' }}>Outliers Detected</span>
            </div>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              {data.withRisk.filter(e => e._stale > 90).length} items stale 90+ days
            </span>
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
            {data.withRisk.filter(e => e._stale > 90).length > 0
              ? `${data.withRisk.filter(e => e._stale > 90).length} equipment items have not been updated in 90+ days — verify these transitions are still valid.`
              : 'All equipment items updated within 90 days.'}
          </div>
        </div>
      </div>

      {/* ── Momentum chart ────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Equipment Momentum</div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>Cumulative tracked vs remaining over time</div>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data.momentumData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" />
            <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={{ fill: '#64748b', fontSize: 9 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11 }} labelStyle={{ color: '#64748b' }} />
            <Line type="monotone" dataKey="all"        name="All tracked" stroke="#818cf8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="cumulative" name="Remaining"   stroke="#60a5fa" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// ─── Risk Analytics Tab ───────────────────────────────────────────────────────
const PRIORITY_PILL = {
  'P1 - Critical': { bg: 'rgba(239,68,68,0.15)',  border: 'rgba(239,68,68,0.35)',  text: '#f87171' },
  'P2 - High':     { bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.35)', text: '#fb923c' },
  'P3 - Medium':   { bg: 'rgba(234,179,8,0.15)',  border: 'rgba(234,179,8,0.35)',  text: '#fbbf24' },
  'P4 - Low':      { bg: 'rgba(34,197,94,0.15)',  border: 'rgba(34,197,94,0.35)',  text: '#4ade80' },
}

function RiskAnalytics({ data }) {
  const [search, setSearch]   = useState('')
  const [sortBy, setSortBy]   = useState('Risk Score')
  const [topN,   setTopN]     = useState('25')
  const [staleCutoff, setStaleCutoff] = useState('14 days')

  const SORT_OPTIONS  = ['Risk Score', 'Stale Days', 'Issues']
  const TOP_OPTIONS   = ['10','25','50','100','All']
  const STALE_OPTIONS = ['7 days','14 days','30 days','60 days','90 days']

  const filteredRisk = useMemo(() => {
    let list = data.withRisk
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(e => (e.name||'').toLowerCase().includes(q) || (e.tag||'').toLowerCase().includes(q) || (e.externalId||'').toLowerCase().includes(q))
    }
    if (sortBy === 'Stale Days') list = [...list].sort((a,b) => b._stale - a._stale)
    else if (sortBy === 'Issues') list = [...list].sort((a,b) => (b.issueCount||0) - (a.issueCount||0))
    const n = topN === 'All' ? list.length : parseInt(topN)
    return list.slice(0, n)
  }, [data.withRisk, search, sortBy, topN])

  const staleDaysNum = parseInt(staleCutoff)
  const staleFiltered = filteredRisk.filter(e => e._stale >= staleDaysNum)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header card */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Equipment Risk Analytics</div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 14 }}>Identify at-risk equipment using issues, progression, and stale duration</div>

        {/* Summary row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{data.total}</span>
            <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 99, background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.25)', color: '#60a5fa', fontWeight: 600 }}>equipment tracked</span>
          </div>
          {/* Risk level pills row */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {[
              { label: `Critical ${data.criticalCount}`, bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  color: '#f87171' },
              { label: `High ${data.highCount}`,         bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.3)', color: '#fb923c' },
              { label: `Medium ${data.mediumCount}`,     bg: 'rgba(234,179,8,0.12)',  border: 'rgba(234,179,8,0.3)',  color: '#fbbf24' },
              { label: `Low ${data.lowCount}`,           bg: 'rgba(34,197,94,0.12)',  border: 'rgba(34,197,94,0.3)',  color: '#4ade80' },
              { label: `Blocking ${data.blockingCount}`, bg: 'rgba(168,85,247,0.12)', border: 'rgba(168,85,247,0.3)', color: '#c084fc' },
              { label: `Urgent ${data.urgentCount}`,     bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.3)',  color: '#f87171' },
              { label: `Stale ${data.staleCount}`,       bg: 'rgba(100,116,139,0.12)',border: 'rgba(100,116,139,0.3)',color: '#94a3b8' },
            ].map(({ label, bg, border, color }) => (
              <span key={label} style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99, background: bg, border: `1px solid ${border}`, color }}>{label}</span>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 160, maxWidth: 240 }}>
            <Search size={12} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment..."
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px 6px 28px', fontSize: 12, color: 'var(--text-primary)', outline: 'none' }} />
          </div>
          {[
            { label: 'Sort', value: sortBy, options: SORT_OPTIONS, set: setSortBy },
            { label: 'Top',  value: topN,   options: TOP_OPTIONS,  set: setTopN   },
            { label: 'Stale',value: staleCutoff, options: STALE_OPTIONS, set: setStaleCutoff },
          ].map(({ label, value, options, set }) => (
            <select key={label} value={value} onChange={e => set(e.target.value)}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px', fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer', outline: 'none' }}>
              {options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ))}
        </div>
      </div>

      {/* Equipment risk cards list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {filteredRisk.map((eq, i) => {
          const lv      = riskLevel(eq._score)
          const pri     = PRIORITY_PILL[eq._priority] || PRIORITY_PILL['P4 - Low']
          const isStale = eq._stale >= staleDaysNum
          const systemInfo = [eq.equipmentType, eq.discipline, eq.assignedTo || 'Unassigned'].filter(Boolean).join(' | ')
          return (
            <div key={eq.id || eq.externalId || i} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '14px 20px',
              borderBottom: i < filteredRisk.length - 1 ? '1px solid var(--border-subtle)' : 'none',
              background: i % 2 === 1 ? 'rgba(255,255,255,0.012)' : 'transparent',
              transition: 'background 0.12s',
            }}>
              {/* Risk score circle */}
              <div style={{
                width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
                border: `2px solid ${lv.color}`,
                background: lv.bg,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: lv.color, lineHeight: 1 }}>{eq._score}</span>
                <span style={{ fontSize: 8, color: lv.color, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>risk</span>
              </div>

              {/* Name + metadata */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{eq.name || eq.tag || eq.externalId || 'Unnamed'}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>{systemInfo}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)', color: '#94a3b8', fontWeight: 600 }}>{eq._status}</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: pri.bg, border: `1px solid ${pri.border}`, color: pri.text, fontWeight: 600 }}>{eq._priority}</span>
                  {isStale && (
                    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: 'rgba(100,116,139,0.12)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', fontWeight: 600 }}>{eq._stale}d stale</span>
                  )}
                </div>
              </div>

              {/* Stats: issues | stale | quality | complete */}
              <div style={{ display: 'flex', gap: 24, flexShrink: 0 }}>
                {[
                  { label: 'issues',   value: eq.issueCount    || 0 },
                  { label: 'stale',    value: eq._stale },
                  { label: 'quality',  value: 100 - eq._score  },
                  { label: 'complete', value: `${eq.checklistCount > 0 ? Math.round((eq.checklistCount - (eq.issueCount||0)) / eq.checklistCount * 100) : 0}%` },
                ].map(({ label, value }) => (
                  <div key={label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>{value}</div>
                    <div style={{ fontSize: 9, color: '#64748b', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
        {!filteredRisk.length && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#475569', fontSize: 13 }}>No equipment matches the current filters.</div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function AssetReadinessPage() {
  const { equipment, loading, error } = useEquipmentData()
  const { matrix, matrixLoading }     = useMatrixData()
  const { period } = useProject()
  const [activeTab, setActiveTab]     = useState('Status & Timeline')

  // Filter equipment by period for Status & Risk tabs
  // (Matrix tab always shows all equipment — period doesn't apply to the cross-reference table)
  const periodEquipment = useMemo(() => {
    if (period === 'Overall') return equipment
    const now = new Date()
    const cutoff = period === 'D' ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : period === 'W' ? new Date(now.getTime() - 7  * 86400000)
      : new Date(now.getTime() - 30 * 86400000)
    const filtered = equipment.filter(e => {
      const d = new Date(e.updatedAt || e.updated_at || e.syncedAt || e.createdAt || e.created_at || 0)
      return !isNaN(d) && d >= cutoff
    })
    // Always show at least unfiltered data if the period filter returns nothing
    return filtered.length > 0 ? filtered : equipment
  }, [equipment, period])

  const computed = useMemo(() => computeAll(periodEquipment), [periodEquipment])

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div><div style={{ height: 28, width: 180, background: 'var(--bg-card)', borderRadius: 6, border: '1px solid var(--border)' }} /></div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14 }}>
        {[...Array(3)].map((_, i) => <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, height: 90, border: '1px solid var(--border)' }} />)}
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Title */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Asset Readiness</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Status progression, checklist matrix, and risk analytics for active equipment.</p>
        </div>
        {period !== 'Overall' && (
          <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 12px', borderRadius: 20,
            background: 'rgba(14,165,233,0.1)', color: '#0ea5e9', border: '1px solid rgba(14,165,233,0.2)' }}>
            {period === 'D' ? 'Today' : period === 'W' ? 'Last 7 Days' : 'Last 30 Days'}
            &nbsp;·&nbsp;{periodEquipment.length} equipment
          </span>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4 }}>
        {TABS.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)} style={{
            padding: '7px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            background: activeTab === tab ? '#3b82f6' : 'var(--bg-card)',
            border: activeTab === tab ? '1px solid #3b82f6' : '1px solid var(--border)',
            borderRadius: 8, color: activeTab === tab ? '#fff' : '#94a3b8',
            transition: 'all 0.15s',
          }}>{tab}</button>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div style={{ padding: '14px 18px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, fontSize: 12, color: '#f87171' }}>
          Failed to load equipment: {error}
        </div>
      )}

      {/* Empty state */}
      {!computed && !loading && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '48px', textAlign: 'center', color: '#475569' }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>🏗️</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>No equipment data</div>
          <div style={{ fontSize: 13 }}>Sync equipment for the selected project from the Sync page.</div>
        </div>
      )}

      {/* Tab content */}
      {computed && activeTab === 'Status & Timeline' && <StatusTimeline data={computed} />}
      {activeTab === 'Equipment Matrix' && <EquipmentChecklistMatrix matrix={matrix} loading={matrixLoading} />}
      {computed && activeTab === 'Risk Analytics' && <RiskAnalytics data={computed} />}
    </div>
  )
}
