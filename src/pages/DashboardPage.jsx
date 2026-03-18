import React, { useState, useEffect, useMemo } from 'react'
import { AlertCircle, CheckCircle2, Activity, Target, Zap, TrendingUp } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useProject } from '../context/ProjectContext'
import { issuesApi, tasksApi, checklistsApi } from '../services/api'
import { DonutChart, StatCard, CardSkeleton } from '../components/ui'
import toast from 'react-hot-toast'

// ─── ISO week label ────────────────────────────────────────────────────────────
function isoWeekLabel(d) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = tmp.getUTCDay() || 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day)
  const yr = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1))
  const wk = Math.ceil((((tmp - yr) / 86400000) + 1) / 7)
  return `${tmp.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`
}

function pickDate(item) {
  return item.updatedAt || item.updated_at || item.createdAt || item.created_at || null
}

// ─── Period filter helpers ─────────────────────────────────────────────────────
function periodStart(period) {
  const now = new Date()
  if (period === 'D') return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (period === 'W') return new Date(now.getTime() - 7 * 86400000)
  if (period === 'M') return new Date(now.getTime() - 30 * 86400000)
  return null // Overall = no filter
}

function filterByPeriod(items, period) {
  const start = periodStart(period)
  if (!start) return items
  return items.filter(x => {
    const d = new Date(pickDate(x) || 0)
    return !isNaN(d) && d >= start
  })
}

// ─── Status buckets ────────────────────────────────────────────────────────────
const CLOSED_ST = new Set([
  'closed','completed','resolved','done','issue_closed',
  'accepted_by_owner','finished','signed_off','approved','passed',
  'checklist_approved','complete',   // new canonical tokens from updated backend
])
const isClosedSt = s => CLOSED_ST.has((s||'').toLowerCase().replace(/[ \-]/g,'_'))

// ─── Robust tag classifier — matches TrackerPulsePage.deriveTag() logic ────────
function classifyChecklistTag(c) {
  // 1. Direct color/tagColor field
  const directColor = (c.tagColor || c.tag_color || c.color || '').toLowerCase().trim()
  if (['red','yellow','green','blue'].includes(directColor)) return directColor

  // 2. tagLevel field (only if not 'white' — white is the fallback, not a real level)
  const tl = (c.tagLevel || c.tag_level || '').toLowerCase().trim()
  if (['red','yellow','green','blue'].includes(tl)) return tl

  // 3. checklistType string — e.g. "Level-2 YELLOW Tag QA/QC/IVC"
  const ct = (c.checklistType || c.checklist_type || '').toLowerCase()
  const fromCt = colorFromText(ct)
  if (fromCt) return fromCt

  // 4. Checklist name
  const fromName = colorFromText((c.name || '').toLowerCase())
  if (fromName) return fromName

  // 5. rawJson deep scan
  const raw = (c.rawJson || c.raw_json || '').toLowerCase()
  if (raw) {
    for (const field of ['tag_color','color','checklist_type_id','type_id','level_id',
                         'tag_level_id','checklist_type','type','tag_type','template_name','category']) {
      const m = raw.match(new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`))
      if (m) {
        const fromRaw = colorFromText(m[1])
        if (fromRaw) return fromRaw
      }
    }
  }

  return null // genuinely unclassifiable — exclude from tag breakdown
}

// ─── Color keyword extractor ───────────────────────────────────────────────────
function colorFromText(t) {
  if (!t) return null
  // ITR patterns
  if (/\bitr[-_\s]?a\b/.test(t)) return 'red'
  if (/\bitr[-_\s]?b\b/.test(t)) return 'yellow'
  if (/\bitr[-_\s]?c\b/.test(t)) return 'green'
  if (/\bitr[-_\s]?d\b/.test(t)) return 'blue'
  // Explicit color words (word boundary)
  if (/\bred\b/.test(t))    return 'red'
  if (/\byellow\b/.test(t)) return 'yellow'
  if (/\bgreen\b/.test(t))  return 'green'
  if (/\bblue\b/.test(t))   return 'blue'
  // Level labels
  if (t.includes('level-1') || t.includes('level 1')) return 'red'
  if (t.includes('level-2') || t.includes('level 2')) return 'yellow'
  if (t.includes('level-3') || t.includes('level 3')) return 'green'
  if (t.includes('level-4') || t.includes('level 4')) return 'blue'
  // Short tokens (word boundary)
  if (/\bl1\b/.test(t)) return 'red'
  if (/\bl2\b/.test(t)) return 'yellow'
  if (/\bl3\b/.test(t)) return 'green'
  if (/\bl4\b/.test(t)) return 'blue'
  // Numeric type-id (exact)
  if (t.trim() === '1') return 'red'
  if (t.trim() === '2') return 'yellow'
  if (t.trim() === '3') return 'green'
  if (t.trim() === '4') return 'blue'
  return null
}

// ─── Tag level breakdown — period-filtered, multi-strategy classification ──────
function buildTagLevels(checklists, period) {
  const filtered = filterByPeriod(checklists, period)
  const counts = { red: 0, yellow: 0, green: 0, blue: 0 }
  const done   = { red: 0, yellow: 0, green: 0, blue: 0 }

  filtered.forEach(c => {
    const tag = classifyChecklistTag(c)
    if (!tag) return          // genuinely unclassifiable — skip
    counts[tag] = (counts[tag] || 0) + 1
    if (isClosedSt(c.status)) done[tag] = (done[tag] || 0) + 1
  })

  return [
    { label: 'Level 1 — Red',    color: '#ef4444', done: done.red,    total: counts.red    },
    { label: 'Level 2 — Yellow', color: '#eab308', done: done.yellow, total: counts.yellow },
    { label: 'Level 3 — Green',  color: '#22c55e', done: done.green,  total: counts.green  },
    { label: 'Level 4 — Blue',   color: '#3b82f6', done: done.blue,   total: counts.blue   },
  ]
}
function buildChartData(issues, period) {
  const now = new Date()
  if (period === 'D') {
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
    const buckets = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now); d.setDate(now.getDate() - (6 - i))
      return { week: dayNames[d.getDay()], dateStr: d.toISOString().slice(0,10), opened: 0, closed: 0 }
    })
    issues.forEach(iss => {
      const ds = new Date(pickDate(iss)||0).toISOString().slice(0,10)
      const b = buckets.find(b => b.dateStr === ds)
      if (!b) return
      isClosedSt(iss.status) ? b.closed++ : b.opened++
    })
    return buckets.map(({ week, opened, closed }) => ({ week, opened, closed }))
  }
  if (period === 'M') {
    const months = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      months.push({ label: d.toLocaleString('en-US',{month:'short'}), year: d.getFullYear(), month: d.getMonth(), opened: 0, closed: 0 })
    }
    issues.forEach(iss => {
      const d = new Date(pickDate(iss)||0)
      const b = months.find(m => m.year===d.getFullYear() && m.month===d.getMonth())
      if (!b) return
      isClosedSt(iss.status) ? b.closed++ : b.opened++
    })
    return months.map(({ label, opened, closed }) => ({ week: label, opened, closed }))
  }
  // Weekly (W) and Overall both use last 8 ISO weeks
  const weekBuckets = new Map()
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i*7)
    const wk = isoWeekLabel(d)
    if (!weekBuckets.has(wk)) weekBuckets.set(wk, { week: wk, opened: 0, closed: 0 })
  }
  issues.forEach(iss => {
    const wk = isoWeekLabel(new Date(pickDate(iss)||0))
    if (!weekBuckets.has(wk)) return
    isClosedSt(iss.status)
      ? weekBuckets.get(wk).closed++
      : weekBuckets.get(wk).opened++
  })
  return [...weekBuckets.values()].map(b => ({ ...b, week: b.week.replace(/^\d{4}-/,'') }))
}

// ─── Tooltip ───────────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 13px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill, display: 'inline-block' }} />
          <span style={{ color: 'var(--text-secondary)' }}>{p.name}:</span>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Period label helper ───────────────────────────────────────────────────────
function periodLabel(period) {
  if (period === 'D') return 'Daily'
  if (period === 'W') return 'Weekly'
  if (period === 'M') return 'Monthly'
  return 'Overall'
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { activeProject, period } = useProject()
  const [loading, setLoading] = useState(true)
  const [allData, setAllData] = useState(null) // all raw data, un-filtered

  // Load ALL data once on project change — period filtering is done client-side
  useEffect(() => {
    if (!activeProject) return
    setLoading(true)
    const projectId = activeProject.externalId
    Promise.all([
      issuesApi.getAll(projectId).then(r => r.data?.data || []),
      tasksApi.getAll({ projectId }).then(r => r.data?.data || []),
      checklistsApi.getAll(projectId).then(r => r.data?.data || []),
    ])
    .then(([issues, tasks, checklists]) => setAllData({ issues, tasks, checklists }))
    .catch(() => toast.error('Failed to load dashboard data'))
    .finally(() => setLoading(false))
  }, [activeProject?.externalId])

  // ── Period-filtered derived values ─────────────────────────────────────────
  const derived = useMemo(() => {
    if (!allData) return null
    const { issues, tasks, checklists } = allData

    const filtIssues     = filterByPeriod(issues,     period)
    const filtChecklists = filterByPeriod(checklists, period)

    const openIssues   = filtIssues.filter(i => !isClosedSt(i.status))
    const closedIssues = filtIssues.filter(i =>  isClosedSt(i.status))

    const finishedCL = filtChecklists.filter(c => isClosedSt(c.status))
    const completionRate = filtChecklists.length > 0
      ? Math.round(finishedCL.length / filtChecklists.length * 1000) / 10
      : 0

    return {
      totalIssues:     filtIssues.length,
      openIssues:      openIssues.length,
      closedIssues:    closedIssues.length,
      totalTasks:      tasks.length,            // tasks don't have date filter
      totalChecklists: filtChecklists.length,
      finishedCL:      finishedCL.length,
      completionRate,
      filtIssues,
      filtChecklists,
    }
  }, [allData, period])

  const tagLevels  = useMemo(() => buildTagLevels(allData?.checklists || [], period), [allData, period])
  const chartData  = useMemo(() => buildChartData(allData?.issues || [], period),     [allData, period])

  const chartMax = chartData.length
    ? Math.max(...chartData.flatMap(d => [d.opened||0, d.closed||0]), 1)
    : 10

  // ── Empty / loading states ─────────────────────────────────────────────────
  if (!activeProject) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:300, gap:12 }}>
        <div style={{ width:56, height:56, borderRadius:16, background:'var(--bg-card-light)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <Activity size={24} color="var(--text-muted)" />
        </div>
        <div style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)' }}>No Project Selected</div>
        <div style={{ fontSize:13, color:'var(--text-muted)' }}>Select a project to view its dashboard</div>
      </div>
    )
  }

  if (loading || !derived) {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[...Array(4)].map((_,i)=><CardSkeleton key={i}/>)}</div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">{[...Array(3)].map((_,i)=><CardSkeleton key={i}/>)}</div>
      </div>
    )
  }

  const plabel = periodLabel(period)

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Project Header ──────────────────────────────────────────────── */}
      <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'var(--shadow-card)' }}>
        <div>
          <div style={{ fontSize:10, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:4 }}>Active Project</div>
          <div style={{ fontSize:18, fontWeight:800, color:'var(--text-primary)', marginBottom:6 }}>{activeProject.name}</div>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <span style={{ fontSize:11, fontWeight:600, color:'#0ea5e9', background:'rgba(14,165,233,0.10)', padding:'2px 9px', borderRadius:6, fontFamily:'monospace' }}>
              {activeProject.externalId}
            </span>
            {activeProject.status && <span style={{ fontSize:12, color:'var(--text-muted)' }}>{activeProject.status}</span>}
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginBottom:4 }}>Last Synced</div>
          <div style={{ fontSize:12, color:'var(--text-secondary)', fontFamily:'monospace' }}>
            {activeProject.syncedAt ? new Date(activeProject.syncedAt).toLocaleString() : 'Not yet synced'}
          </div>
          {/* Period indicator */}
          <div style={{ marginTop:6, fontSize:11, color:'#0ea5e9', fontWeight:600 }}>
            View: {plabel}
          </div>
        </div>
      </div>

      {/* ── Overall Completion + Tag Level Donuts ────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'2fr 3fr', gap:16 }}>

        {/* Overall completion donut */}
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'24px 20px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', boxShadow:'var(--shadow-card)' }}>
          <div style={{ fontSize:11, fontWeight:600, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:6 }}>Overall Completion</div>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginBottom:16, opacity:0.7 }}>{plabel} period</div>
          <DonutChart
            value={derived.finishedCL}
            total={Math.max(derived.totalChecklists, 1)}
            color="#0ea5e9"
            size={128}
          />
          <div style={{ marginTop:16, textAlign:'center' }}>
            <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)' }}>
              {derived.totalChecklists - derived.finishedCL} remaining
            </div>
            <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
              out of {derived.totalChecklists} checklists ·{' '}
              <span style={{ color:'#22c55e', fontWeight:700 }}>{derived.completionRate}%</span>
            </div>
          </div>
        </div>

        {/* Tag level donuts — period-filtered, colored per level */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {tagLevels.map(level => {
            const pct = level.total > 0 ? Math.round(level.done / level.total * 100) : 0
            return (
              <div key={level.label} style={{
                background: `${level.color}08`,
                border: `1px solid ${level.color}25`,
                borderRadius:14, padding:'18px 12px',
                display:'flex', flexDirection:'column', alignItems:'center', gap:8,
                boxShadow:'var(--shadow-card)'
              }}>
                <DonutChart
                  value={level.done}
                  total={level.total}
                  color={level.color}
                  size={84}
                />
                <div style={{ fontSize:11, color:'var(--text-secondary)', textAlign:'center', fontWeight:600, lineHeight:1.3 }}>
                  {level.label}
                </div>
                <div style={{ fontSize:11, fontWeight:700, color: level.total > 0 ? level.color : 'var(--text-muted)' }}>
                  {level.done} / {level.total}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Summary Matrix + Bar Chart ───────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>

        {/* Summary Matrix — period-filtered issue counts */}
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'20px', boxShadow:'var(--shadow-card)' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)', marginBottom:2 }}>Summary Matrix</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:18 }}>
            Issues — closed vs open · <span style={{ color:'#0ea5e9', fontWeight:600 }}>{plabel}</span>
          </div>
          <div style={{ display:'flex', gap:20, alignItems:'center' }}>
            <div style={{ flexShrink:0 }}>
              <DonutChart
                value={derived.closedIssues}
                total={Math.max(derived.totalIssues, 1)}
                color="#22c55e"
                size={104}
                label="Closed"
              />
            </div>
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:8 }}>
              {[
                { label:'TOTAL ISSUES',  val: derived.totalIssues,  color:'var(--text-primary)' },
                { label:'ISSUES CLOSED', val: derived.closedIssues, color:'#22c55e' },
                { label:'ISSUES OPEN',   val: derived.openIssues,   color:'#f59e0b' },
              ].map(s => (
                <div key={s.label} style={{ background:'var(--bg-card-light)', border:'1px solid var(--border)', borderRadius:10, padding:'10px 14px' }}>
                  <div style={{ fontSize:9, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:3 }}>{s.label}</div>
                  <div style={{ fontSize:22, fontWeight:800, color:s.color }}>{s.val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Issue breakdown bar chart — period-responsive */}
        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'20px', boxShadow:'var(--shadow-card)' }}>
          <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary)', marginBottom:2 }}>
            {plabel} Issue Breakdown
          </div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:6 }}>
            Opened vs closed — actual data from DB
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom:14, fontSize:12, color:'var(--text-muted)' }}>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:10, height:10, borderRadius:2, background:'#22c55e', display:'inline-block' }} />Closed
            </span>
            <span style={{ display:'flex', alignItems:'center', gap:5 }}>
              <span style={{ width:10, height:10, borderRadius:2, background:'#f97316', display:'inline-block' }} />Opened
            </span>
            <span style={{ marginLeft:'auto', fontSize:22, fontWeight:800, color:'var(--text-primary)' }}>
              {chartData.reduce((s,d) => s + (d.closed||0), 0)}
              <span style={{ fontSize:11, fontWeight:400, color:'var(--text-muted)', marginLeft:6 }}>closed this period</span>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chartData} barSize={14} barGap={3}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
              <XAxis dataKey="week" tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill:'var(--text-muted)', fontSize:10 }} axisLine={false} tickLine={false} domain={[0, Math.ceil(chartMax*1.2)]} width={24} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill:'var(--divider)' }} />
              <Bar dataKey="closed" name="Closed" fill="#22c55e" radius={[3,3,0,0]} />
              <Bar dataKey="opened" name="Opened" fill="#f97316" radius={[3,3,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Key Metrics — period-filtered ────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:14 }}>
        <StatCard label="Total Issues"  value={derived.totalIssues}  sub={`in ${plabel.toLowerCase()} period`}  icon={AlertCircle}  color="sky"    />
        <StatCard label="Open Issues"   value={derived.openIssues}   sub="need attention"                        icon={Activity}     color="yellow" />
        <StatCard label="Closed Issues" value={derived.closedIssues} sub="resolved"                              icon={CheckCircle2} color="green"  />
        <StatCard label="Tasks"         value={derived.totalTasks}   sub="total tasks"                           icon={Target}       color="purple" />
      </div>

      {/* ── Project Health Insight ────────────────────────────────────────── */}
      <div style={{ background:'var(--bg-card)', border:'1px solid rgba(234,179,8,0.22)', borderRadius:16, padding:'18px 20px', boxShadow:'var(--shadow-card)' }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>
          <div style={{ width:34, height:34, borderRadius:10, background:'rgba(234,179,8,0.12)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:2 }}>
            <Zap size={16} color="#eab308" />
          </div>
          <div>
            <div style={{ fontSize:10, fontWeight:700, color:'#d97706', textTransform:'uppercase', letterSpacing:'0.09em', marginBottom:6 }}>
              Project Health Insight · {plabel}
            </div>
            <p style={{ fontSize:14, color:'var(--text-secondary)', lineHeight:1.6, margin:0 }}>
              {derived.completionRate >= 90
                ? `Outstanding execution — ${derived.completionRate}% checklist completion (${derived.finishedCL} of ${derived.totalChecklists}). ${derived.openIssues} open issues remaining.`
                : derived.completionRate >= 70
                ? `Good progress at ${derived.completionRate}% checklist completion. Monitor ${derived.openIssues} open issues to stay on track.`
                : `Caution: ${derived.openIssues} open issues require attention. Checklist completion is at ${derived.completionRate}%.`
              }
            </p>
            <div style={{ marginTop:10, display:'flex', gap:20, fontSize:12, color:'var(--text-muted)', flexWrap:'wrap' }}>
              <span>Completion: <strong style={{ color:'#22c55e' }}>{derived.completionRate}%</strong></span>
              <span>Checklists: <strong style={{ color:'var(--text-primary)' }}>{derived.finishedCL}/{derived.totalChecklists}</strong></span>
              <span>Open Issues: <strong style={{ color:'#f59e0b' }}>{derived.openIssues}</strong></span>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
