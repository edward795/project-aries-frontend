/**
 * EquipmentChecklistMatrix — redesigned to match slide 14
 *
 * Key visual changes vs previous version:
 *  - Equipment row: ID in bold + colored commissioning-level dot + status label
 *  - ChecklistCell: colored status button badge with "Xch" suffix + issues count + progress bar
 *  - VendorCell: same card style as ChecklistCell
 *  - Commissioning level dot colors match CxAlloy levels (L1=red, L2=yellow, L3=green, L4=blue)
 */
import EquipmentDetailPanel from './EquipmentDetailPanel'
import React, { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'

// ─── Color tokens ──────────────────────────────────────────────────────────────
const C = {
  text:    'var(--text-primary)',
  muted:   '#64748b',
  dim:     '#334155',
  border:  'var(--border)',
  divider: 'var(--divider)',
  card:    'var(--bg-card)',
}

const COL = { red: '#ef4444', yellow: '#eab308', green: '#22c55e', l2: '#3b82f6', l3: '#a855f7' }

// Commissioning level → dot color mapping (mirrors CxAlloy status levels)
const LEVEL_COLOR = {
  'Not Assigned':      '#475569',
  'Asset Assigned':    '#64748b',
  'Pre-Cx':            '#f59e0b',
  'Cx In Progress':    '#3b82f6',
  'Cx Complete':       '#22c55e',
  'Ready For Startup': '#4ade80',
  'In Service':        '#a78bfa',
  'Closed':            '#22c55e',
  'Unassigned':        '#475569',
  // L-level strings (if raw status comes through)
  'L1':  '#ef4444',
  'L2':  '#eab308',
  'L3':  '#22c55e',
  'L4':  '#3b82f6',
  'L5':  '#a855f7',
}

function levelColor(status) {
  if (!status) return '#475569'
  if (LEVEL_COLOR[status]) return LEVEL_COLOR[status]
  const s = status.toLowerCase()
  if (s.includes('l1') || s.includes('fwt') || s.includes('fat')) return '#ef4444'
  if (s.includes('l2') || s.includes('yellow') || s.includes('qaqc') || s.includes('conditional')) return '#eab308'
  if (s.includes('l3') || s.includes('green') || s.includes('energis') || s.includes('startup')) return '#22c55e'
  if (s.includes('l4') || s.includes('blue') || s.includes('functional') || s.includes('performance')) return '#3b82f6'
  if (s.includes('l5') || s.includes('integrated') || s.includes('system test')) return '#a855f7'
  if (s.includes('complete') || s.includes('closed') || s.includes('service')) return '#22c55e'
  if (s.includes('progress') || s.includes('cx in')) return '#3b82f6'
  if (s.includes('assigned') && !s.includes('not')) return '#64748b'
  return '#475569'
}

// ─── ChecklistCell ─────────────────────────────────────────────────────────────
// Matches slide 14: colored status button with "Xch" count + issues row + progress bar
function ChecklistCell({ stat, colColor }) {
  // When no checklists at this level — show "Not Started" label (not just "—")
  if (!stat || stat.total === 0) {
    return (
      <td style={tdS()}>
        <div style={{ padding: '10px 12px', minHeight: 72 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            background: 'rgba(71,85,105,0.08)', border: '1px solid rgba(71,85,105,0.18)',
            borderRadius: 6, padding: '4px 10px', marginBottom: 5,
          }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Not Started</span>
          </div>
          <div style={{ fontSize: 10, color: '#334155' }}>0 items | 0 issues</div>
        </div>
      </td>
    )
  }

  const isApproved   = stat.statusLabel === 'Checklist Approved'
  const isInProgress = stat.statusLabel === 'In Progress'
  const isReturned   = stat.statusLabel === 'Returned with Comments'
  const pct = stat.total > 0 ? Math.round(stat.closed / stat.total * 100) : 0

  // Badge appearance matching slide 14
  const badgeBg    = isApproved ? 'rgba(34,197,94,0.15)'   : isInProgress ? 'rgba(234,179,8,0.15)'   : isReturned ? 'rgba(239,68,68,0.12)'   : 'rgba(71,85,105,0.15)'
  const badgeBdr   = isApproved ? 'rgba(34,197,94,0.35)'   : isInProgress ? 'rgba(234,179,8,0.35)'   : isReturned ? 'rgba(239,68,68,0.3)'    : 'rgba(71,85,105,0.3)'
  const badgeColor = isApproved ? '#22c55e'                 : isInProgress ? '#eab308'                : isReturned ? '#f87171'                 : '#64748b'
  const barColor   = isApproved ? '#22c55e'                 : isInProgress ? '#eab308'                : isReturned ? '#f87171'                 : 'rgba(255,255,255,0.1)'

  return (
    <td style={tdS()}>
      <div style={{ padding: '10px 12px', minHeight: 72 }}>
        {/* Status badge with checklist count — "Checklist Approved 7ch" */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          background: badgeBg, border: `1px solid ${badgeBdr}`,
          borderRadius: 6, padding: '4px 10px', marginBottom: 5,
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: badgeColor }}>{stat.statusLabel}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: badgeColor, opacity: 0.7 }}>{stat.total}ch</span>
        </div>

        {/* Closed count + issues on one line — e.g. "7/7 closed | 14 issues" */}
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>
          {stat.closed}/{stat.total} closed
          {(stat.issueCount > 0 || stat.issuesClosed > 0) && (
            <span style={{ color: stat.issueCount > 0 ? '#f97316' : '#22c55e', fontWeight: 600, marginLeft: 5 }}>
              | {stat.issueCount > 0
                  ? `${stat.issueCount} issues`
                  : `${stat.issuesClosed} issues closed`}
            </span>
          )}
        </div>

        {/* Progress bar */}
        <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 99, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 99, transition: 'width 0.4s' }} />
        </div>
        <div style={{ fontSize: 9, color: '#475569', marginTop: 2 }}>{stat.closed}/{stat.total}</div>
      </div>
    </td>
  )
}

// ─── VendorCell — only renders content when vendor checklists exist ─────────────
function VendorCell({ stat }) {
  // Show "—" when there are no vendor checklists (total=0), regardless of vendorName.
  // Previously showed "MECHANICAL Ready" as a placeholder even when no data existed.
  if (!stat || stat.total === 0) {
    return (
      <td style={tdS()}>
        <div style={{ padding: '10px 12px', minHeight: 72 }}>
          <div style={{ fontSize: 10, color: '#334155' }}>Not Started</div>
          <div style={{ fontSize: 10, color: '#334155', marginTop: 2 }}>0 items | 0 issues</div>
        </div>
      </td>
    )
  }
  // Has actual vendor checklists — render same badge style as ChecklistCell
  return <ChecklistCell stat={stat} colColor={COL.l2} />
}

// ─── EquipmentRow — matches slide 14: ID + colored level dot + status label ───
function EquipmentRow({ row, idx, onSelect }) {
  const statusColor    = levelColor(row.status)
  const checklistLabel = row.checklistTotal > 0 ? `${row.checklistClosed}/${row.checklistTotal}` : null
  const testsLabel     = row.testsTotal > 0
    ? `Tests ${rowTestsClosed(row)}/${row.testsTotal}` : null
  // row.issuesOpen is populated from real issue join or equipment.issueCount
  const issueCount     = rowIssuesOpen(row)

  return (
    <tr
      style={{ background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)', borderBottom: `1px solid ${C.divider}`, cursor: onSelect ? 'pointer' : 'default' }}
      onClick={() => onSelect && onSelect({ id: row.externalId || row.tag, type: row.equipmentType })}
      title={onSelect ? 'Click to view details' : undefined}
    >
      <td style={{ ...tdS(), minWidth: 220 }}>
        <div style={{ padding: '10px 16px' }}>
          {/* Equipment ID — bold primary */}
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 4 }}>
            {row.tag || row.externalId || row.name || 'Unnamed'}
          </div>
          {/* Colored dot + commissioning status label (matches slide 14) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: `0 0 5px ${statusColor}60` }} />
            <span style={{ fontSize: 11, color: statusColor, fontWeight: 600 }}>
              {row.status || 'Not Assigned'}
            </span>
          </div>
          {/* Badge row: checklists / issues / tests */}
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {checklistLabel && (
              <span style={badgeS('rgba(34,197,94,0.1)', 'rgba(34,197,94,0.25)', '#22c55e')}>
                {checklistLabel} closed
              </span>
            )}
            {issueCount > 0 && (
              <span style={badgeS('rgba(249,115,22,0.1)', 'rgba(249,115,22,0.25)', '#f97316')}>
                {issueCount} issues
              </span>
            )}
            {testsLabel && (
              <span style={badgeS('rgba(168,85,247,0.1)', 'rgba(168,85,247,0.25)', '#c084fc')}>
                {testsLabel}
              </span>
            )}
          </div>
        </div>
      </td>

      <ChecklistCell stat={row.redTags}    colColor={COL.red}    />
      <ChecklistCell stat={row.yellowTags} colColor={COL.yellow} />
      <ChecklistCell stat={row.greenTags}  colColor={COL.green}  />
      <VendorCell    stat={row.l2Vendor} />
      <VendorCell    stat={row.l3Vendor} />

      {/* Total */}
      <td style={{ ...tdS(), textAlign: 'center', verticalAlign: 'middle', borderRight: 'none' }}>
        <span style={{
          fontSize: 14, fontWeight: 800, color: C.text,
          background: 'rgba(59,130,246,0.12)',
          border: '1px solid rgba(59,130,246,0.25)',
          padding: '5px 12px', borderRadius: 8, display: 'inline-block',
        }}>
          {row.total || row.checklistTotal || 0}
        </span>
      </td>
    </tr>
  )
}

// ─── SystemGroupRow ────────────────────────────────────────────────────────────
// Helper: sum issue/test counts from per-cell ChecklistLevelStat objects
function statIssues(row) {
  // Sum issue counts from per-column stat cells (populated from checklist rawJson)
  return (row.redTags?.issueCount    || 0) + (row.yellowTags?.issueCount    || 0)
       + (row.greenTags?.issueCount  || 0) + (row.l2Vendor?.issueCount      || 0)
       + (row.l3Vendor?.issueCount   || 0)
}
function statIssuesClosed(row) {
  return (row.redTags?.issuesClosed  || 0) + (row.yellowTags?.issuesClosed  || 0)
       + (row.greenTags?.issuesClosed|| 0) + (row.l2Vendor?.issuesClosed    || 0)
       + (row.l3Vendor?.issuesClosed || 0)
}
function rowIssuesOpen(row) {
  // row.issuesOpen is the authoritative count from the backend:
  //   - Joined from Issue table by assetId (most accurate after re-sync)
  //   - Falls back to equipment.issueCount (synced from CxAlloy ?include=issues)
  // Use statIssues (cell-level rawJson) only if row.issuesOpen is missing
  const direct = row.issuesOpen || 0
  if (direct > 0) return direct
  return statIssues(row)
}
function rowTestsTotal(row) {
  // row.testsTotal is populated from:
  //   - equipment.testCount (synced from CxAlloy ?include=tests)
  //   - Checklist rawJson test_count fallback
  return row.testsTotal || 0
}
function rowTestsClosed(row) {
  // row.testsClosed is populated from CxAlloy test array status counts at sync time
  return row.testsClosed || 0
}

function SystemGroupRow({ systemName, rows, typeStats, isExpanded, onToggle, onSelectEquipment }) {
  // ── Get the equipment type name for this group ──────────────────────────────
  // systemName is the system (e.g. "BMS Panels group") but rows[0].equipmentType
  // is the type name that keys into typeStats (e.g. "BMS Panels")
  const typeName = rows[0]?.equipmentType || systemName

  // ── Use typeStats (computed in backend from synced DB data) when available ──
  // typeStats is a map: typeName → { issueCount, checklistCount, checklistClosed,
  //                                   testCount, testClosed, equipmentCount }
  // Falls back to aggregating from individual row data.
  const ts = typeStats?.[typeName]

  const units        = rows.length
  const totalCL      = ts ? ts.checklistCount  : rows.reduce((s, r) => s + (r.checklistTotal  || 0), 0)
  const closedCL     = ts ? ts.checklistClosed : rows.reduce((s, r) => s + (r.checklistClosed || 0), 0)
  const totalTests   = ts ? ts.testCount       : rows.reduce((s, r) => s + rowTestsTotal(r), 0)
  const closedTests  = ts ? ts.testClosed      : rows.reduce((s, r) => s + rowTestsClosed(r), 0)
  const openIssues   = ts ? ts.issueCount      : rows.reduce((s, r) => s + rowIssuesOpen(r), 0)
  const closedIssues = ts ? ts.issueClosed     : rows.reduce((s, r) => s + statIssuesClosed(r), 0)
  const clPct        = totalCL > 0 ? Math.round(closedCL / totalCL * 100) : 0
  const allClosed    = totalCL > 0 && closedCL === totalCL

  return (
    <>
      <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${C.divider}`, cursor: 'pointer' }} onClick={onToggle}>
        <td colSpan={7} style={{ padding: 0 }}>
          <div style={{ padding: '10px 16px 0 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ width: 18, height: 18, borderRadius: 4, background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                {isExpanded ? <ChevronDown size={11} color="#94a3b8" /> : <ChevronRight size={11} color="#94a3b8" />}
              </div>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: allClosed ? '#22c55e' : '#60a5fa', flexShrink: 0 }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{systemName}</span>
              <span style={{ fontSize: 11, color: C.muted }}>{units} units</span>
              {allClosed && <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600 }}>Closed</span>}
              <div style={{ display: 'flex', gap: 5, marginLeft: 4, flexWrap: 'wrap' }}>
                {/* Issues badge — RED, always shown */}
                <span style={badgeS('rgba(239,68,68,0.12)', 'rgba(239,68,68,0.3)', '#f87171')}>
                  Issues {openIssues}
                </span>
                {/* Checklists badge — GREEN */}
                {totalCL > 0 && (
                  <span style={badgeS('rgba(34,197,94,0.1)', 'rgba(34,197,94,0.25)', '#22c55e')}>
                    Checklists {closedCL}/{totalCL}
                  </span>
                )}
                {/* Tests badge — YELLOW/AMBER, always shown */}
                <span style={badgeS('rgba(234,179,8,0.1)', 'rgba(234,179,8,0.25)', '#fbbf24')}>
                  Tests {closedTests}/{totalTests}
                </span>
              </div>
            </div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 5, marginLeft: 26, marginBottom: 6 }}>
              Issue Split &nbsp;
              <span style={{ color: openIssues > 0 ? '#f87171' : '#22c55e' }}>
                {openIssues} open
              </span>
              {' / '}
              <span style={{ color: closedIssues > 0 ? '#22c55e' : C.muted }}>
                {closedIssues > 0 ? closedIssues : closedCL} closed
              </span>
            </div>
          </div>
          <div style={{ height: 3, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
            <div style={{ width: `${clPct}%`, height: '100%', background: clPct === 100 ? '#22c55e' : '#eab308', transition: 'width 0.5s' }} />
          </div>
        </td>
      </tr>
      {isExpanded && rows.map((row, i) => (
        <EquipmentRow key={row.equipmentId || row.externalId || i} row={row} idx={i} onSelect={onSelectEquipment} />
      ))}
    </>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function tdS() { return { padding: 0, borderRight: `1px solid ${C.divider}`, verticalAlign: 'top' } }
function badgeS(bg, border, color) {
  return { fontSize: 10, padding: '2px 7px', borderRadius: 99, background: bg, border: `1px solid ${border}`, color, fontWeight: 600 }
}

const TH = {
  padding: '11px 14px', fontSize: 10, fontWeight: 700, color: C.muted,
  textTransform: 'uppercase', letterSpacing: '0.07em',
  borderRight: `1px solid ${C.divider}`, whiteSpace: 'nowrap',
  background: 'var(--bg-card)', position: 'sticky', top: 0, zIndex: 2,
}

function Pill({ label }) {
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 11px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', color: '#94a3b8', border: `1px solid ${C.border}` }}>{label}</span>
}

function selS() {
  return { background: 'rgba(255,255,255,0.05)', border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', cursor: 'pointer', outline: 'none' }
}

// ─── Main Component ────────────────────────────────────────────────────────────
export default function EquipmentChecklistMatrix({ matrix, loading }) {
  const [search,       setSearch]       = useState('')
  const [typeFilter,   setTypeFilter]   = useState('All Types')
  const [statusFilter, setStatusFilter] = useState('All Statuses')
  const [expanded,     setExpanded]     = useState({})
  const [selectedEquipment, setSelectedEquipment] = useState(null)

  const typeOptions = useMemo(() => {
    if (!matrix?.rows) return ['All Types']
    return ['All Types', ...[...new Set(matrix.rows.map(r => r.equipmentType).filter(Boolean))].sort()]
  }, [matrix])

  const statusOptions = useMemo(() => {
    if (!matrix?.rows) return ['All Statuses']
    return ['All Statuses', ...[...new Set(matrix.rows.map(r => r.status).filter(Boolean))].sort()]
  }, [matrix])

  const filtered = useMemo(() => {
    if (!matrix?.rows) return []
    return matrix.rows.filter(r => {
      if (search) {
        const q = search.toLowerCase()
        if (!(r.name||'').toLowerCase().includes(q) && !(r.tag||'').toLowerCase().includes(q) && !(r.externalId||'').toLowerCase().includes(q)) return false
      }
      if (typeFilter   !== 'All Types'    && r.equipmentType !== typeFilter)   return false
      if (statusFilter !== 'All Statuses' && r.status        !== statusFilter) return false
      return true
    })
  }, [matrix, search, typeFilter, statusFilter])

  const grouped = useMemo(() => {
    const map = new Map()
    filtered.forEach(r => {
      const sys = r.systemName || 'General'
      if (!map.has(sys)) map.set(sys, [])
      map.get(sys).push(r)
    })
    return map
  }, [filtered])

  const toggle = name => setExpanded(p => ({ ...p, [name]: !(p[name] ?? false) }))

  if (loading) return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 36, textAlign: 'center', color: C.muted }}>
      <div style={{ width: 26, height: 26, border: '3px solid #1e293b', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
      Loading equipment matrix…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  if (!matrix?.rows?.length) return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
      No equipment matrix data available for this project.
      <br /><br />
      <span style={{ fontSize: 12 }}>
        Sync <strong>Equipment</strong> and <strong>Checklists</strong> from the Sync page, then reload.
        Issues and Tests are optional — the matrix will display with checklist data alone.
      </span>
    </div>
  )

  return (
    <>
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid ${C.divider}` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>Equipment-Checklist Matrix</div>
            <div style={{ fontSize: 12, color: C.muted }}>Cross-reference of equipment vs checklist levels (L1 / L2 / L3) — issues and tests per equipment</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Pill label={`${matrix.totalUnits} equipment`} />
            <Pill label={`${matrix.totalSystems} systems`} />
            <Pill label={`${matrix.totalTypes} types`} />
          </div>
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end' }}>
          <div style={{ position: 'relative', minWidth: 180 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: C.muted }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search equipment..."
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.04)', border: `1px solid ${C.border}`, borderRadius: 7, padding: '7px 10px 7px 28px', fontSize: 12, color: 'var(--text-primary)', outline: 'none' }} />
          </div>
          <select value={typeFilter}   onChange={e => setTypeFilter(e.target.value)}   style={selS()}>
            {typeOptions.map(t => <option key={t}>{t}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selS()}>
            {statusOptions.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', maxHeight: 680, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 960 }}>
          <colgroup>
            <col style={{ width: '21%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '7%'  }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...TH, textAlign: 'left' }}>Equipment</th>
              <th style={{ ...TH, color: COL.red    }}>L1 — Red Tags</th>
              <th style={{ ...TH, color: COL.yellow }}>L2 — Yellow Tags</th>
              <th style={{ ...TH, color: COL.green  }}>L3 — Green Tags</th>
              <th style={{ ...TH, color: COL.l2     }}>L2 Vendor</th>
              <th style={{ ...TH, color: COL.l3     }}>L3 Vendor</th>
              <th style={{ ...TH, textAlign: 'center', borderRight: 'none' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {[...grouped.entries()].map(([sysName, sysRows]) => (
              <SystemGroupRow
                key={sysName}
                systemName={sysName}
                rows={sysRows}
                typeStats={matrix.typeStats}
                onSelectEquipment={setSelectedEquipment}
                isExpanded={expanded[sysName] === true}
                onToggle={() => toggle(sysName)}
              />
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: C.muted, fontSize: 13 }}>No equipment matches the current filters.</div>
        )}
      </div>
    </div>

      {selectedEquipment && (
          <EquipmentDetailPanel
            externalId={selectedEquipment.id || selectedEquipment}
            equipmentType={selectedEquipment.type}
            onClose={() => setSelectedEquipment(null)}
          />
      )}
    </>
  )
}
