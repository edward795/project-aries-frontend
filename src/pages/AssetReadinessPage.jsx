import React, { useState, useEffect, useMemo } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useProject } from '../context/ProjectContext'
import { equipmentApi, syncApi } from '../services/api'
import EquipmentChecklistMatrix from '../components/ui/EquipmentChecklistMatrix'

const STATUS_ORDER = [
  'Not Assigned', 'Asset Assigned', 'Pre-Cx', 'Cx In Progress',
  'Cx Complete', 'Ready For Startup', 'In Service',
]

function normStatus(e) {
  // EquipmentService.normEquipmentStatus() already maps CxAlloy status IDs to
  // these exact string names during sync. We just need to match them precisely.
  // Fallback fuzzy matching handles any legacy/unmapped values.
  const raw = e.status || e.equipmentStatus || ''
  // Exact match first (post-normalisation from backend)
  const EXACT = ['Not Assigned','Asset Assigned','Pre-Cx','Cx In Progress','Cx Complete','Ready For Startup','In Service']
  if (EXACT.includes(raw)) return raw
  // Fuzzy fallback for unmapped / legacy values
  const s = raw.toLowerCase().replace(/ /g,'_').replace(/-/g,'_')
  if (!s || s.includes('not_assigned') || s.includes('unassigned')) return 'Not Assigned'
  if (s.includes('asset_assigned') || (s.includes('assigned') && !s.includes('not'))) return 'Asset Assigned'
  if (s.includes('pre_cx') || s.includes('precx')) return 'Pre-Cx'
  if (s.includes('cx_in') || (s.includes('in_progress') && s.includes('cx'))) return 'Cx In Progress'
  if (s.includes('cx_complete') || s.includes('cx_done')) return 'Cx Complete'
  if (s.includes('ready') || s.includes('startup')) return 'Ready For Startup'
  if (s.includes('in_service') || s.includes('commissioned')) return 'In Service'
  return 'Not Assigned'
}

function computeReadiness(equipment) {
  const total = equipment.length
  if (!total) return null

  const statusMap = new Map()
  STATUS_ORDER.forEach(s => statusMap.set(s, 0))
  equipment.forEach(e => {
    const s = normStatus(e)
    statusMap.set(s, (statusMap.get(s) || 0) + 1)
  })
  const leadStatus = Array.from(statusMap.entries()).sort((a, b) => b[1] - a[1])[0]

  // Completion: items at Cx Complete or beyond
  const doneStatuses = ['Cx Complete', 'Ready For Startup', 'In Service']
  const completedCount = equipment.filter(e => doneStatuses.includes(normStatus(e))).length
  const completion = +(completedCount / total * 100).toFixed(1)

  // Risk score per equipment: higher = riskier
  const withRisk = equipment.map(e => {
    const s = normStatus(e)
    const stateIdx = STATUS_ORDER.indexOf(s)
    const totalStates = STATUS_ORDER.length
    const stateScore = stateIdx === -1 ? 100 : Math.round((1 - stateIdx / (totalStates - 1)) * 100)
    const checklistRisk = (e.checklistCount > 0 && e.issueCount > 0)
      ? Math.round(e.issueCount / e.checklistCount * 50) : 0
    return {
      ...e,
      riskScore: Math.min(100, stateScore + checklistRisk),
      status: s,
      priority: stateScore > 80 ? 'P1 - Critical' : stateScore > 60 ? 'P2 - High' : stateScore > 40 ? 'P3 - Medium' : 'P4 - Low',
    }
  }).sort((a, b) => b.riskScore - a.riskScore)

  // Momentum chart: "all" = flat total, "cumulative" = items NOT yet done (declining as Cx progresses)
  // Reference chart shows weeks from 2025-W42 to 2025-W47 with all ~506, cumulative declining 506→~0
  const now = new Date()

  // Build ISO week label for a date
  function isoWeekLabel(d) {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
    const day = tmp.getUTCDay() || 7
    tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
    const yr = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
    const wk = Math.ceil((((tmp - yr) / 86400000) + 1) / 7)
    return `${tmp.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`
  }

  // Find earliest created date among equipment to anchor chart start
  const createdDates = equipment
    .map(e => new Date(e.createdAt || e.created_at || e.syncedAt || now))
    .filter(d => !isNaN(d))
  const minDate = createdDates.length ? new Date(Math.min(...createdDates)) : new Date(now.getTime() - 11 * 7 * 86400000)

  // Determine week range: from minDate to now, max 12 weeks
  const weekStarts = []
  const cur = new Date(minDate)
  cur.setDate(cur.getDate() - cur.getDay() + 1) // Monday of minDate's week
  while (cur <= now && weekStarts.length < 12) {
    weekStarts.push(new Date(cur))
    cur.setDate(cur.getDate() + 7)
  }

  const momentumWithCum = weekStarts.map(wkStart => {
    const wkEnd = new Date(wkStart.getTime() + 7 * 86400000)
    const label = isoWeekLabel(wkStart)
    // "all" = equipment existing by end of this week (cumulative created count)
    const allByWeek = equipment.filter(e => {
      const d = new Date(e.createdAt || e.created_at || e.syncedAt || now)
      return d <= wkEnd
    }).length
    // "cumulative" = equipment NOT yet done by end of this week
    const notDoneByWeek = equipment.filter(e => {
      const d = new Date(e.createdAt || e.created_at || e.syncedAt || now)
      if (d > wkEnd) return false
      // Check if it was completed by this week
      const updD = new Date(e.updatedAt || e.updated_at || e.syncedAt || now)
      const isDoneByWeek = doneStatuses.includes(normStatus(e)) && updD <= wkEnd
      return !isDoneByWeek
    }).length
    return { week: label, cumTotal: allByWeek, cumCompleted: notDoneByWeek }
  })

  return {
    total, leadStatus: leadStatus?.[0] || 'N/A', leadCount: leadStatus?.[1] || 0,
    completion, withRisk: withRisk.slice(0, 10), statusMap, momentumWithCum
  }
}

// ── Client-side CxAlloy equipment JSON parser ─────────────────────────────────
// Mirrors EquipmentService.map() — normalises raw CxAlloy JSON into our Equipment shape
const STATUS_ID_MAP = { '1':'Not Assigned','2':'Asset Assigned','3':'Pre-Cx',
  '4':'Cx In Progress','5':'Cx Complete','6':'Ready For Startup','7':'In Service' }

function parseRawEquipment(rawJson, projectId) {
  try {
    const root = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson
    // CxAlloy wraps data under "data", "records", or at root
    const arr = root?.data ?? root?.records ?? (Array.isArray(root) ? root : null)
    if (!arr) return []
    return arr.map(n => {
      // Status: try string label first, then numeric ID
      let status = n.status || n.equipment_status || n.commission_status || ''
      if (!status || /^\d+$/.test(status)) {
        const id = String(n.equipment_status_id || n.status_id || status || '')
        status = STATUS_ID_MAP[id] || 'Not Assigned'
      }
      return {
        externalId:     String(n.equipment_id || n.id || n._id || ''),
        projectId:      String(projectId || ''),
        name:           n.name || null,
        tag:            n.tag || n.equipment_id || null,
        description:    n.description || null,
        status,
        equipmentType:  n.type?.name ?? n.type ?? n.equipment_type ?? null,
        discipline:     n.discipline?.name ?? n.discipline ?? null,
        buildingId:     n.building_id || n.building || null,
        floorId:        n.floor_id    || n.floor    || null,
        spaceId:        n.space_id    || n.space    || null,
        checklistCount: n.checklist_count || 0,
        issueCount:     n.issue_count     || 0,
        createdAt:      n.date_created || n.created_at || null,
        updatedAt:      n.updated_at   || null,
      }
    })
  } catch { return [] }
}

// Fetch one page of equipment from CxAlloy via rawPreview (works with v15 backend)
async function fetchEquipmentViaRawPreview(projectId) {
  const items = []
  for (let page = 1; page <= 2; page++) {
    try {
      const endpoint = `/equipment${page > 1 ? `?page=${page}` : ''}`
      const res = await syncApi.rawPreview(endpoint, projectId)
      const rawStr = res.data?.data   // rawPreview returns raw JSON string
      if (!rawStr) break
      const parsed = parseRawEquipment(rawStr, projectId)
      items.push(...parsed)
      if (parsed.length < 500) break  // last page
    } catch { break }
  }
  return items
}

function useMultiProjectData() {
  const { selectedProjects, activeProject } = useProject()
  const targets = selectedProjects.length > 0 ? selectedProjects : (activeProject ? [activeProject] : [])
  const [equipment, setEquipment] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!targets.length) { setEquipment([]); return }
    setLoading(true)
    // Step 1: try synced DB (fast, cached)
    Promise.all(targets.map(p => equipmentApi.getAll(p.externalId).then(r => r.data?.data || []).catch(() => [])))
      .then(async results => {
        const flat = results.flat()
        if (flat.length > 0) {
          setEquipment(flat)
          setLoading(false)
        } else {
          // Step 2: DB empty — fetch live from CxAlloy via rawPreview (available on v15+)
          try {
            const liveResults = await Promise.all(
              targets.map(p => fetchEquipmentViaRawPreview(p.externalId))
            )
            setEquipment(liveResults.flat())
          } catch { setEquipment([]) }
          setLoading(false)
        }
      })
      .catch(() => { setEquipment([]); setLoading(false) })
  }, [targets.map(p => p.externalId).join(',')])

  return { equipment, loading }
}

// ── Matrix data hook ──────────────────────────────────────────────────────────
function useMatrixData() {
  const { selectedProjects, activeProject } = useProject()
  const targets = selectedProjects.length > 0 ? selectedProjects : (activeProject ? [activeProject] : [])
  const [matrix, setMatrix] = useState(null)
  const [matrixLoading, setMatrixLoading] = useState(false)

  useEffect(() => {
    if (!targets.length) { setMatrix(null); return }
    setMatrixLoading(true)

    // Use first selected project for matrix (matrix API handles one project at a time)
    const projectId = targets[0]?.externalId
    equipmentApi.getMatrix(projectId)
      .then(res => {
        setMatrix(res.data?.data || null)
        setMatrixLoading(false)
      })
      .catch(() => {
        setMatrix(null)
        setMatrixLoading(false)
      })
  }, [targets.map(p => p.externalId).join(',')])

  return { matrix, matrixLoading }
}

const StatCard = ({ label, value, sub, color }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px', flex: 1 }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
    <div style={{ fontSize: color ? 26 : 32, fontWeight: 800, color: color || 'var(--text-primary)', lineHeight: 1.1, marginBottom: 6, wordBreak: 'break-word' }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: '#64748b' }}>{sub}</div>}
  </div>
)

const PRIORITY_COLORS = { 'P1 - Critical': '#f87171', 'P2 - High': '#fb923c', 'P3 - Medium': '#fbbf24', 'P4 - Low': '#4ade80' }

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: '#64748b', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color, fontWeight: 700 }}>{p.name}: {p.value}</div>)}
    </div>
  )
}

export default function AssetReadinessPage() {
  const { equipment, loading } = useMultiProjectData()
  const { matrix, matrixLoading } = useMatrixData()
  const readiness = useMemo(() => computeReadiness(equipment), [equipment])

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      {[...Array(4)].map((_, i) => <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, height: 100, border: '1px solid var(--border)' }} />)}
    </div>
  )

  if (!readiness) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Asset Readiness</h2>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Asset state movement, momentum, and highest-risk rows.</p>
      </div>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '48px', textAlign: 'center', color: '#475569' }}>
        No equipment data. Sync equipment for selected projects.
      </div>
      {/* Matrix still renders (loading state / empty state handled internally) */}
      <EquipmentChecklistMatrix matrix={matrix} loading={matrixLoading} />
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Asset Readiness</h2>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Asset state movement, momentum, and highest-risk rows.</p>
      </div>

      {/* 4 KPI cards */}
      <div style={{ display: 'flex', gap: 14 }}>
        <StatCard label="Tracked Equipment" value={readiness.total} sub="Live equipment count" color="#60a5fa" />
        <StatCard label="Lead Status" value={readiness.leadStatus} sub={`${readiness.leadCount} rows in this state`} color="#22c55e" />
        <StatCard label="Top Risk Asset" value={readiness.withRisk[0]?.name || 'N/A'} sub={`Risk ${readiness.withRisk[0]?.riskScore || 0}`} color="#f87171" />
        <StatCard label="Completion" value={`${readiness.completion}%`} sub="Derived from commissioning level progression" color="#a78bfa" />
      </div>

      {/* Two panel layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Equipment Momentum chart */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Equipment Momentum</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Completion rhythm in Overall mode</div>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={readiness.momentumWithCum} margin={{ top: 4, right: 16, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" />
              <XAxis dataKey="week" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="cumTotal" name="all" stroke="#818cf8" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="cumCompleted" name="cumulative" stroke="#60a5fa" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Highest Priority Equipment */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px 12px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Highest Priority Equipment</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Top rows by risk score</div>
          </div>
          <div>
            {readiness.withRisk.map((eq, i) => (
              <div key={eq.id || i} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 20px', borderTop: '1px solid var(--divider)',
                background: i % 2 === 1 ? 'rgba(255,255,255,0.015)' : 'transparent',
              }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{eq.name || 'Unnamed'}</span>
                  <span style={{ fontSize: 12, color: '#64748b', marginLeft: 6 }}>{eq.description ? eq.description.slice(0, 30) : 'No description'}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: '#64748b', background: 'var(--progress-track)', padding: '3px 8px', borderRadius: 5 }}>
                    Risk {eq.riskScore}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: PRIORITY_COLORS[eq.priority] || '#94a3b8', background: `${PRIORITY_COLORS[eq.priority] || '#94a3b8'}15`, padding: '3px 8px', borderRadius: 5 }}>
                    {eq.priority}
                  </span>
                </div>
              </div>
            ))}
            {!readiness.withRisk.length && (
              <div style={{ padding: '32px', textAlign: 'center', color: '#475569', fontSize: 13 }}>No equipment risk data available.</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Equipment-Checklist Matrix ───────────────────────────────────── */}
      <EquipmentChecklistMatrix matrix={matrix} loading={matrixLoading} />
    </div>
  )
}
