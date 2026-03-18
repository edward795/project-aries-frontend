import React, { useState, useEffect } from 'react'
import { X, CheckCircle2, AlertCircle, Clock, ChevronDown, ChevronRight,
         ClipboardList, FlaskConical, Tag } from 'lucide-react'
import api from '../../services/api'
import { useProject } from '../../context/ProjectContext'

// ─── Design tokens (match rest of app) ────────────────────────────────────────
const C = {
  bg:      'var(--bg-main)',
  card:    'var(--bg-card)',
  cardLt:  'var(--bg-card-light)',
  border:  'var(--border)',
  divider: 'rgba(255,255,255,0.06)',
  text:    'var(--text-primary)',
  sub:     'var(--text-secondary)',
  muted:   'var(--text-muted)',
}

// ─── Mini helpers ──────────────────────────────────────────────────────────────
const Chip = ({ label, color, bg }) => (
  <span style={{
    fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
    color, background: bg || `${color}18`,
    border: `1px solid ${color}40`,
    borderRadius: 4, padding: '2px 7px', whiteSpace: 'nowrap',
  }}>{label}</span>
)

const ProgressBar = ({ pct, color = '#22c55e' }) => (
  <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', minWidth: 60, flex: 1 }}>
    <div style={{ height: '100%', width: `${Math.min(100, pct || 0)}%`, background: color, borderRadius: 2, transition: 'width 0.4s ease' }} />
  </div>
)

// ─── Summary counter card (header badges) ─────────────────────────────────────
function SummaryCard({ value, sub, color, border }) {
  return (
    <div style={{
      flex: 1, textAlign: 'center', padding: '10px 8px',
      background: `${color}10`, border: `1px solid ${border || color}30`,
      borderRadius: 10,
    }}>
      <div style={{ fontSize: 20, fontWeight: 900, color, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 3 }}>{sub}</div>
    </div>
  )
}

// ─── Tab button ───────────────────────────────────────────────────────────────
function TabBtn({ label, count, active, onClick, color = '#60a5fa' }) {
  return (
    <button onClick={onClick} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '8px 14px', fontSize: 12, fontWeight: active ? 700 : 500,
      color: active ? color : C.muted,
      borderBottom: `2px solid ${active ? color : 'transparent'}`,
      display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      transition: 'color 0.15s',
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          fontSize: 10, fontWeight: 700, minWidth: 18, height: 18,
          borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: active ? `${color}25` : 'rgba(255,255,255,0.07)',
          color: active ? color : C.muted, padding: '0 5px',
        }}>{count}</span>
      )}
    </button>
  )
}

// ─── Section accordion header ─────────────────────────────────────────────────
function SectionHeader({ icon, label, count, color, open, onToggle }) {
  return (
    <button onClick={onToggle} style={{
      width: '100%', display: 'flex', alignItems: 'center', gap: 8,
      background: 'none', border: 'none', borderBottom: `1px solid ${C.divider}`,
      padding: '10px 0', cursor: 'pointer',
    }}>
      <span style={{ color }}>{icon}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color, letterSpacing: '0.06em', flex: 1, textAlign: 'left' }}>
        {label}
      </span>
      <span style={{
        fontSize: 11, fontWeight: 700, color,
        background: `${color}20`, borderRadius: 10,
        padding: '1px 8px', marginRight: 4,
      }}>{count}</span>
      {open
        ? <ChevronDown size={13} color={C.muted} />
        : <ChevronRight size={13} color={C.muted} />}
    </button>
  )
}

// ─── Checklists Tab ────────────────────────────────────────────────────────────
function ChecklistsTab({ d }) {
  const [open, setOpen] = useState({ L1: true, L2: true, L3: true, 'L2 Vendor': false, 'L3 Vendor': false })
  const toggle = k => setOpen(o => ({ ...o, [k]: !o[k] }))

  const groups = [
    { key: 'L1',        label: 'L1 — RED TAGS',    color: '#ef4444', items: d.redTagChecklists    || [] },
    { key: 'L2',        label: 'L2 — YELLOW TAGS',  color: '#eab308', items: d.yellowTagChecklists || [] },
    { key: 'L3',        label: 'L3 — GREEN TAGS',   color: '#22c55e', items: d.greenTagChecklists  || [] },
    { key: 'L2 Vendor', label: 'L2 VENDOR',          color: '#8b5cf6', items: d.l2VendorChecklists  || [] },
    { key: 'L3 Vendor', label: 'L3 VENDOR',          color: '#ec4899', items: d.l3VendorChecklists  || [] },
  ].filter(g => g.items.length > 0)

  if (groups.length === 0) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: C.muted, fontSize: 13 }}>
      No checklists linked to this equipment.
    </div>
  )

  return (
    <div>
      {groups.map(g => (
        <div key={g.key} style={{ marginBottom: 4 }}>
          <SectionHeader
            icon={<ClipboardList size={13} />}
            label={g.label}
            count={`${g.items.filter(i => i.closed).length}/${g.items.length}`}
            color={g.color}
            open={open[g.key]}
            onToggle={() => toggle(g.key)}
          />
          {open[g.key] && (
            <div style={{ marginTop: 2 }}>
              {/* Table header */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 48px 90px 80px 70px 90px',
                gap: 6, padding: '5px 8px',
                fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase',
                borderBottom: `1px solid ${C.divider}`,
              }}>
                <span>Name</span>
                <span style={{ textAlign: 'right' }}>#</span>
                <span>Status</span>
                <span>Progress</span>
                <span style={{ textAlign: 'center' }}>Issues</span>
                <span>Type</span>
              </div>
              {g.items.map((cl, i) => (
                <div key={cl.id || i} style={{
                  display: 'grid', gridTemplateColumns: '1fr 48px 90px 80px 70px 90px',
                  gap: 6, padding: '7px 8px', alignItems: 'center',
                  borderBottom: `1px solid ${C.divider}`,
                  background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
                }}>
                  {/* Name */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: 11, fontWeight: 600, color: '#60a5fa',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }} title={cl.name}>
                      {cl.name || '—'}
                    </div>
                    {cl.assignee && (
                      <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>→ {cl.assignee}</div>
                    )}
                  </div>
                  {/* # */}
                  <div style={{ fontSize: 10, color: C.muted, textAlign: 'right' }}>{cl.number || '—'}</div>
                  {/* Status */}
                  <div>
                    <Chip label={(cl.statusLabel || 'Not Started').toUpperCase()} color={cl.statusColor || '#475569'} />
                  </div>
                  {/* Progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ProgressBar pct={cl.progressPct} color={cl.statusColor || '#22c55e'} />
                  </div>
                  {/* Issues */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700,
                      color: cl.issueCount > 0 ? '#f97316' : C.muted,
                      background: cl.issueCount > 0 ? 'rgba(249,115,22,0.1)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${cl.issueCount > 0 ? 'rgba(249,115,22,0.3)' : C.divider}`,
                      borderRadius: 4, padding: '1px 6px',
                    }}>
                      {cl.issueCount} {cl.issueCount === 1 ? 'issue' : 'issues'}
                    </span>
                  </div>
                  {/* Type */}
                  <div style={{
                    fontSize: 9, fontWeight: 700, color: g.color,
                    background: `${g.color}15`, border: `1px solid ${g.color}30`,
                    borderRadius: 4, padding: '2px 5px',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }} title={cl.levelLabel}>
                    {cl.levelLabel || cl.level || '—'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Issues Tab ────────────────────────────────────────────────────────────────
// Clean raw text: collapse \r\n sequences and trim whitespace
function cleanText(str) {
  if (!str) return null
  return str
    .replace(/\\r\\n|\\n|\\r/g, ' ')  // escaped newlines in JSON strings
    .replace(/\r\n|\r|\n/g, ' ')           // real newlines
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function IssuesTab({ issues }) {
  if (!issues || issues.length === 0) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: C.muted, fontSize: 13 }}>
      No issues linked to this equipment.
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {issues.map((iss, i) => {
        const title       = cleanText(iss.title) || 'Untitled issue'
        const description = cleanText(iss.description)
        const recommendation = cleanText(iss.recommendation)
        const statusColor  = iss.statusColor  || (iss.isClosed ? '#22c55e' : '#f97316')
        const priorityColor = iss.priorityColor || '#64748b'

        return (
          <div key={iss.id || i} style={{
            background: 'rgba(255,255,255,0.025)',
            border: `1px solid ${iss.isClosed ? C.divider : 'rgba(249,115,22,0.15)'}`,
            borderLeft: `3px solid ${statusColor}`,
            borderRadius: 8,
            padding: '10px 12px',
          }}>
            {/* Row 1: identifier + badges + due date */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {(iss.identifier || iss.id) && (
                <span style={{ fontSize: 11, fontWeight: 700, color: '#60a5fa', flexShrink: 0 }}>
                  {iss.identifier || iss.id}
                </span>
              )}
              <Chip
                label={(iss.statusLabel || 'Open').toUpperCase()}
                color={statusColor}
                bg={`${statusColor}20`}
              />
              <Chip
                label={(iss.priority || 'P4 - Low').toUpperCase()}
                color={priorityColor}
                bg={`${priorityColor}15`}
              />
              {iss.dueDate && (
                <span style={{ fontSize: 10, color: C.muted, marginLeft: 'auto', flexShrink: 0 }}>
                  Due: {iss.dueDate}
                </span>
              )}
            </div>

            {/* Row 2: equipment tag (subtle) */}
            {iss.equipmentTag && (
              <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>
                Equipment Tag: <span style={{ color: C.sub }}>{iss.equipmentTag}</span>
              </div>
            )}

            {/* Row 3: title */}
            <div style={{
              fontSize: 12, fontWeight: 600,
              color: iss.isClosed ? C.muted : C.text,
              lineHeight: 1.45, marginBottom: description || recommendation ? 5 : 0,
            }}>
              {title}
            </div>

            {/* Row 4: description (collapsed if long) */}
            {description && description !== title && (
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.55 }}>
                {description}
              </div>
            )}

            {/* Row 5: recommendation */}
            {recommendation && (
              <div style={{
                fontSize: 10, color: '#94a3b8', marginTop: 5,
                fontStyle: 'italic', lineHeight: 1.4,
                paddingTop: 5, borderTop: `1px solid ${C.divider}`,
              }}>
                <span style={{ fontWeight: 600, fontStyle: 'normal' }}>Recommendation: </span>
                {recommendation}
              </div>
            )}

            {/* Row 6: assignee */}
            {iss.assignee && (
              <div style={{ fontSize: 10, color: C.muted, marginTop: 5 }}>
                → {iss.assignee}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Tests Tab ─────────────────────────────────────────────────────────────────
function TestsTab({ tests }) {
  if (!tests || tests.length === 0) return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: C.muted, fontSize: 13 }}>
      No tests linked to this equipment.
    </div>
  )

  return (
    <div>
      {/* Table header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 100px 80px 90px 80px',
        gap: 8, padding: '5px 8px',
        fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase',
        borderBottom: `1px solid ${C.divider}`,
      }}>
        <span>Name</span>
        <span>Status</span>
        <span>Discipline</span>
        <span>Assignee</span>
        <span>Attempts</span>
      </div>
      {tests.map((t, i) => (
        <div key={t.id || i} style={{
          display: 'grid', gridTemplateColumns: '1fr 100px 80px 90px 80px',
          gap: 8, padding: '8px', alignItems: 'center',
          borderBottom: `1px solid ${C.divider}`,
          background: i % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent',
        }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: t.closed ? C.muted : C.text }}>
              {t.name || '—'}
            </div>
            {t.testType && <div style={{ fontSize: 9, color: C.muted, marginTop: 1 }}>{t.testType}</div>}
            {t.note && <div style={{ fontSize: 9, color: C.muted, fontStyle: 'italic', marginTop: 1 }}>{t.note}</div>}
          </div>
          <div>
            <Chip label={(t.statusLabel || 'Not Started').toUpperCase()} color={t.statusColor || '#475569'} />
          </div>
          <div style={{ fontSize: 10, color: C.muted }}>{t.discipline || '—'}</div>
          <div style={{ fontSize: 10, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {t.assignee || '—'}
          </div>
          <div style={{ fontSize: 10, color: C.muted, textAlign: 'center' }}>
            {t.attemptCount > 0 ? t.attemptCount : '—'}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main Panel ────────────────────────────────────────────────────────────────
export default function EquipmentDetailPanel({ externalId, equipmentType, onClose }) {
  const { activeProject }     = useProject()
  const [detail, setDetail]   = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [tab, setTab]         = useState('checklists')

  useEffect(() => {
    if (!externalId) return
    setLoading(true)
    setError(null)
    setTab('checklists')
    const pid = activeProject?.externalId
    const url = `/equipment/details/${encodeURIComponent(externalId)}${pid ? `?projectId=${pid}` : ''}`
    api.get(url)
      .then(res => {
        if (res.data?.data) setDetail(res.data.data)
        else setError('No data returned from server')
      })
      .catch(() => setError('Failed to load equipment detail'))
      .finally(() => setLoading(false))
  }, [externalId, activeProject?.externalId])

  const d = detail

  // Status dot color
  const statusDotColor = d?.status?.includes('service') ? '#22c55e'
    : d?.status?.includes('progress') ? '#3b82f6'
    : d?.status?.includes('complete') ? '#4ade80'
    : '#94a3b8'

  // Checklist total / closed
  const clTotal  = d ? (d.totalChecklists  || 0) : 0
  const clClosed = d ? (d.closedChecklists || 0) : 0
  const clColor  = clTotal > 0 && clClosed === clTotal ? '#22c55e' : '#22c55e'

  return (
    <>
      {/* Backdrop — clicking outside closes */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 999,
          background: 'rgba(0,0,0,0.35)',
        }}
      />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 580, overflowX: 'hidden',
        background: 'var(--bg-card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: '-12px 0 50px rgba(0,0,0,0.5)',
        zIndex: 1000, display: 'flex', flexDirection: 'column',
        animation: 'slideInPanel 0.2s cubic-bezier(0.16,1,0.3,1)',
      }}>
        <style>{`
          @keyframes slideInPanel { from { transform: translateX(100%) } to { transform: translateX(0) } }
        `}</style>

        {/* ── Top header ── */}
        <div style={{
          padding: '14px 20px 0',
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 16, fontWeight: 900, color: C.text, letterSpacing: '-0.02em' }}>
                {loading ? '…' : (d?.tag || d?.externalId || externalId)}
              </div>
              {d?.name && d.name !== d?.tag && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{d.name}</div>
              )}
            </div>
            <button onClick={onClose} style={{
              background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`,
              cursor: 'pointer', padding: 5, borderRadius: 7, color: C.muted,
              display: 'flex', alignItems: 'center',
            }}>
              <X size={15} />
            </button>
          </div>

          {/* Type + Status badges */}
          {d && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {(d.equipmentType || equipmentType) && (
                <Chip label={d.equipmentType || equipmentType} color="#0ea5e9" />
              )}
              {d.statusLabel && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: C.muted }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDotColor }} />
                  {d.statusLabel}
                </span>
              )}
              {d.discipline && (
                <Chip label={d.discipline} color="#64748b" />
              )}
            </div>
          )}

          {/* Summary counter cards */}
          {d && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <SummaryCard
                value={`${clClosed}/${clTotal}`}
                sub="Checklists"
                color={clClosed === clTotal && clTotal > 0 ? '#22c55e' : '#22c55e'}
              />
              <SummaryCard
                value={d.openIssues || 0}
                sub="Open Issues"
                color={d.openIssues > 0 ? '#f97316' : '#22c55e'}
              />
              <SummaryCard
                value={d.totalTests || 0}
                sub="Tests"
                color="#a855f7"
              />
            </div>
          )}

          {/* Tabs */}
          {d && (
            <div style={{ display: 'flex', gap: 0, borderBottom: 'none', marginBottom: -1 }}>
              <TabBtn
                label="Checklists"
                count={d.totalChecklists}
                active={tab === 'checklists'}
                onClick={() => setTab('checklists')}
                color="#22c55e"
              />
              <TabBtn
                label="Issues"
                count={d.totalIssues}
                active={tab === 'issues'}
                onClick={() => setTab('issues')}
                color="#f97316"
              />
              <TabBtn
                label="Tests"
                count={d.totalTests}
                active={tab === 'tests'}
                onClick={() => setTab('tests')}
                color="#a855f7"
              />
            </div>
          )}
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '14px 14px' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '48px 0', color: C.muted }}>
              <div style={{
                width: 28, height: 28, margin: '0 auto 14px',
                border: '3px solid rgba(255,255,255,0.08)',
                borderTopColor: '#60a5fa',
                borderRadius: '50%', animation: 'spin 0.7s linear infinite',
              }} />
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
              <div style={{ fontSize: 13 }}>Loading equipment data…</div>
            </div>
          )}
          {error && !loading && (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 10, padding: 16, color: '#f87171', fontSize: 13,
            }}>{error}</div>
          )}
          {d && !loading && (
            <>
              {tab === 'checklists' && <ChecklistsTab d={d} />}
              {tab === 'issues'     && <IssuesTab issues={d.issues} />}
              {tab === 'tests'      && <TestsTab  tests={d.tests} />}
            </>
          )}
        </div>
      </div>
    </>
  )
}
