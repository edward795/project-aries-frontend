import React, { useState, useEffect, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { useProject } from '../context/ProjectContext'
import { issuesApi } from '../services/api'

const STATUSES = ['Open', 'Correction In Progress', 'Ready For Verification', 'GC To Verify', 'CXA To Verify', 'Closed']
const PRIORITIES = ['P1 - Critical', 'P2 - High', 'P3 - Medium', 'P4 - Low']
const PRIORITY_COLORS = { 'P1 - Critical': '#ef4444', 'P2 - High': '#f97316', 'P3 - Medium': '#eab308', 'P4 - Low': '#22c55e' }

function normStatus(s) {
  const raw = (s || '').toLowerCase().replace(/ /g,'_')
  if (['open','issue_opened','active'].includes(raw)) return 'Open'
  if (['correction_in_progress','in_progress'].includes(raw)) return 'Correction In Progress'
  if (['ready_for_retest','ready_for_verification'].includes(raw)) return 'Ready For Verification'
  if (['gc_to_verify'].includes(raw)) return 'GC To Verify'
  if (['cxa_to_verify'].includes(raw)) return 'CXA To Verify'
  if (['issue_closed','closed','accepted_by_owner','done','resolved','completed'].includes(raw)) return 'Closed'
  return 'Open'
}

function normPriority(p) {
  if (!p || p.trim() === '') return 'P4 - Low'  // null priority → lowest priority bucket
  const raw = p.toLowerCase().trim()
  // CxAlloy returns exact strings: "P1 - Critical", "P2 - High", "P3 - Medium", "P4 - Low"
  if (raw === 'p1 - critical' || raw.includes('critical') || raw === 'p1' || raw === '1') return 'P1 - Critical'
  if (raw === 'p2 - high'     || raw.includes('high')     || raw === 'p2' || raw === '2') return 'P2 - High'
  if (raw === 'p3 - medium'   || raw.includes('medium')   || raw === 'p3' || raw === '3') return 'P3 - Medium'
  return 'P4 - Low'
}

function normSpace(i) {
  // location = pre-computed field from IssueService (space_id || zone_id || building_id || "Unassigned")
  // spaceId / zoneId / buildingId are also available as direct fields
  return i.location || i.spaceId || i.zoneId || i.buildingId || i.space || i.area || i.zone || i.building || 'Unassigned'
}

function computeRadar(issues) {
  const pressure = issues.filter(i => !['issue_closed','accepted_by_owner','closed','done','resolved','completed']
    .includes((i.status||'').toLowerCase())).length

  // Priority matrix: status x priority
  const matrix = {}
  STATUSES.forEach(s => { matrix[s] = {}; PRIORITIES.forEach(p => { matrix[s][p] = 0 }) })
  issues.forEach(i => {
    const s = normStatus(i.status)
    const p = normPriority(i.priority)
    if (matrix[s] && matrix[s][p] !== undefined) matrix[s][p]++
  })
  const matrixRows = STATUSES.map(s => ({
    status: s,
    ...PRIORITIES.reduce((acc, p) => ({ ...acc, [p]: matrix[s][p] }), {}),
    total: PRIORITIES.reduce((sum, p) => sum + matrix[s][p], 0),
  })).filter(r => r.total > 0)

  // Top space hotspot
  const spaceMap = new Map()
  issues.forEach(i => {
    const sp = normSpace(i)
    spaceMap.set(sp, (spaceMap.get(sp) || 0) + 1)
  })
  const topSpace = Array.from(spaceMap.entries()).sort((a, b) => b[1] - a[1])[0]

  // Hotspot bar chart data
  const hotspotData = Array.from(spaceMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([space, count]) => ({ space: space.length > 18 ? space.slice(0, 18) + '…' : space, count }))

  // Cycle risk: issues with multiple reopen/corrections
  const highCycleRisk = issues.filter(i => {
    const s = (i.status || '').toLowerCase()
    return ['correction_in_progress','gc_to_verify','cxa_to_verify','ready_for_retest'].includes(s)
  }).length

  // Quality score: 0 is best (low issues, low age, low churn)
  const now = new Date()
  const avgAge = issues.length > 0
    ? issues.reduce((sum, i) => {
        const created = new Date(i.createdAt || i.created_at || i.createdDate || now)
        return sum + (now - created) / 86400000
      }, 0) / issues.length : 0
  const qualityScore = Math.min(100, Math.round(avgAge / 10))

  return { pressure, highCycleRisk, topSpace: topSpace?.[0] || 'N/A', qualityScore, matrixRows, hotspotData }
}

function useMultiProjectData() {
  const { selectedProjects, activeProject } = useProject()
  const targets = selectedProjects.length > 0 ? selectedProjects : (activeProject ? [activeProject] : [])
  const [issues, setIssues] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!targets.length) return
    setLoading(true)
    Promise.all(targets.map(p => issuesApi.getAll(p.externalId).then(r => r.data?.data || []).catch(() => [])))
      .then(results => setIssues(results.flat()))
      .finally(() => setLoading(false))
  }, [targets.map(p => p.externalId).join(',')])

  return { issues, loading }
}

const StatCard = ({ label, value, sub, color }) => (
  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 22px', flex: 1 }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{label}</div>
    <div style={{ fontSize: 32, fontWeight: 800, color: color || 'var(--text-primary)', lineHeight: 1, marginBottom: 6 }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: '#64748b' }}>{sub}</div>}
  </div>
)

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: '#64748b', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: '#60a5fa', fontWeight: 700 }}>{p.value} issues</div>)}
    </div>
  )
}

export default function IssueRadarPage() {
  const { issues, loading } = useMultiProjectData()
  const radar = useMemo(() => computeRadar(issues), [issues])
  const { period } = useProject()

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
      {[...Array(4)].map((_, i) => <div key={i} style={{ background: 'var(--bg-card)', borderRadius: 12, height: 100, border: '1px solid var(--border)' }} />)}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Issue Radar</h2>
        <p style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Risk hotspots, workflow churn, and priority pressure.</p>
      </div>

      {/* 4 KPI cards */}
      <div style={{ display: 'flex', gap: 14 }}>
        <StatCard label="Issue Pressure" value={radar.pressure} sub="Estimated unresolved pressure" color="#f59e0b" />
        <StatCard label="High-Cycle Risk" value={radar.highCycleRisk} sub="Repeated correction loops" color="#f87171" />
        <StatCard label="Top Space" value={radar.topSpace} sub="Highest issue concentration" color="#60a5fa" />
        <StatCard label="Quality Score" value={radar.qualityScore} sub="Lower age and churn is better" color="var(--text-primary)" />
      </div>

      {/* Two panel layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }}>

        {/* Priority Matrix table */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px 14px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Priority Matrix</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Open pressure by state and priority</div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderTop: '1px solid var(--border)' }}>
                  <th style={{ padding: '10px 20px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em' }}>STATUS</th>
                  {[...PRIORITIES, 'TOTAL'].map(p => (
                    <th key={p} style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: p === 'TOTAL' ? '#475569' : (PRIORITY_COLORS[p] + 'cc'), textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                      {p.replace('P1 - ', 'P1\u00a0-\u00a0').replace('P2 - ', 'P2\u00a0-\u00a0').replace('P3 - ', 'P3\u00a0-\u00a0').replace('P4 - ', 'P4\u00a0-\u00a0')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {radar.matrixRows.map((row, i) => (
                  <tr key={row.status} style={{ borderTop: '1px solid var(--divider)', background: i % 2 === 1 ? 'var(--row-alt)' : 'transparent' }}>
                    <td style={{ padding: '12px 20px', fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>{row.status}</td>
                    {PRIORITIES.map(p => (
                      <td key={p} style={{ padding: '12px', textAlign: 'right', fontSize: 13, color: row[p] > 0 ? PRIORITY_COLORS[p] : '#334155', fontWeight: row[p] > 0 ? 700 : 400 }}>
                        {row[p]}
                      </td>
                    ))}
                    <td style={{ padding: '12px', textAlign: 'right', fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{row.total}</td>
                  </tr>
                ))}
                {!radar.matrixRows.length && (
                  <tr><td colSpan={6} style={{ padding: '32px', textAlign: 'center', color: '#475569', fontSize: 13 }}>No issues found for selected projects.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Issue Hotspots bar chart */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: '20px' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>Issue Hotspots</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>Hotspot ranking for {period === 'D' ? 'Daily' : period === 'W' ? 'Weekly' : 'Overall'}</div>
          {radar.hotspotData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={radar.hotspotData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="space" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={false} tickLine={false} width={90} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#3b5bdb" radius={[0, 4, 4, 0]}>
                  {radar.hotspotData.map((_, i) => (
                    <Cell key={i} fill={`rgba(59,91,219,${1 - i * 0.08})`} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#475569', fontSize: 13 }}>
              No issue hotspot data
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
