import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { Sparkles, Download, RefreshCw, FileText, Activity, Clock } from 'lucide-react'
import { useProject } from '../context/ProjectContext'
import { checklistsApi, issuesApi, briefsApi } from '../services/api'
import { generateAndDownloadReport } from '../services/reportGenerator'
import toast from 'react-hot-toast'

// ── Helpers ────────────────────────────────────────────────────────────────────
function getISOWeekLabel(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const wk = Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`
}

function fmtDate(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}

function fmtTime(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }
  catch { return '' }
}

function reportTypeLabel(period) {
  if (period === 'D') return 'Daily Report'
  if (period === 'W') return 'Weekly Snapshot'
  if (period === 'M') return 'Monthly Report'
  return 'Overall Snapshot'
}

// ── Period badge ───────────────────────────────────────────────────────────────
function PeriodBadge({ period }) {
  const map = {
    D: ['#fbbf24','rgba(251,191,36,0.12)'],
    W: ['#60a5fa','rgba(96,165,250,0.12)'],
    M: ['#a78bfa','rgba(167,139,250,0.12)'],
    Overall: ['#34d399','rgba(52,211,153,0.12)'],
  }
  const [color, bg] = map[period] || map.Overall
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '2px 7px',
      borderRadius: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {period || 'Overall'}
    </span>
  )
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, color, icon: Icon }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '18px 20px', flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
        {Icon && <Icon size={15} style={{ color: color || '#60a5fa', opacity: 0.7 }} />}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: color || '#60a5fa', lineHeight: 1, marginBottom: 5 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{sub}</div>}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function TrackerBriefsPage() {
  const { selectedProjects, activeProject, period } = useProject()
  const targets = selectedProjects.length > 0
    ? selectedProjects
    : (activeProject ? [activeProject] : [])

  const portfolioTitle = targets.length > 1
    ? `${targets.length} Projects Portfolio`
    : (targets[0]?.name || 'No project selected')

  const visibleWindow = period === 'D' ? 'Daily' : period === 'W' ? 'Weekly'
    : period === 'M' ? 'Monthly' : 'Overall'

  // ── State ─────────────────────────────────────────────────────────────────
  const [briefs,        setBriefs]        = useState([])
  const [briefsLoading, setBriefsLoading] = useState(false)
  const [generating,    setGenerating]    = useState(false)
  const [exporting,     setExporting]     = useState(false)
  const [lastExport,    setLastExport]    = useState(null)

  // ── Fetch briefs ──────────────────────────────────────────────────────────
  const fetchBriefs = useCallback(async (quiet = false) => {
    if (!targets.length) { setBriefs([]); return }
    if (!quiet) setBriefsLoading(true)
    try {
      const results = await Promise.all(
        targets.map(p =>
          briefsApi.getByProject(p.externalId, period)
            .then(r => r.data?.data || []).catch(() => [])
        )
      )
      setBriefs(results.flat().sort((a, b) => new Date(b.exportedAt || 0) - new Date(a.exportedAt || 0)))
    } finally {
      if (!quiet) setBriefsLoading(false)
    }
  }, [targets.map(p => p.externalId).join(','), period]) // eslint-disable-line

  useEffect(() => {
    if (!targets.length) return
    fetchBriefs().then(async () => {
      if (briefs.length === 0) {
        try {
          await Promise.all(targets.map(p => briefsApi.generate(p.externalId, period).catch(() => null)))
          await fetchBriefs(true)
        } catch { /* silent */ }
      }
    })
  }, [targets.map(p => p.externalId).join(','), period]) // eslint-disable-line

  // ── Generate snapshot ─────────────────────────────────────────────────────
  const handleGenerateSnapshot = useCallback(async () => {
    if (!targets.length || generating) return
    setGenerating(true)
    try {
      await Promise.all(targets.map(p => briefsApi.generate(p.externalId, period)))
      await fetchBriefs(true)
      toast.success(`Snapshot generated for ${targets.length} project${targets.length > 1 ? 's' : ''}`)
    } catch {
      toast.error('Failed to generate snapshot')
    } finally {
      setGenerating(false)
    }
  }, [targets, generating, period, fetchBriefs])

  // ── Export PDF — uses the current period toggle (Overall/D/W/M) ──────────
  const handleExportPDF = useCallback(async () => {
    if (!targets.length || exporting) return
    setExporting(true)
    try {
      const dataResults = await Promise.all(
        targets.map(p => Promise.all([
          checklistsApi.getAll(p.externalId).then(r => r.data?.data || []).catch(() => []),
          issuesApi.getAll(p.externalId).then(r => r.data?.data || []).catch(() => []),
        ]))
      )
      const allChecklists = dataResults.flatMap(r => r[0])
      const allIssues     = dataResults.flatMap(r => r[1])

      const primaryProject = targets.length === 1 ? targets[0] : {
        name: portfolioTitle,
        externalId: targets.map(p => p.externalId).join(', '),
        id: targets[0]?.id,
      }

      // Direct PDF download — uses current period from global toggle
      await generateAndDownloadReport(primaryProject, allChecklists, allIssues, period)

      // Save brief record
      const weekLabel = getISOWeekLabel()
      await Promise.all(
        targets.map(p =>
          briefsApi.create({
            projectId: p.externalId,
            title:     `${p.name} ${reportTypeLabel(period)} ${weekLabel}`,
            subtitle:  `${reportTypeLabel(period)} | ${weekLabel}`,
            items:  allChecklists.filter(c => !c.projectId || c.projectId === p.externalId).length,
            issues: allIssues.filter(i => !i.projectId || i.projectId === p.externalId).length,
            period,
          }).catch(() => null)
        )
      )

      setLastExport({ period, time: new Date().toISOString() })
      await fetchBriefs(true)
      toast.success(`${reportTypeLabel(period)} downloaded as PDF`)
    } catch (err) {
      toast.error('PDF export failed: ' + (err.message || 'Unknown error'))
      console.error(err)
    } finally {
      setExporting(false)
    }
  }, [targets, exporting, period, portfolioTitle, fetchBriefs])

  // ── Derived values ─────────────────────────────────────────────────────────
  const visibleBriefs = useMemo(() =>
    briefs.filter(b => period === 'Overall' || !b.period || b.period === period),
    [briefs, period]
  )
  const totalItems  = briefs.reduce((s, b) => s + (b.items  || 0), 0)
  const totalIssues = briefs.reduce((s, b) => s + (b.issues || 0), 0)
  const exportStatus = exporting ? `Exporting ${visibleWindow}…`
    : generating ? 'Generating…'
    : lastExport ? `Done · ${fmtTime(lastExport.time)}`
    : 'Idle'
  const exportColor = (exporting || generating) ? '#f59e0b' : lastExport ? '#22c55e' : 'var(--text-muted)'

  if (!targets.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 12 }}>
        <FileText size={36} style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>No Project Selected</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Select a project to view its Tracker Briefs</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>Tracker Briefs</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            Export commissioning reports in PDF format · {visibleWindow} view
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            onClick={handleGenerateSnapshot}
            disabled={generating || !targets.length}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 16px', borderRadius: 9, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              color: generating ? 'var(--text-muted)' : '#a78bfa',
              transition: 'all 0.15s', opacity: generating ? 0.7 : 1,
            }}
          >
            {generating
              ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Generating…</>
              : <><Sparkles size={14} /> Generate Snapshot</>
            }
          </button>

          {/* Single Export PDF button — uses current period toggle */}
          <button
            onClick={handleExportPDF}
            disabled={exporting || !targets.length}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              padding: '9px 18px', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: exporting ? 'wait' : 'pointer',
              background: exporting ? 'rgba(14,165,233,0.7)' : '#0ea5e9',
              border: 'none', color: 'white',
              transition: 'all 0.15s', opacity: exporting ? 0.8 : 1,
              boxShadow: exporting ? 'none' : '0 2px 8px rgba(14,165,233,0.3)',
            }}
            onMouseEnter={e => { if (!exporting) e.currentTarget.style.background = '#0284c7' }}
            onMouseLeave={e => { if (!exporting) e.currentTarget.style.background = '#0ea5e9' }}
            title={`Download ${reportTypeLabel(period)} as PDF`}
          >
            {exporting
              ? <><RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} /> Exporting…</>
              : <><Download size={14} /> Export PDF</>
            }
          </button>
        </div>
      </div>

      {/* ── Export info note ──────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(14,165,233,0.07)', border: '1px solid rgba(14,165,233,0.18)',
        borderRadius: 10, padding: '11px 16px', fontSize: 12, color: 'var(--text-muted)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <Download size={14} style={{ color: '#0ea5e9', flexShrink: 0 }} />
        <span>
          <b style={{ color: 'var(--text-primary)' }}>Export PDF</b> uses the current period toggle above (Overall · D · W · M).
          Select the period you want, then click Export PDF — it downloads directly as a <b style={{ color: 'var(--text-primary)' }}>.pdf</b> file.
          {lastExport && <span style={{ color: '#22c55e', marginLeft: 8 }}>✓ Last export: {reportTypeLabel(lastExport.period)} at {fmtTime(lastExport.time)}</span>}
        </span>
      </div>

      {/* ── KPI Cards ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <KPICard label="Saved Reports"      value={briefsLoading ? '…' : briefs.length}          sub={`${visibleBriefs.length} visible in ${visibleWindow} mode`} color="#60a5fa" icon={FileText} />
        <KPICard label="Total Items Tracked" value={briefsLoading ? '…' : totalItems.toLocaleString()} sub="Checklists across all briefs"      color="#22c55e" icon={Activity} />
        <KPICard label="Issues Logged"       value={briefsLoading ? '…' : totalIssues.toLocaleString()} sub="Issues tracked in briefs"          color="#f87171" icon={Activity} />
        <KPICard label="Export Status"       value={exportStatus}                                  sub={lastExport ? `Last: ${reportTypeLabel(lastExport.period)}` : 'Click a report button above'} color={exportColor} icon={Clock} />
      </div>

      {/* ── Briefs Table ──────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '1px solid var(--border)', background: 'var(--bg-card-light)' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              Recent Briefings
              {visibleBriefs.length > 0 && (
                <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 8 }}>
                  ({visibleBriefs.length} in {visibleWindow} · {briefs.length} total)
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Snapshots generated from local DB data
            </div>
          </div>
          <button onClick={() => fetchBriefs()} disabled={briefsLoading}
            style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <RefreshCw size={12} style={{ animation: briefsLoading ? 'spin 1s linear infinite' : 'none' }} />
            Refresh
          </button>
        </div>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 90px 90px 130px',
          padding: '8px 20px', borderBottom: '1px solid var(--border-subtle)', background: 'var(--bg-card-light)' }}>
          {['Title / Subtitle', 'Period', 'Items', 'Issues', 'Generated'].map(h => (
            <div key={h} style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{h}</div>
          ))}
        </div>

        {briefsLoading ? (
          <div style={{ padding: '52px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            <RefreshCw size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: 10, color: '#60a5fa' }} />
            <div>Loading briefings…</div>
          </div>
        ) : visibleBriefs.length === 0 ? (
          <div style={{ padding: '52px', textAlign: 'center' }}>
            <FileText size={32} style={{ color: 'var(--text-muted)', opacity: 0.4, marginBottom: 12 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
              No briefings yet for {visibleWindow} mode
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
              Click <b>Generate Snapshot</b> to create a brief, or use the export buttons above to generate a PDF report
            </div>
          </div>
        ) : (
          visibleBriefs.map((b, i) => (
            <div
              key={b.id || i}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 120px 90px 90px 130px',
                padding: '13px 20px', borderTop: '1px solid var(--divider)',
                background: i % 2 === 1 ? 'var(--row-alt)' : 'transparent',
                transition: 'background 0.1s', cursor: 'default',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-light)'}
              onMouseLeave={e => e.currentTarget.style.background = i % 2 === 1 ? 'var(--row-alt)' : 'transparent'}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.title || '—'}</div>
                {b.subtitle && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{b.subtitle}</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}><PeriodBadge period={b.period} /></div>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, color: '#22c55e' }}>{(b.items ?? 0).toLocaleString()}</div>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 13, fontWeight: 700, color: '#f87171' }}>{(b.issues ?? 0).toLocaleString()}</div>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(b.exportedAt)}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
