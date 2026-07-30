// Filling MIRA's SCHEDULE 2 — Statement of Financial Position — from the shop's
// own records, so the tax form arrives mostly done instead of blank.
//
// The blank form (public/forms/mira-schedule-2.pdf) is a fillable Adobe form.
// We drop its XFA layer (pdf-lib does this for us), write the box values into the
// plain AcroForm fields, and ask viewers to redraw — so the numbers show in every
// PDF reader while the form stays editable. It is deliberately NOT flattened: this
// is a tax return, and the owner must be able to review, add the TIN, and fill the
// boxes we can't know (fixed assets, withholding tax) before filing.

import { PDFDocument, PDFName, PDFBool } from 'pdf-lib'
import { computeSummary, num } from './business'
import { getSettings, saveSettings } from './settings'
import { localToday } from './dates'

const FORM_URL = '/forms/mira-schedule-2.pdf'
// The TIN lives in Settings → Financial so it can be set in one place. An older
// build kept it under its own key; read that as a fallback so nothing is lost.
const LEGACY_TIN_KEY = 'bnj_mira_tin'
export const getMiraTin = () => {
  try { return (getSettings().tin || localStorage.getItem(LEGACY_TIN_KEY) || '').trim() } catch { return '' }
}
export const setMiraTin = v => { try { saveSettings({ ...getSettings(), tin: (v || '').trim() }) } catch {} }

const r2 = n => Math.round(num(n) * 100) / 100
// Plain two-decimal string, no thousands separators — matches the form's own
// numeric fields (their default value is "0.00").
const money2 = n => r2(n).toFixed(2)
// 'YYYY-MM-DD' → 'DDMMYYYY' for the D D M M Y Y Y Y date boxes
const ddmmyyyy = iso => {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}${m[2]}${m[1]}` : ''
}

// Work out every box from the raw business data. Boxes the system can't know
// (property, intangibles, withholding tax…) are left blank for the owner.
export function computeFinancialPosition(data) {
  const s = computeSummary(data)
  const { orders, purchases, loans, loanPays } = data

  // Assets
  const inventories = s.inventory.closing                                   // B6
  const receivables = orders
    .filter(o => o.status !== 'cancelled' && (o.payment_status === 'unpaid' || o.payment_status === 'partial'))
    .reduce((t, o) => t + num(o.total_price), 0)                            // B7
  const cash = s.closingBank                                                // B8
  const totalAssets = inventories + receivables + cash                     // B10

  // Liabilities
  const payables = purchases
    .filter(po => po.status !== 'received')
    .reduce((t, po) => t + num(po.total_cost || num(po.unit_cost) * (parseInt(po.qty) || 0)), 0)   // B12
  const loansOutstanding = loans.reduce((t, l) => {
    const payable = num(l.total_payable) || num(l.amount)
    const paid = loanPays.filter(p => p.loan_id === l.id).reduce((a, p) => a + num(p.amount), 0)
    return t + Math.max(0, payable - paid)
  }, 0)                                                                     // B14
  const totalLiabilities = payables + loansOutstanding                     // B16

  // Equity — with no share capital tracked, owner's equity is simply what the
  // business is worth net of what it owes. Making retained earnings the balancing
  // figure keeps Assets = Liabilities + Equity, as a balance sheet must.
  const retainedEarnings = totalAssets - totalLiabilities                  // B18
  const totalEqAndLiab = totalLiabilities + retainedEarnings               // B20 (= totalAssets)

  return { inventories, receivables, cash, totalAssets, payables, loansOutstanding, totalLiabilities, retainedEarnings, totalEqAndLiab }
}

// Fill the form and hand back the bytes. `period` is { from, to } in ISO.
export async function buildMiraSchedule2(data, { from, to, tin } = {}) {
  const f = computeFinancialPosition(data)
  const bytes = await fetch(FORM_URL).then(r => {
    if (!r.ok) throw new Error('Could not load the blank form')
    return r.arrayBuffer()
  })
  const pdf = await PDFDocument.load(bytes)
  const form = pdf.getForm()
  const P1 = 'topmostSubform[0].Page1[0].'
  const set = (name, value) => { try { form.getTextField(P1 + name).setText(String(value)) } catch { /* field absent — skip */ } }

  if (tin) set('NumericField1[0]', tin)
  if (from) set('AccPeriodFrom[0]', ddmmyyyy(from))
  if (to) set('AccPeriodTo[0]', ddmmyyyy(to))

  set('B6[0]', money2(f.inventories))
  set('B7[0]', money2(f.receivables))
  set('B8[0]', money2(f.cash))
  set('B10[0]', money2(f.totalAssets))
  set('B12[0]', money2(f.payables))
  set('B14[0]', money2(f.loansOutstanding))
  set('B16[0]', money2(f.totalLiabilities))
  set('B18[0]', money2(f.retainedEarnings))
  set('B20[0]', money2(f.totalEqAndLiab))

  // Let every viewer rebuild the field appearances from the values we set.
  form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True)
  return pdf.save()
}

// Fill and download in one go.
export async function downloadMiraSchedule2(data, opts = {}) {
  const out = await buildMiraSchedule2(data, opts)
  const blob = new Blob([out], { type: 'application/pdf' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `mira-schedule-2-statement-of-financial-position-${localToday()}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
}
