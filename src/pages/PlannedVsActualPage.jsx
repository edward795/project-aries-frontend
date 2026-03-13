import React, { useState, useEffect, useCallback, useMemo } from 'react'
import ReactDOM from 'react-dom'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  TrendingUp, Calendar, AlertTriangle, CheckSquare,
  RefreshCw, ChevronRight, Activity, X, ExternalLink,
} from 'lucide-react'
import { useProject } from '../context/ProjectContext'
import { checklistsApi } from '../services/api'
import toast from 'react-hot-toast'

// ─── CxAlloy deep-link ────────────────────────────────────────────────────────
function cxUrl(projectId, externalId) {
  if (!projectId || !externalId) return null
  return `https://tq.cxalloy.com/project/${projectId}/checklists/${externalId}`
}

// ─── ISO week helpers ─────────────────────────────────────────────────────────
function isoWeekLabel(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
  const yr = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const wk = Math.ceil((((tmp - yr) / 86400000) + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`
}

function addDays(date, n) {
  const d = new Date(date); d.setDate(d.getDate() + n); return d
}

// ─── Best date from checklist (camelCase from Spring Boot) ────────────────────
function pickDate(c) {
  return c.completedDate || c.updatedAt || c.createdAt
      || c.completed_date || c.updated_at || c.created_at || null
}

function pickDueDate(c) {
  return c.dueDate || c.due_date || c.plannedDate || c.planned_date || null
}

// ─── "done" predicate ─────────────────────────────────────────────────────────
const DONE = new Set(['finished','complete','completed','done','closed',
  'signed_off','approved','passed','issue_closed','accepted_by_owner'])
const isDone = s => DONE.has((s || '').toLowerCase().replace(/[ \-]/g,'_'))

// ─── Tag normaliser ───────────────────────────────────────────────────────────
// Handles: explicit color words, ITR-A/B/C/D (CxAlloy standard),
// bare L1/L2/L3/L4 prefixes, and level.?N patterns.
function normaliseTag(c) {
  // Trust tagLevel from backend if it's a known color
  const tl = (c.tagLevel || c.tag_level || '').toLowerCase().trim()
  if (['red','yellow','green','blue','white'].includes(tl)) {
    return tl === 'white' ? 'white' : tl
  }

  // Fall through to checklistType, then name
  const src = (c.checklistType || c.checklist_type || c.name || '').toLowerCase()

  // Explicit color words
  if (src.includes('red'))    return 'red'
  if (src.includes('yellow')) return 'yellow'
  if (src.includes('green'))  return 'green'
  if (src.includes('blue'))   return 'blue'

  // ITR patterns (CxAlloy standard: ITR-A=red, ITR-B=yellow, ITR-C=green, ITR-D=blue)
  if (/\bitr[-_\s]?a\b/.test(src)) return 'red'
  if (/\bitr[-_\s]?b\b/.test(src)) return 'yellow'
  if (/\bitr[-_\s]?c\b/.test(src)) return 'green'
  if (/\bitr[-_\s]?d\b/.test(src)) return 'blue'

  // Bare L1/L2/L3/L4 at word boundary (e.g. "L1 - FWT/FAT", "L2 - Conditional")
  if (/\bl1\b/.test(src) || /level.?1/.test(src)) return 'red'
  if (/\bl2\b/.test(src) || /level.?2/.test(src)) return 'yellow'
  if (/\bl3\b/.test(src) || /level.?3/.test(src)) return 'green'
  if (/\bl4\b/.test(src) || /level.?4/.test(src)) return 'blue'

  if (tl === 'white' || tl === '') return 'white'
  return 'other'
}

// ─── Tag colours ──────────────────────────────────────────────────────────────
const TAG_COLORS = {
  red:    { dot: '#ef4444', bg: 'rgba(239,68,68,0.12)',    border: 'rgba(239,68,68,0.25)',    text: '#f87171' },
  yellow: { dot: '#eab308', bg: 'rgba(234,179,8,0.12)',    border: 'rgba(234,179,8,0.25)',    text: '#fbbf24' },
  green:  { dot: '#22c55e', bg: 'rgba(34,197,94,0.12)',    border: 'rgba(34,197,94,0.25)',    text: '#4ade80' },
  blue:   { dot: '#3b82f6', bg: 'rgba(59,130,246,0.12)',   border: 'rgba(59,130,246,0.25)',   text: '#60a5fa' },
  white:  { dot: '#94a3b8', bg: 'rgba(148,163,184,0.08)',  border: 'rgba(148,163,184,0.15)',  text: '#94a3b8' },
  other:  { dot: '#64748b', bg: 'rgba(100,116,139,0.08)',  border: 'rgba(100,116,139,0.15)',  text: '#64748b' },
}

// ─── Build S-curve data ───────────────────────────────────────────────────────
function buildSCurveData(checklists) {
  if (!checklists.length) return []

  const weekMap = new Map()
  checklists.forEach(c => {
    const raw = pickDate(c)
    if (!raw) return
    const d = new Date(raw)
    if (isNaN(d)) return
    const wk = isoWeekLabel(d)
    const tag = normaliseTag(c)
    const row = weekMap.get(wk) || { week: wk, red: 0, yellow: 0, green: 0, blue: 0, white: 0, other: 0 }
    row[tag] = (row[tag] || 0) + 1
    weekMap.set(wk, row)
  })

  const weeks = Array.from(weekMap.values()).sort((a, b) => a.week.localeCompare(b.week))
  if (!weeks.length) return []

  let cumActual = 0
  const data = weeks.map((w) => {
    const total = w.red + w.yellow + w.green + w.blue + w.white + w.other
    cumActual += total
    return { ...w, total, cumActual }
  })

  // Target: linear ramp across the same weeks
  const totalChecklists = checklists.length
  data.forEach((d, i) => {
    d.cumTarget = Math.round((i + 1) / data.length * totalChecklists)
  })

  return data
}

// ─── Pace metrics ─────────────────────────────────────────────────────────────
function buildPaceMetrics(checklists) {
  if (!checklists.length) return { d: 0, w: 0, m: 0, cumulative: checklists.length }

  const weekMap = new Map()
  checklists.forEach(c => {
    const raw = pickDate(c)
    if (!raw) return
    const d = new Date(raw)
    if (isNaN(d)) return
    const wk = isoWeekLabel(d)
    weekMap.set(wk, (weekMap.get(wk) || 0) + 1)
  })

  const entries = Array.from(weekMap.values())
  const total = entries.reduce((s, v) => s + v, 0)
  const activeWeeks = entries.length || 1
  const w = +(total / activeWeeks).toFixed(1)
  return {
    d: +(w / 7).toFixed(1),
    w,
    m: +(w * 4.33).toFixed(1),
    cumulative: checklists.length,
  }
}

// ─── Overdue items ────────────────────────────────────────────────────────────
// A checklist is overdue if:
//  1. It has an explicit dueDate in the past AND is not done, OR
//  2. It is not done AND was created/updated more than 30 days ago (same logic modum.me uses)
function computeOverdue(checklists) {
  const now = new Date()
  const results = []
  checklists.forEach(c => {
    if (isDone(c.status)) return

    let delay = 0
    const due = pickDueDate(c)
    if (due) {
      const dueD = new Date(due)
      if (!isNaN(dueD) && dueD < now) {
        delay = Math.round((now - dueD) / 86400000)
      } else {
        return // has future due date — not overdue
      }
    } else {
      // No due date — treat as overdue if last activity > 30 days ago
      const activityDate = new Date(c.updatedAt || c.created_at || c.createdAt || 0)
      delay = Math.round((now - activityDate) / 86400000)
      if (delay < 30) return
    }

    const tag = normaliseTag(c)
    results.push({
      id:          c.id,
      name:        c.name || c.title || c.code || 'Unnamed Checklist',
      description: c.description || c.checklistType || c.checklist_type || '',
      tag,
      delay,
      externalId:  c.externalId || c.external_id,
      projectId:   c.projectId  || c.project_id,
    })
  })

  return results.sort((a, b) => b.delay - a.delay)
}

// ─── Next 14 days ─────────────────────────────────────────────────────────────
// modum.me shows open checklists ordered by most-recent activity date — it is
// NOT restricted to a future 14-day window (the dates shown are the last
// updatedAt/createdAt, not future due dates).  We show the 50 most recently
// active open checklists, labelled "Upcoming checklist activity preview".
// If some checklists DO have a genuine future due date within 14 days we show
// those first, then fill the rest from recently-active open items.
function computeNext14Days(checklists) {
  const now    = new Date()
  const future = addDays(now, 14)

  const toItem = (c, dateOverride) => {
    const due = pickDueDate(c)
    const rawType = (c.checklistType || c.checklist_type || '').trim()

    // Build a human-readable tag label from the checklistType string
    // e.g. "L1 - FWT/FAT" → keep as-is; "Level-2 YELLOW Tag QA/QC" → keep as-is
    // If empty, generate from normalised tag
    let tagLabel = rawType
    if (!tagLabel) {
      const tag = normaliseTag(c)
      if      (tag === 'red')    tagLabel = 'Level-1 RED Tag FAT'
      else if (tag === 'yellow') tagLabel = 'Level-2 YELLOW Tag QA/QC/IVC'
      else if (tag === 'green')  tagLabel = 'Level-3 GREEN Tag Start-Up/PFC'
      else if (tag === 'blue')   tagLabel = 'Level-4 BLUE Tag Sign-Off'
      else                       tagLabel = 'Checklist'
    }
    // Activity date: prefer explicit due date, fall back to updatedAt/createdAt
    const actDate = dateOverride
      || (due ? new Date(due) : null)
      || new Date(c.updatedAt || c.updated_at || c.createdAt || c.created_at || now)

    return {
      id:         c.id,
      name:       c.name || c.title || c.code || 'Unnamed',
      tagLabel,
      dueDate:    actDate,
      externalId: c.externalId || c.external_id,
      projectId:  c.projectId  || c.project_id,
    }
  }

  // Priority 1: explicit future due dates within 14 days
  const withFutureDue = checklists.filter(c => {
    if (isDone(c.status)) return false
    const due = pickDueDate(c)
    if (!due) return false
    const d = new Date(due)
    return !isNaN(d) && d >= now && d <= future
  }).map(c => toItem(c, null)).sort((a, b) => a.dueDate - b.dueDate)

  // Priority 2: most recently active open checklists (NO cutoff — match modum.me)
  // Sort by most-recent activity, take top 50 minus however many future-due we already have
  const futureDueIds = new Set(withFutureDue.map(i => i.id))
  const recentOpen = checklists
    .filter(c => {
      if (isDone(c.status)) return false
      if (futureDueIds.has(c.id)) return false
      const d = new Date(c.updatedAt || c.updated_at || c.createdAt || c.created_at || 0)
      return !isNaN(d)
    })
    .sort((a, b) => {
      const da = new Date(a.updatedAt || a.updated_at || a.createdAt || a.created_at || 0)
      const db = new Date(b.updatedAt || b.updated_at || b.createdAt || b.created_at || 0)
      return db - da   // most recent first
    })
    .slice(0, Math.max(0, 50 - withFutureDue.length))
    .map(c => {
      const actDate = new Date(c.updatedAt || c.updated_at || c.createdAt || c.created_at || now)
      return toItem(c, actDate)
    })

  return [...withFutureDue, ...recentOpen]
}

// ─── Checklist Detail Modal ───────────────────────────────────────────────────
function ChecklistModal({ item, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const url = cxUrl(item.projectId, item.externalId)
  const c   = TAG_COLORS[item.tag] || TAG_COLORS.other

  return ReactDOM.createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }} />

      {/* Card */}
      <div style={{
        position: 'relative', zIndex: 1, background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 16,
        padding: 28, width: '100%', maxWidth: 520,
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 6 }}>
              {item.name}
            </div>
            {item.description && (
              <div style={{ fontSize: 12, color: '#64748b' }}>{item.description}</div>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: '#94a3b8', flexShrink: 0, lineHeight: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
          {[
            { label: 'TAG LEVEL', value: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 20, background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.dot }} />
                {item.tag}
              </span>
            )},
            { label: 'DELAY', value: <span style={{ color: '#f87171', fontWeight: 700 }}>{item.delay}d overdue</span> },
          ].map(row => (
            <div key={row.label} style={{ background: 'var(--border-subtle)', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ fontSize: 9, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>{row.label}</div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)' }}>{row.value}</div>
            </div>
          ))}
        </div>

        {/* CxAlloy link */}
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '11px 0', background: '#0ea5e9', color: 'var(--text-primary)',
              border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', textDecoration: 'none', transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#38bdf8'}
            onMouseLeave={e => e.currentTarget.style.background = '#0ea5e9'}
          >
            <ExternalLink size={14} />
            Open in CxAlloy
          </a>
        ) : (
          <div style={{ fontSize: 12, color: '#475569', textAlign: 'center' }}>No CxAlloy link available</div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ─── S-Curve tooltip ──────────────────────────────────────────────────────────
function SCurveTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', fontSize: 12, minWidth: 160 }}>
      <div style={{ color: '#64748b', fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {payload.map((p, i) => p.value != null && (
        <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, marginBottom: 3 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
            <span style={{ color: '#94a3b8' }}>{p.name}</span>
          </div>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Pace card ────────────────────────────────────────────────────────────────
function PaceCard({ label, value, desc, color }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: `1px solid ${color}30`, borderRadius: 12, padding: '18px 20px' }}>
      <div style={{ fontSize: 10, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 32, fontWeight: 800, color, lineHeight: 1, marginBottom: 4 }}>{value}</div>
      <div style={{ fontSize: 12, color: '#64748b' }}>{desc}</div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
const PAGED = 10

export default function PlannedVsActualPage() {
  const { selectedProjects, activeProject } = useProject()
  const targets = selectedProjects.length > 0 ? selectedProjects : (activeProject ? [activeProject] : [])

  const [loading,    setLoading]    = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [checklists, setChecklists] = useState([])
  const [error,      setError]      = useState(null)
  const [overdueVisible, setOverdueVisible] = useState(PAGED)
  const [next14Visible,  setNext14Visible]  = useState(PAGED)
  const [modalItem,  setModalItem]  = useState(null) // checklist to show in modal

  const loadData = useCallback(async () => {
    if (!targets.length) return
    setLoading(true)
    setError(null)
    try {
      const results = await Promise.all(
        targets.map(p => checklistsApi.getAll(p.externalId).then(r => r.data?.data || []).catch(() => []))
      )
      setChecklists(results.flat())
    } catch {
      setError('Failed to load checklist data')
      toast.error('Failed to load checklist data')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets.map(p => p.externalId).join(',')])

  useEffect(() => { loadData() }, [targets.map(p => p.externalId).join(',')])

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
    toast.success('Data refreshed')
  }

  const sCurveData  = useMemo(() => buildSCurveData(checklists),    [checklists])
  const paceMetrics = useMemo(() => buildPaceMetrics(checklists),   [checklists])
  const overdueItems = useMemo(() => computeOverdue(checklists),    [checklists])
  const next14Days   = useMemo(() => computeNext14Days(checklists), [checklists])

  // Tag counts for overdue summary — always show all 6 rows
  const overdueTagCounts = useMemo(() => {
    const counts = { red: 0, yellow: 0, green: 0, blue: 0, white: 0, other: 0 }
    overdueItems.forEach(i => { counts[i.tag] = (counts[i.tag] || 0) + 1 })
    return counts
  }, [overdueItems])

  if (!targets.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, color: '#475569', gap: 12 }}>
        <TrendingUp size={28} />
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>No Project Selected</div>
        <div style={{ fontSize: 13 }}>Select a project to view planned vs actual progress</div>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Planned vs Actual</h2>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>S-curve view with cumulative progression and overdue checklist drill-down.</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'pointer', color: '#94a3b8', fontSize: 12, fontWeight: 600 }}
        >
          <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          Refresh
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {[...Array(4)].map((_, i) => (
            <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, height: 100, border: '1px solid var(--border)' }} />
          ))}
        </div>
      )}

      {!loading && (
        <>
          {/* Pace Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            <PaceCard label="D Value"    value={paceMetrics.d}                          desc="Checklist pace per day"    color="#38bdf8" />
            <PaceCard label="W Value"    value={paceMetrics.w}                          desc="Checklist pace per week"   color="#4ade80" />
            <PaceCard label="M Value"    value={paceMetrics.m}                          desc="Checklist pace per month"  color="#f59e0b" />
            <PaceCard label="Cumulative" value={paceMetrics.cumulative.toLocaleString()} desc="Overall cumulative checklists" color="#a78bfa" />
          </div>

          {/* S-Curve */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px 24px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>S-Curve</div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 16 }}>Stacked stage values with cumulative lines (Overall)</div>

            {sCurveData.length > 0 ? (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={sCurveData} margin={{ top: 8, right: 36, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" />
                  <XAxis
                    dataKey="week"
                    tick={{ fill: '#64748b', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                    tickFormatter={v => v.replace('20', '')}
                  />
                  <YAxis yAxisId="left"  tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<SCurveTooltip />} />

                  {/* Stacked areas — green bottom, then yellow, red, blue */}
                  <Area yAxisId="left" type="monotone" dataKey="green"  name="green"  stackId="1" fill="rgba(34,197,94,0.65)"  stroke="none" />
                  <Area yAxisId="left" type="monotone" dataKey="yellow" name="yellow" stackId="1" fill="rgba(234,179,8,0.65)"  stroke="none" />
                  <Area yAxisId="left" type="monotone" dataKey="red"    name="red"    stackId="1" fill="rgba(239,68,68,0.65)"   stroke="none" />
                  <Area yAxisId="left" type="monotone" dataKey="blue"   name="blue"   stackId="1" fill="rgba(59,130,246,0.55)"  stroke="none" />
                  <Area yAxisId="left" type="monotone" dataKey="white"  name="white"  stackId="1" fill="rgba(148,163,184,0.35)" stroke="none" />

                  {/* Cumulative lines */}
                  <Line yAxisId="right" type="monotone" dataKey="cumActual" name="Actual CUM"  stroke="#22c55e"              strokeWidth={2}   dot={false} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="cumTarget" name="Target CUM"  stroke="rgba(100,116,139,0.5)" strokeWidth={2}   strokeDasharray="6 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 260, color: '#475569', gap: 8 }}>
                <Activity size={28} />
                <div style={{ fontSize: 13 }}>No checklist data to plot</div>
              </div>
            )}

            <div style={{ marginTop: 12, fontSize: 11, color: '#334155', fontStyle: 'italic' }}>
              Actual line uses completion dates where available, falling back to creation dates. Target is a linear estimate — upload a plan baseline for accurate planned vs actual comparison.
            </div>
          </div>

          {/* Overdue + Next 14 Days */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

            {/* ── Overdue Items ────────────────────────────────────────────── */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--divider)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <AlertTriangle size={14} color="#f87171" />
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Overdue Items</span>
                  {overdueItems.length > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontWeight: 600 }}>
                      {overdueItems.length}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#475569' }}>Red/Yellow/Green/Blue/White/Other counts with delay in days</div>

                {/* Always show all 6 tag rows */}
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {['red','yellow','green','blue','white','other'].map(tag => {
                    const c = TAG_COLORS[tag]
                    const count = overdueTagCounts[tag] || 0
                    return (
                      <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 9, height: 9, borderRadius: '50%', background: c.dot, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: count > 0 ? c.text : '#475569', fontWeight: 500, textTransform: 'capitalize', flex: 1 }}>
                          {tag.charAt(0).toUpperCase() + tag.slice(1)}
                        </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: count > 0 ? 'var(--text-primary)' : '#334155' }}>{count}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Item rows */}
              <div>
                {overdueItems.slice(0, overdueVisible).map((item, i) => {
                  const c = TAG_COLORS[item.tag] || TAG_COLORS.other
                  return (
                    <div
                      key={item.id || i}
                      onClick={() => setModalItem(item)}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                        padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)',
                        cursor: 'pointer', transition: 'background 0.12s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--row-alt)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                          {item.name}
                        </div>
                        {item.description && (
                          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.description}
                          </div>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 20, background: c.bg, border: `1px solid ${c.border}`, color: c.text, fontWeight: 600, textTransform: 'capitalize' }}>
                          {item.tag}
                        </span>
                        <span style={{ fontSize: 11, color: '#f87171', fontWeight: 600, whiteSpace: 'nowrap' }}>
                          {item.delay}d delay
                        </span>
                      </div>
                    </div>
                  )
                })}

                {!overdueItems.length && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 8 }}>
                    <CheckSquare size={22} color="#22c55e" />
                    <div style={{ fontSize: 12, color: '#475569' }}>All checklists are on track</div>
                  </div>
                )}

                {overdueItems.length > overdueVisible && (
                  <div style={{ padding: '12px 20px', textAlign: 'center' }}>
                    <button
                      onClick={() => setOverdueVisible(v => v + PAGED)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 18px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, cursor: 'pointer', color: '#f87171', fontSize: 12, fontWeight: 600 }}
                    >
                      <ChevronRight size={13} />
                      Load {Math.min(PAGED, overdueItems.length - overdueVisible)} more · {overdueItems.length - overdueVisible} remaining
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ── Next 14 Days ─────────────────────────────────────────────── */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--divider)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Calendar size={14} color="#38bdf8" />
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Next 14 Days</span>
                  {next14Days.length > 0 && (
                    <span style={{ marginLeft: 'auto', fontSize: 11, padding: '2px 8px', borderRadius: 20, background: 'rgba(56,189,248,0.12)', border: '1px solid rgba(56,189,248,0.25)', color: '#38bdf8', fontWeight: 600 }}>
                      {next14Days.length}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#475569' }}>Upcoming checklist activity preview</div>
              </div>

              <div>
                {next14Days.slice(0, next14Visible).map((item, i) => (
                  <div
                    key={item.id || i}
                    onClick={() => {
                      const url = cxUrl(item.projectId, item.externalId)
                      if (url) window.open(url, '_blank', 'noopener')
                    }}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)',
                      cursor: 'pointer', transition: 'background 0.12s',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--row-alt)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name}>
                        {item.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.tagLabel}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', flexShrink: 0 }}>
                      {item.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                ))}

                {!next14Days.length && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', gap: 8 }}>
                    <Calendar size={22} color="#334155" />
                    <div style={{ fontSize: 12, color: '#475569' }}>No open checklist activity found — sync checklists first</div>
                  </div>
                )}

                {next14Days.length > next14Visible && (
                  <div style={{ padding: '12px 20px', textAlign: 'center' }}>
                    <button
                      onClick={() => setNext14Visible(v => v + PAGED)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 18px', background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 8, cursor: 'pointer', color: '#38bdf8', fontSize: 12, fontWeight: 600 }}
                    >
                      <ChevronRight size={13} />
                      Load {Math.min(PAGED, next14Days.length - next14Visible)} more · {next14Days.length - next14Visible} remaining
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Detail modal for overdue items */}
      {modalItem && <ChecklistModal item={modalItem} onClose={() => setModalItem(null)} />}
    </div>
  )
}
