/**
 * EquipmentChecklistMatrix
 *
 * Renders the Equipment-Checklist Matrix table matching the screenshot layout:
 *   EQUIPMENT/SYSTEM | RED TAGS | YELLOW TAGS | GREEN TAGS | L2 VENDOR | L3 VENDOR | TOTAL
 *
 * Features:
 *   - System group header rows (collapsed by default, expandable)
 *   - Per-equipment checklist status cells with progress bar + issue count
 *   - L2/L3 Vendor columns showing discipline + readiness status
 *   - Header stats pills: X units | Y systems | Z types
 *   - Search + Type filter + Status filter
 */
import React, { useState, useMemo } from 'react'
import { ChevronDown, ChevronRight, Search, Filter } from 'lucide-react'

// ── Color tokens matching the dark theme ────────────────────────────────────
const COLORS = {
  redTag:    '#ef4444',
  yellowTag: '#eab308',
  greenTag:  '#22c55e',
  blueTag:   '#3b82f6',
  whiteTag:  '#94a3b8',
  approved:  '#22c55e',
  inProgress:'#eab308',
  notStarted:'#475569',
  bgCard:    'var(--bg-card)',
  border:    'var(--border)',
  divider:   'var(--divider)',
  textPri:   'var(--text-primary)',
}

const COL_COLORS = {
  red:    COLORS.redTag,
  yellow: COLORS.yellowTag,
  green:  COLORS.greenTag,
  l2:     COLORS.blueTag,
  l3:     '#a855f7',
}

// ── ChecklistCell ────────────────────────────────────────────────────────────
function ChecklistCell({ stat, color }) {
  if (!stat || stat.total === 0) {
    return (
      <td style={tdStyle()}>
        <div style={{ color: '#334155', fontSize: 11, textAlign: 'center' }}>—</div>
      </td>
    )
  }

  const labelColor = stat.statusLabel === 'Checklist Approved' ? COLORS.approved
    : stat.statusLabel === 'In Progress' ? COLORS.inProgress
    : COLORS.notStarted

  const pct = stat.total > 0 ? Math.round((stat.closed / stat.total) * 100) : 0

  return (
    <td style={tdStyle()}>
      <div style={{ padding: '10px 12px' }}>
        {/* Status label */}
        <div style={{ fontSize: 11, fontWeight: 700, color: labelColor, marginBottom: 3 }}>
          {stat.statusLabel}
        </div>
        {/* closed/total | issues */}
        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>
          {stat.closed}/{stat.total} closed
          {stat.issueCount > 0 && (
            <span style={{ color: '#f87171', marginLeft: 4 }}>
              | {stat.issueCount} issues
            </span>
          )}
        </div>
        {/* Progress bar */}
        <div style={{
          height: 3, borderRadius: 99,
          background: 'rgba(255,255,255,0.07)',
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${pct}%`, height: '100%',
            background: color || COLORS.approved,
            borderRadius: 99,
            transition: 'width 0.4s ease',
          }} />
        </div>
        {/* fraction */}
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>
          {stat.closed}/{stat.total}
        </div>
      </div>
    </td>
  )
}

// ── VendorCell ───────────────────────────────────────────────────────────────
function VendorCell({ stat }) {
  if (!stat || (!stat.vendorName && stat.total === 0)) {
    return <td style={tdStyle()}><div style={{ color: '#334155', fontSize: 11, textAlign: 'center' }}>—</div></td>
  }
  const statusColor = stat.vendorStatus === 'Ready' ? COLORS.approved
    : stat.vendorStatus === 'In Progress' ? COLORS.inProgress
    : '#475569'

  return (
    <td style={tdStyle()}>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: COLORS.textPri, marginBottom: 2 }}>
          {stat.vendorName || 'VENDOR'}
        </div>
        <div style={{ fontSize: 10, fontWeight: 600, color: statusColor }}>
          {stat.vendorStatus || 'Pending'}
        </div>
      </div>
    </td>
  )
}

// ── EquipmentRow ─────────────────────────────────────────────────────────────
function EquipmentRow({ row, index }) {
  const statusColor = row.status === 'Closed' ? COLORS.approved
    : row.status === 'Unassigned' ? '#475569'
    : COLORS.inProgress

  const checklistLabel = row.checklistTotal > 0
    ? `Checklists ${row.checklistClosed}/${row.checklistTotal}`
    : null
  const testsLabel = row.testsTotal > 0
    ? `Tests ${row.testsClosed}/${row.testsTotal}`
    : null

  return (
    <tr style={{
      background: index % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.012)',
      borderBottom: `1px solid var(--divider)`,
    }}>
      {/* Equipment / System cell */}
      <td style={{ ...tdStyle(), minWidth: 240, maxWidth: 280 }}>
        <div style={{ padding: '10px 16px' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textPri, marginBottom: 2 }}>
            {row.tag || row.name || 'Unnamed'}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 10, padding: '1px 7px', borderRadius: 99,
              background: `${statusColor}20`, color: statusColor, fontWeight: 600,
            }}>
              {row.status}
            </span>
            {row.assignedTo && (
              <span style={{ fontSize: 10, color: '#64748b' }}>| {row.assignedTo}</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {checklistLabel && (
              <span style={{ fontSize: 10, color: '#94a3b8', background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: 4 }}>
                {checklistLabel}
              </span>
            )}
            {row.issuesOpen > 0 && (
              <span style={{ fontSize: 10, color: '#f87171', background: 'rgba(248,113,113,0.08)', padding: '2px 7px', borderRadius: 4 }}>
                Issues {row.issuesOpen}
              </span>
            )}
            {testsLabel && (
              <span style={{ fontSize: 10, color: '#94a3b8', background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: 4 }}>
                {testsLabel}
              </span>
            )}
          </div>
        </div>
      </td>

      {/* Checklist level cells */}
      <ChecklistCell stat={row.redTags}    color={COL_COLORS.red} />
      <ChecklistCell stat={row.yellowTags} color={COL_COLORS.yellow} />
      <ChecklistCell stat={row.greenTags}  color={COL_COLORS.green} />
      <VendorCell    stat={row.l2Vendor} />
      <VendorCell    stat={row.l3Vendor} />

      {/* Total */}
      <td style={{ ...tdStyle(), textAlign: 'center' }}>
        <span style={{
          fontSize: 13, fontWeight: 800,
          color: COLORS.textPri,
          background: 'rgba(255,255,255,0.06)',
          padding: '4px 10px', borderRadius: 6,
        }}>
          {row.total || row.checklistTotal || 0}
        </span>
      </td>
    </tr>
  )
}

// ── SystemGroupRow ────────────────────────────────────────────────────────────
function SystemGroupRow({ systemName, rows, isExpanded, onToggle }) {
  const totalUnits = rows.length
  const allClosed = rows.filter(r => r.status === 'Closed').length
  const totalChecklists = rows.reduce((s, r) => s + (r.checklistTotal || 0), 0)
  const closedChecklists = rows.reduce((s, r) => s + (r.checklistClosed || 0), 0)
  const totalIssues = rows.reduce((s, r) => s + (r.issuesOpen || 0), 0)

  return (
    <>
      {/* System group header */}
      <tr
        style={{
          background: 'rgba(255,255,255,0.04)',
          borderBottom: `1px solid var(--divider)`,
          cursor: 'pointer',
        }}
        onClick={onToggle}
      >
        <td colSpan={7} style={{ padding: '10px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 18, height: 18, borderRadius: 4,
              background: 'rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              {isExpanded
                ? <ChevronDown size={11} color="#94a3b8" />
                : <ChevronRight size={11} color="#94a3b8" />
              }
            </div>
            {/* Color dot */}
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#60a5fa', flexShrink: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.textPri }}>{systemName}</span>
            <span style={{ fontSize: 11, color: '#64748b' }}>{totalUnits} units · Closed</span>

            {/* badges */}
            <div style={{ display: 'flex', gap: 6, marginLeft: 8, flexWrap: 'wrap' }}>
              {totalChecklists > 0 && (
                <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 99, background: 'rgba(96,165,250,0.15)', color: '#60a5fa', fontWeight: 600 }}>
                  Checklists {closedChecklists}/{totalChecklists}
                </span>
              )}
              {totalIssues > 0 && (
                <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 99, background: 'rgba(248,113,113,0.12)', color: '#f87171', fontWeight: 600 }}>
                  Issues {totalIssues}
                </span>
              )}
              <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>
                0 open / {closedChecklists} closed
              </span>
            </div>
          </div>
        </td>
      </tr>

      {/* Equipment rows inside system */}
      {isExpanded && rows.map((row, i) => (
        <EquipmentRow key={row.equipmentId || i} row={row} index={i} />
      ))}
    </>
  )
}

// ── Helper styles ─────────────────────────────────────────────────────────────
function tdStyle() {
  return {
    padding: 0,
    borderRight: '1px solid var(--divider)',
    verticalAlign: 'top',
  }
}

const TH_STYLE = {
  padding: '10px 14px',
  fontSize: 10,
  fontWeight: 700,
  color: '#64748b',
  textTransform: 'uppercase',
  letterSpacing: '0.07em',
  borderRight: '1px solid var(--divider)',
  whiteSpace: 'nowrap',
  background: 'var(--bg-card)',
  position: 'sticky',
  top: 0,
  zIndex: 1,
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function EquipmentChecklistMatrix({ matrix, loading }) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('All Types')
  const [statusFilter, setStatusFilter] = useState('All Statuses')
  const [expandedSystems, setExpandedSystems] = useState({})

  // Derive filter options
  const typeOptions = useMemo(() => {
    if (!matrix?.rows) return ['All Types']
    const types = [...new Set(matrix.rows.map(r => r.equipmentType).filter(Boolean))]
    return ['All Types', ...types.sort()]
  }, [matrix])

  const statusOptions = useMemo(() => {
    if (!matrix?.rows) return ['All Statuses']
    const statuses = [...new Set(matrix.rows.map(r => r.status).filter(Boolean))]
    return ['All Statuses', ...statuses.sort()]
  }, [matrix])

  // Filter rows
  const filteredRows = useMemo(() => {
    if (!matrix?.rows) return []
    return matrix.rows.filter(row => {
      if (search) {
        const q = search.toLowerCase()
        if (!(row.name || '').toLowerCase().includes(q) &&
            !(row.tag || '').toLowerCase().includes(q) &&
            !(row.description || '').toLowerCase().includes(q)) return false
      }
      if (typeFilter !== 'All Types' && row.equipmentType !== typeFilter) return false
      if (statusFilter !== 'All Statuses' && row.status !== statusFilter) return false
      return true
    })
  }, [matrix, search, typeFilter, statusFilter])

  // Group by system
  const groupedSystems = useMemo(() => {
    const map = new Map()
    filteredRows.forEach(row => {
      const sys = row.systemName || 'General'
      if (!map.has(sys)) map.set(sys, [])
      map.get(sys).push(row)
    })
    return map
  }, [filteredRows])

  const toggleSystem = (name) => {
    setExpandedSystems(prev => ({ ...prev, [name]: !prev[name] }))
  }

  if (loading) {
    return (
      <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 32, textAlign: 'center', color: '#475569' }}>
        <div style={{ width: 28, height: 28, border: '3px solid #334155', borderTopColor: '#60a5fa', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
        Loading equipment matrix…
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  if (!matrix || !matrix.rows || matrix.rows.length === 0) {
    return (
      <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, borderRadius: 14, padding: 40, textAlign: 'center', color: '#475569' }}>
        No equipment checklist data available. Sync equipment and checklists for selected projects.
      </div>
    )
  }

  return (
    <div style={{ background: COLORS.bgCard, border: `1px solid ${COLORS.border}`, borderRadius: 14, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ padding: '18px 20px 14px', borderBottom: `1px solid var(--divider)` }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: COLORS.textPri, marginBottom: 4 }}>
              Equipment-Checklist Matrix
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Cross-reference of equipment and checklist status progression
            </div>
          </div>

          {/* Stats pills */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Pill label={`${matrix.totalUnits} units`} />
            <Pill label={`${matrix.totalSystems} systems`} />
            <Pill label={`${matrix.totalTypes} types`} />
          </div>
        </div>

        {/* Filters row */}
        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 160, maxWidth: 280 }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#64748b' }} />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search equipment..."
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)',
                borderRadius: 7, padding: '6px 10px 6px 28px', fontSize: 12,
                color: 'var(--text-primary)', outline: 'none',
              }}
            />
          </div>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            style={selectStyle()}
          >
            {typeOptions.map(t => <option key={t} value={t}>{t}</option>)}
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            style={selectStyle()}
          >
            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto', maxHeight: 640, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 880 }}>
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...TH_STYLE, textAlign: 'left' }}>Equipment / System</th>
              <th style={{ ...TH_STYLE, color: COL_COLORS.red }}>Red Tags</th>
              <th style={{ ...TH_STYLE, color: COL_COLORS.yellow }}>Yellow Tags</th>
              <th style={{ ...TH_STYLE, color: COL_COLORS.green }}>Green Tags</th>
              <th style={{ ...TH_STYLE, color: COL_COLORS.l2 }}>L2 Vendor</th>
              <th style={{ ...TH_STYLE, color: COL_COLORS.l3 }}>L3 Vendor</th>
              <th style={{ ...TH_STYLE, textAlign: 'center', borderRight: 'none' }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {[...groupedSystems.entries()].map(([sysName, sysRows]) => {
              const isExpanded = expandedSystems[sysName] !== false  // expanded by default
              return (
                <SystemGroupRow
                  key={sysName}
                  systemName={sysName}
                  rows={sysRows}
                  isExpanded={isExpanded}
                  onToggle={() => toggleSystem(sysName)}
                />
              )
            })}
          </tbody>
        </table>

        {filteredRows.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: '#475569', fontSize: 13 }}>
            No equipment matches the current filters.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Pill({ label }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600,
      padding: '4px 10px', borderRadius: 99,
      background: 'rgba(255,255,255,0.07)',
      color: '#94a3b8', border: '1px solid var(--border)',
    }}>
      {label}
    </span>
  )
}

function selectStyle() {
  return {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid var(--border)',
    borderRadius: 7,
    padding: '6px 10px',
    fontSize: 12,
    color: 'var(--text-primary)',
    cursor: 'pointer',
    outline: 'none',
  }
}
