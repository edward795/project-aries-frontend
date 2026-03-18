/**
 * reportGenerator.js
 *
 * Generates a PDF commissioning report that directly downloads as a .pdf file.
 * Uses jsPDF (loaded dynamically from CDN) — no new tab, no redirect.
 *
 * Period is read from the global toggle (Overall / D / W / M).
 * Same template for all periods — only the title, ref code, and data window change.
 *
 * Sections (matching the attached PDF template):
 *  1. Cover page — PROJECT STATUS UPDATE banner, Report Details card, KPI row, summary stats
 *  2. Checklists Worked On — grouped by system, numbered table
 *  3. Issues Log — grouped by priority, numbered table
 */

// ─── jsPDF dynamic loader ──────────────────────────────────────────────────────
let _jsPDF = null
async function loadJsPDF() {
  if (_jsPDF) return _jsPDF
  await new Promise((resolve, reject) => {
    if (window.jspdf) { _jsPDF = window.jspdf.jsPDF; resolve(); return }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
    s.onload = () => { _jsPDF = window.jspdf.jsPDF; resolve() }
    s.onerror = reject
    document.head.appendChild(s)
  })
  return _jsPDF
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) }
  catch { return '—' }
}

function isoWeekLabel(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yr = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const wk = Math.ceil((((d - yr) / 86400000) + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`
}

function reportTypeLabel(period) {
  if (period === 'D') return 'Daily Commissioning Report'
  if (period === 'W') return 'Weekly Commissioning Report'
  if (period === 'M') return 'Monthly Commissioning Report'
  return 'Overall Project Status Report'
}

function refCode(project, period) {
  const proj = (project?.name || 'PRJ').replace(/\s+/g, '').toUpperCase().slice(0, 6)
  const per  = period === 'D' ? 'DCR' : period === 'W' ? 'WKR' : period === 'M' ? 'MOR' : 'OSR'
  return `${proj}-${per}-${per}-1`
}

const DONE = new Set(['finished','complete','completed','done','closed','signed_off','approved',
  'checklist_approved','issue_closed','accepted_by_owner'])
const isDone  = s => DONE.has((s||'').toLowerCase().replace(/[ -]/g,'_'))
const isNewIssue = s => ['open','issue_opened','active','new'].includes((s||'').toLowerCase())

function clStatusLabel(s) {
  const n = (s||'').toLowerCase().replace(/[ -]/g,'_')
  if (DONE.has(n)) return 'Checklist Approved'
  if (n.includes('comment') || n.includes('returned')) return 'Returned with Comments'
  if (n.includes('progress')) return 'In Progress'
  return s || 'Open'
}

function systemOf(c) {
  const name = c.name || ''
  // Match system codes: E-4A, M-DH4, E-4B etc from checklist name
  const m = name.match(/[A-Z]{4,}-[A-Z]{3,}-[A-Z]{2,3}-([A-Z0-9]+)-/)
  if (m) return m[1]
  const ct = c.checklistType || c.checklist_type || ''
  if (ct) return ct.split(/[\s-]/)[0] || 'General'
  return c.discipline || 'General'
}

function filterByPeriod(items, period, dateField) {
  const now = new Date()
  if (period === 'D') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    return items.filter(x => new Date(x[dateField] || x.updatedAt || x.createdAt || 0) >= start)
  }
  if (period === 'W') {
    const start = new Date(now.getTime() - 7 * 86400000)
    return items.filter(x => new Date(x[dateField] || x.updatedAt || x.createdAt || 0) >= start)
  }
  if (period === 'M') {
    const start = new Date(now.getTime() - 30 * 86400000)
    return items.filter(x => new Date(x[dateField] || x.updatedAt || x.createdAt || 0) >= start)
  }
  return items // Overall
}

// ─── PDF drawing constants ──────────────────────────────────────────────────────
const PAGE_W  = 210   // A4 mm
const PAGE_H  = 297
const MARGIN  = 14
const COL_W   = PAGE_W - MARGIN * 2   // 182mm usable width

// Colors
const NAVY   = [10, 22, 40]
const BLUE   = [30, 64, 175]
const GREEN  = [22, 163, 74]
const RED    = [220, 38, 38]
const GRAY1  = [15, 23, 42]
const GRAY5  = [100, 116, 139]
const GRAY8  = [241, 245, 249]
const WHITE  = [255, 255, 255]
const YELLOW = [234, 179, 8]

// ─── Drawing helpers ────────────────────────────────────────────────────────────
function hex2rgb(hex) {
  const n = parseInt(hex.replace('#',''), 16)
  return [(n>>16)&255, (n>>8)&255, n&255]
}

class PDFWriter {
  constructor(doc) {
    this.doc = doc
    this.y   = MARGIN
    this.page = 1
  }

  // Current page number
  get pageNum() { return this.doc.internal.getCurrentPageInfo().pageNumber }

  newPage() {
    this.doc.addPage()
    this.y = MARGIN + 4
    this._drawPageFooter()
  }

  checkSpace(needed) {
    if (this.y + needed > PAGE_H - 20) this.newPage()
  }

  _drawPageFooter() {
    const d = this.doc
    d.setDrawColor(...GRAY8)
    d.setLineWidth(0.3)
    d.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12)
    d.setFontSize(7.5)
    d.setTextColor(...GRAY5)
    d.text(`Page ${this.pageNum}`, MARGIN, PAGE_H - 7)
    d.text(this._projName || '', PAGE_W / 2, PAGE_H - 7, { align: 'center' })
    d.text(this._refCode || '', PAGE_W - MARGIN, PAGE_H - 7, { align: 'right' })
  }

  // ── Cover page ───────────────────────────────────────────────────────────
  drawCover(project, period, clTotal, clApproved, clReturned, issTotal, issNew, issClosed) {
    const d    = this.doc
    const now  = new Date()
    const type = reportTypeLabel(period)
    const ref  = refCode(project, period)
    const name = project?.name || 'Project'
    this._projName = name
    this._refCode  = ref

    // Hero banner background
    d.setFillColor(...NAVY)
    d.rect(0, 0, PAGE_W, 72, 'F')

    // Accent diagonal shape (visual interest matching template)
    d.setFillColor(30, 58, 138)
    d.triangle(PAGE_W - 60, 0, PAGE_W, 0, PAGE_W, 72, 'F')

    // PROJECT STATUS UPDATE eyebrow
    d.setFontSize(8)
    d.setFont('helvetica', 'bold')
    d.setTextColor(180, 200, 230)
    d.setCharSpace(1.5)
    d.text('PROJECT STATUS UPDATE', MARGIN, 18)
    d.setCharSpace(0)

    // Main title
    d.setFontSize(22)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...WHITE)
    d.text(type, MARGIN, 36)

    // Project subtitle
    d.setFontSize(11)
    d.setFont('helvetica', 'normal')
    d.setTextColor(180, 200, 230)
    d.text(name, MARGIN, 50)

    // Period label top-right
    d.setFontSize(8.5)
    d.setTextColor(...WHITE)
    d.setFont('helvetica', 'bold')
    const periodText = period === 'D' ? now.toLocaleDateString('en-US', {month:'long',day:'numeric',year:'numeric'})
      : period === 'W' ? isoWeekLabel(now)
      : period === 'M' ? now.toLocaleDateString('en-US', {month:'long',year:'numeric'})
      : 'All Time'
    d.text(periodText, PAGE_W - MARGIN, 50, { align: 'right' })

    this.y = 80

    // ── Report Details card ──────────────────────────────────────────────
    const cardX = MARGIN, cardY = this.y, cardW = COL_W, cardH = 52
    d.setFillColor(255, 255, 255)
    d.setDrawColor(220, 228, 240)
    d.setLineWidth(0.4)
    d.roundedRect(cardX, cardY, cardW, cardH, 3, 3, 'FD')

    // Card header row
    d.setFillColor(...GRAY8)
    d.roundedRect(cardX, cardY, cardW, 9, 3, 3, 'F')
    d.rect(cardX, cardY + 4, cardW, 5, 'F') // bottom half square corners

    d.setFontSize(7.5)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...GRAY5)
    d.setCharSpace(0.8)
    d.text('REPORT DETAILS', cardX + 6, cardY + 6.5)
    d.setCharSpace(0)

    // Ref badge top-right of card
    d.setFillColor(...BLUE)
    d.roundedRect(cardX + cardW - 44, cardY + 1.5, 42, 6, 1.5, 1.5, 'F')
    d.setFontSize(6.5)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...WHITE)
    d.text(ref, cardX + cardW - 23, cardY + 5.8, { align: 'center' })

    // Detail fields — 2 columns × 3 rows
    const fields = [
      ['PROJECT',          name],
      ['REPORT TYPE',      type],
      ['PERIOD',           periodText],
      ['REPORT DATE',      now.toISOString().slice(0, 10)],
      ['GENERATED BY',     'Modem IQ'],
      ['PROJECT ID',       String(project?.externalId || project?.id || '—')],
    ]
    const col1X = cardX + 6, col2X = cardX + cardW / 2 + 4
    fields.forEach(([lbl, val], i) => {
      const col = i % 2 === 0 ? col1X : col2X
      const row = Math.floor(i / 2)
      const fy  = cardY + 14 + row * 13

      d.setFontSize(6.5)
      d.setFont('helvetica', 'bold')
      d.setTextColor(...GRAY5)
      d.setCharSpace(0.5)
      d.text(lbl, col, fy)
      d.setCharSpace(0)

      d.setFontSize(9)
      d.setFont('helvetica', 'bold')
      d.setTextColor(...GRAY1)
      // Truncate long values
      const maxW = cardW / 2 - 10
      const truncated = d.splitTextToSize(val, maxW)[0]
      d.text(truncated, col, fy + 5)
    })

    this.y = cardY + cardH + 8

    // ── KPI row (Personnel / Meetings / Activities / Upcoming) ───────────
    const kpiW = COL_W / 4
    const kpiColors = [BLUE, [234,179,8], BLUE, BLUE]
    const kpiLabels = ['Personnel', 'Meetings', 'Activities', 'Upcoming']
    const kpiVals   = ['0', '0', String(clTotal), '0']

    kpiLabels.forEach((lbl, i) => {
      const kx = MARGIN + i * kpiW
      // Left accent bar
      d.setFillColor(...kpiColors[i])
      d.rect(kx, this.y, 3, 20, 'F')
      // Number
      d.setFontSize(18)
      d.setFont('helvetica', 'bold')
      d.setTextColor(...kpiColors[i])
      d.text(kpiVals[i], kx + 8, this.y + 13)
      // Label
      d.setFontSize(7)
      d.setFont('helvetica', 'normal')
      d.setTextColor(...GRAY5)
      d.text(lbl.toUpperCase(), kx + 8, this.y + 18.5)
      // Right border except last
      if (i < 3) {
        d.setDrawColor(220, 228, 240)
        d.setLineWidth(0.3)
        d.line(kx + kpiW, this.y + 2, kx + kpiW, this.y + 18)
      }
    })

    this.y += 28

    // ── Summary stats (Checklists + Issues) ──────────────────────────────
    const halfW = (COL_W - 6) / 2

    // Checklists card
    d.setFillColor(...WHITE)
    d.setDrawColor(200, 240, 210)
    d.setLineWidth(0.5)
    d.roundedRect(MARGIN, this.y, halfW, 28, 3, 3, 'FD')
    d.setFillColor(...GREEN)
    d.rect(MARGIN, this.y, 4, 28, 'F')
    d.roundedRect(MARGIN, this.y, 4, 28, 1.5, 1.5, 'F')

    d.setFontSize(22)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...GREEN)
    d.text(String(clTotal), MARGIN + 8, this.y + 14)
    d.setFontSize(7.5)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...GRAY5)
    d.setCharSpace(0.6)
    d.text('CHECKLISTS', MARGIN + 8, this.y + 20)
    d.setCharSpace(0)
    d.setFontSize(8)
    d.setFont('helvetica', 'normal')
    d.setTextColor(...GRAY5)
    d.text(`Checklist Approved: ${clApproved}  •  Returned with Comments: ${clReturned}`, MARGIN + 8, this.y + 26)

    // Issues card
    const issX = MARGIN + halfW + 6
    d.setFillColor(...WHITE)
    d.setDrawColor(255, 200, 200)
    d.roundedRect(issX, this.y, halfW, 28, 3, 3, 'FD')
    d.setFillColor(...RED)
    d.rect(issX, this.y, 4, 28, 'F')
    d.roundedRect(issX, this.y, 4, 28, 1.5, 1.5, 'F')

    d.setFontSize(22)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...RED)
    d.text(String(issTotal), issX + 8, this.y + 14)
    d.setFontSize(7.5)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...GRAY5)
    d.setCharSpace(0.6)
    d.text('ISSUES', issX + 8, this.y + 20)
    d.setCharSpace(0)
    d.setFontSize(8)
    d.setFont('helvetica', 'normal')
    d.setTextColor(...GRAY5)
    d.text(`New: ${issNew}  •  Closed: ${issClosed}`, issX + 8, this.y + 26)

    this.y += 36
    this._drawPageFooter()
  }

  // ── Section heading ───────────────────────────────────────────────────────
  drawSectionHeading(title, count) {
    this.checkSpace(14)
    const d = this.doc
    d.setDrawColor(...GRAY1)
    d.setLineWidth(0.6)
    d.line(MARGIN, this.y + 6, PAGE_W - MARGIN, this.y + 6)
    d.setFontSize(13)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...GRAY1)
    d.text(title, MARGIN, this.y + 4)

    // Count badge
    d.setFillColor(239, 246, 255)
    d.setDrawColor(...BLUE)
    d.setLineWidth(0.3)
    d.roundedRect(PAGE_W - MARGIN - 20, this.y - 2, 20, 8, 2, 2, 'FD')
    d.setFontSize(8)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...BLUE)
    d.text(String(count), PAGE_W - MARGIN - 10, this.y + 3.5, { align: 'center' })

    this.y += 10
  }

  // ── System group header ───────────────────────────────────────────────────
  drawSystemHeader(sysName, count, statSummary) {
    this.checkSpace(12)
    const d = this.doc
    d.setFillColor(241, 245, 249)
    d.rect(MARGIN, this.y, COL_W, 9, 'F')
    d.setFillColor(...BLUE)
    d.rect(MARGIN, this.y, 3, 9, 'F')

    d.setFontSize(8.5)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...GRAY1)
    d.text(`System: ${sysName}`, MARGIN + 6, this.y + 5.8)

    d.setFontSize(7.5)
    d.setFont('helvetica', 'normal')
    d.setTextColor(...GRAY5)
    d.text(`${count} checklists  •  ${statSummary}`, MARGIN + 6 + d.getTextWidth(`System: ${sysName}`) + 4, this.y + 5.8)

    this.y += 11
  }

  // ── Table header row ──────────────────────────────────────────────────────
  drawTableHeader(cols) {
    this.checkSpace(8)
    const d = this.doc
    d.setFillColor(248, 250, 252)
    d.rect(MARGIN, this.y, COL_W, 7, 'F')
    d.setDrawColor(203, 213, 225)
    d.setLineWidth(0.3)
    d.line(MARGIN, this.y + 7, MARGIN + COL_W, this.y + 7)

    d.setFontSize(7)
    d.setFont('helvetica', 'bold')
    d.setTextColor(...GRAY5)
    d.setCharSpace(0.4)

    let cx = MARGIN + 2
    cols.forEach(({ label, w }) => {
      d.text(label.toUpperCase(), cx, this.y + 4.8)
      cx += w
    })
    d.setCharSpace(0)
    this.y += 8
  }

  // ── Table data row ────────────────────────────────────────────────────────
  drawTableRow(cells, cols, isEven) {
    const d        = this.doc
    const rowH     = this._estimateRowHeight(cells, cols)
    this.checkSpace(rowH)

    if (isEven) {
      d.setFillColor(250, 251, 253)
      d.rect(MARGIN, this.y, COL_W, rowH, 'F')
    }

    let cx = MARGIN + 2
    cells.forEach((cell, i) => {
      const { w, color, bold, badge } = cols[i]
      d.setFontSize(8)
      d.setFont('helvetica', bold ? 'bold' : 'normal')

      if (badge) {
        // Draw status badge
        const badgeColors = {
          'Checklist Approved':       { fill: [220, 252, 231], border: [134, 239, 172], text: GREEN },
          'Returned with Comments':   { fill: [254, 249, 195], border: [253, 224, 71],  text: [133, 77, 14] },
          'In Progress':              { fill: [219, 234, 254], border: [147, 197, 253],  text: BLUE },
          'Closed':                   { fill: [220, 252, 231], border: [134, 239, 172], text: GREEN },
          'New':                      { fill: [254, 226, 226], border: [252, 165, 165],  text: RED },
        }
        const bc = badgeColors[cell] || { fill: GRAY8, border: [203,213,225], text: GRAY5 }
        const tw = d.getTextWidth(cell) + 6
        d.setFillColor(...bc.fill)
        d.setDrawColor(...bc.border)
        d.setLineWidth(0.3)
        d.roundedRect(cx, this.y + 1, Math.min(tw, w - 2), 5.5, 1.5, 1.5, 'FD')
        d.setFontSize(7)
        d.setFont('helvetica', 'bold')
        d.setTextColor(...bc.text)
        d.text(cell, cx + 3, this.y + 5.2)
      } else {
        d.setTextColor(...(color || GRAY1))
        const lines = d.splitTextToSize(cell, w - 3)
        lines.slice(0, 3).forEach((line, li) => {
          d.text(line, cx, this.y + 5.5 + li * 4)
        })
      }
      cx += w
    })

    // Bottom border
    d.setDrawColor(241, 245, 249)
    d.setLineWidth(0.25)
    d.line(MARGIN, this.y + rowH, MARGIN + COL_W, this.y + rowH)

    this.y += rowH
  }

  _estimateRowHeight(cells, cols) {
    const d = this.doc
    let maxLines = 1
    cells.forEach((cell, i) => {
      if (!cols[i].badge) {
        const lines = d.splitTextToSize(cell, cols[i].w - 3)
        maxLines = Math.max(maxLines, Math.min(lines.length, 3))
      }
    })
    return maxLines > 1 ? 5 + maxLines * 4 : 8
  }
}

// ─── Main export function ───────────────────────────────────────────────────────
export async function generateAndDownloadReport(project, checklists, issues, period) {
  const JsPDF = await loadJsPDF()
  const doc   = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const w     = new PDFWriter(doc)
  const now   = new Date()

  // Filter data to the period window
  const periodCLs    = filterByPeriod(checklists, period, 'updatedAt')
  const periodIssues = filterByPeriod(issues,     period, 'createdAt')

  // Checklist stats
  const clApproved = periodCLs.filter(c => isDone(c.status)).length
  const clReturned = periodCLs.filter(c => clStatusLabel(c.status) === 'Returned with Comments').length
  const clTotal    = periodCLs.length

  // Issue stats
  const issNew    = periodIssues.filter(i => isNewIssue(i.status)).length
  const issClosed = periodIssues.filter(i => isDone(i.status)).length
  const issTotal  = periodIssues.length

  // ── Cover page ─────────────────────────────────────────────────────────────
  w.drawCover(project, period, clTotal, clApproved, clReturned, issTotal, issNew, issClosed)

  // ── Checklists section ─────────────────────────────────────────────────────
  if (periodCLs.length > 0) {
    w.newPage()
    w.drawSectionHeading('Checklists Worked On', clTotal)

    // Group by system
    const sysMap = new Map()
    periodCLs.forEach(c => {
      const sys = systemOf(c)
      if (!sysMap.has(sys)) sysMap.set(sys, [])
      sysMap.get(sys).push(c)
    })

    const clCols = [
      { label: '#',            w: 8,   color: GRAY5, bold: false },
      { label: 'Checklist Name', w: 72, color: GRAY1, bold: true  },
      { label: 'Discipline',   w: 24,  color: GRAY5, bold: false },
      { label: 'Status',       w: 40,  badge: true },
      { label: 'Date',         w: 22,  color: GRAY5, bold: false },
      { label: 'Changed By',   w: 20,  color: GRAY5, bold: false },
    ]

    let globalIdx = 1
    ;[...sysMap.entries()].forEach(([sysName, rows]) => {
      const approved = rows.filter(c => isDone(c.status)).length
      const returned = rows.filter(c => clStatusLabel(c.status) === 'Returned with Comments').length
      const statParts = []
      if (approved) statParts.push(`Checklist Approved: ${approved}`)
      if (returned) statParts.push(`Returned with Comments: ${returned}`)
      const rest = rows.length - approved - returned
      if (rest > 0) statParts.push(`In Progress: ${rest}`)

      w.drawSystemHeader(sysName, rows.length, statParts.join(', '))
      w.drawTableHeader(clCols)

      rows.forEach((c, ri) => {
        const discipline = c.discipline || (c.tagLevel
          ? c.tagLevel.charAt(0).toUpperCase() + c.tagLevel.slice(1)
          : 'Electrical')
        const changedBy  = (c.assignedTo || c.assigned_to || '—').slice(0, 18)
        w.drawTableRow([
          String(globalIdx++),
          c.name || c.externalId || '—',
          discipline,
          clStatusLabel(c.status),
          fmtDate(c.updatedAt || c.updated_at || c.createdAt || c.created_at),
          changedBy,
        ], clCols, ri % 2 === 1)
      })

      w.y += 4 // gap between systems
    })
  }

  // ── Issues section ─────────────────────────────────────────────────────────
  if (periodIssues.length > 0) {
    w.newPage()
    w.drawSectionHeading('Issues Log', issTotal)

    // Group by priority
    const priMap = new Map()
    const priOrder = ['P1 - Critical','P2 - High','P3 - Medium','P4 - Low']
    periodIssues.forEach(i => {
      const p = i.priority || 'P4 - Low'
      if (!priMap.has(p)) priMap.set(p, [])
      priMap.get(p).push(i)
    })

    const isCols = [
      { label: '#',        w: 8,   color: GRAY5, bold: false },
      { label: 'Issue Title', w: 70, color: GRAY1, bold: true  },
      { label: 'Location', w: 26,  color: GRAY5, bold: false },
      { label: 'Status',   w: 28,  badge: true },
      { label: 'Created',  w: 24,  color: GRAY5, bold: false },
      { label: 'Assignee', w: 26,  color: GRAY5, bold: false },
    ]

    let issIdx = 1
    priOrder.forEach(pri => {
      const rows = priMap.get(pri)
      if (!rows?.length) return

      w.drawSystemHeader(pri, rows.length, `${rows.filter(i => isDone(i.status)).length} closed`)
      w.drawTableHeader(isCols)

      rows.forEach((iss, ri) => {
        const statusLabel = isDone(iss.status) ? 'Closed' : isNewIssue(iss.status) ? 'New' : (iss.status || 'Open')
        const location    = (iss.location || iss.spaceId || '—').slice(0, 20)
        const assignee    = (iss.assignee || iss.reporter || '—').slice(0, 18)
        w.drawTableRow([
          String(issIdx++),
          iss.title || iss.name || '—',
          location,
          statusLabel,
          fmtDate(iss.createdAt || iss.created_at),
          assignee,
        ], isCols, ri % 2 === 1)
      })

      w.y += 4
    })
  }

  // Empty state page
  if (clTotal === 0 && issTotal === 0) {
    w.newPage()
    doc.setFontSize(11)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(...GRAY5)
    doc.text('No data available for this period.', PAGE_W / 2, PAGE_H / 2, { align: 'center' })
    doc.text('Sync checklists and issues for the selected project.', PAGE_W / 2, PAGE_H / 2 + 8, { align: 'center' })
  }

  // ── Download ───────────────────────────────────────────────────────────────
  const projSlug = (project?.name || 'report').replace(/\s+/g, '-').toLowerCase()
  const dateStr  = now.toISOString().slice(0, 10)
  const perLabel = period === 'D' ? 'daily' : period === 'W' ? 'weekly' : period === 'M' ? 'monthly' : 'overall'
  doc.save(`${projSlug}-${perLabel}-report-${dateStr}.pdf`)
}
