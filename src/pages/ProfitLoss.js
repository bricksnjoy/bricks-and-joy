import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Table, Modal, Spinner, FormRow, useToast, Toasts, MetricCard } from '../components/UI'
import { Plus, Trash2, TrendingUp, TrendingDown } from 'lucide-react'

const EXP_CATS = ['Warehouse / Rent', 'Shipping & Logistics', 'Staff / Salaries', 'Marketing', 'Packaging', 'Returns & Refunds', 'Utilities', 'Other']
const EMPTY_EXP = { description: '', category: 'Warehouse / Rent', amount: '', expense_date: new Date().toISOString().split('T')[0] }

export default function ProfitLoss() {
  const [orders, setOrders] = useState([])
  const [products, setProducts] = useState([])
  const [expenses, setExpenses] = useState([])
  const [purchaseOrders, setPurchaseOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(EMPTY_EXP)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [o, p, e, po] = await Promise.all([
      supabase.from('orders').select('*'),
      supabase.from('products').select('id, name, cost_price'),
      supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
      supabase.from('purchase_orders').select('*'),
    ])
    setOrders(o.data || [])
    setProducts(p.data || [])
    setExpenses(e.data || [])
    setPurchaseOrders(po.data || [])
    setLoading(false)
  }

  async function saveExpense() {
    if (!form.description || !form.amount) return
    setSaving(true)
    const { error } = await supabase.from('expenses').insert({ ...form, amount: parseFloat(form.amount) })
    setSaving(false)
    if (error) { toast.error('Failed to save'); return }
    toast.success('Expense added!')
    setModal(false)
    setForm(EMPTY_EXP)
    load()
  }

  async function delExpense(id) {
    if (!window.confirm('Delete this expense?')) return
    await supabase.from('expenses').delete().eq('id', id)
    toast.success('Deleted')
    load()
  }

  const f = k => e => setForm(prev => ({ ...prev, [k]: e.target.value }))

  // Calculations
  const delivered = orders.filter(o => o.status === 'delivered')
  const revenue = delivered.reduce((s, o) => s + Number(o.total_price || 0), 0)
  const cogs = delivered.reduce((s, o) => {
    const p = products.find(p => p.id === o.product_id)
    return s + (p ? o.qty * Number(p.cost_price) : 0)
  }, 0)
  const grossProfit = revenue - cogs
  const grossMargin = revenue > 0 ? (grossProfit / revenue * 100).toFixed(1) : 0
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount), 0)
  const netProfit = grossProfit - totalExpenses
  const netMargin = revenue > 0 ? (netProfit / revenue * 100).toFixed(1) : 0

  // Expenses by category
  const expByCategory = {}
  expenses.forEach(e => { expByCategory[e.category] = (expByCategory[e.category] || 0) + Number(e.amount) })

  const plRows = [
    { label: 'Gross revenue', value: revenue, type: 'income', bold: false },
    { label: 'Cost of goods sold (COGS)', value: -cogs, type: 'cost', bold: false, indent: true },
    { label: 'Gross profit', value: grossProfit, type: grossProfit >= 0 ? 'profit' : 'loss', bold: true, margin: `${grossMargin}% margin` },
    { label: 'Operating expenses', value: -totalExpenses, type: 'cost', bold: false, indent: true },
    { label: 'Net profit', value: netProfit, type: netProfit >= 0 ? 'profit' : 'loss', bold: true, large: true, margin: `${netMargin}% net margin` },
  ]

  const expColumns = [
    { key: 'expense_date', label: 'Date', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.expense_date}</span> },
    { key: 'description', label: 'Description', render: r => <span style={{ fontWeight: 500 }}>{r.description}</span> },
    { key: 'category', label: 'Category', render: r => <span style={{ color: '#888', fontSize: 12 }}>{r.category}</span> },
    { key: 'amount', label: 'Amount', render: r => <span style={{ color: '#c62828', fontWeight: 500 }}>-MVR {Number(r.amount).toFixed(2)}</span> },
    { key: 'actions', label: '', render: r => <Button variant="danger" size="sm" onClick={() => delExpense(r.id)}><Trash2 size={13} /></Button> },
  ]

  if (loading) return <Spinner />

  return (
    <div>
      <PageHeader title="Profit & Loss" subtitle="Based on delivered orders"
        action={<Button onClick={() => setModal(true)}><Plus size={15} /> Add expense</Button>} />

      {/* Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
        <MetricCard label="Revenue" value={`MVR ${revenue.toFixed(2)}`} icon={TrendingUp} />
        <MetricCard label="Gross profit" value={`MVR ${grossProfit.toFixed(2)}`} color={grossProfit >= 0 ? '#2e7d32' : '#c62828'} icon={TrendingUp} sub={`${grossMargin}% margin`} />
        <MetricCard label="Total expenses" value={`MVR ${totalExpenses.toFixed(2)}`} color="#c62828" icon={TrendingDown} />
        <MetricCard label="Net profit" value={`${netProfit >= 0 ? 'MVR ' : '-MVR '}${Math.abs(netProfit).toFixed(2)}`} color={netProfit >= 0 ? '#2e7d32' : '#c62828'} icon={netProfit >= 0 ? TrendingUp : TrendingDown} sub={`${netMargin}% margin`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        {/* P&L Statement */}
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>Profit & loss statement</h3>
          {plRows.map((row, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: row.large ? '14px 0 4px' : '10px 0',
              borderTop: row.bold ? '1px solid #eee' : 'none',
              paddingLeft: row.indent ? 16 : 0,
            }}>
              <div>
                <span style={{ fontSize: row.large ? 15 : 13, fontWeight: row.bold ? 600 : 400, color: row.indent ? '#888' : '#333' }}>
                  {row.label}
                </span>
                {row.margin && <span style={{ fontSize: 11, color: '#aaa', marginLeft: 8 }}>{row.margin}</span>}
              </div>
              <span style={{
                fontSize: row.large ? 16 : 13,
                fontWeight: row.bold ? 700 : 500,
                color: row.type === 'profit' ? '#2e7d32' : row.type === 'loss' ? '#c62828' : row.type === 'cost' ? '#c62828' : '#333'
              }}>
                {row.value >= 0 ? `MVR ${row.value.toFixed(2)}` : `-MVR ${Math.abs(row.value).toFixed(2)}`}
              </span>
            </div>
          ))}
        </Card>

        {/* Expenses by category */}
        <Card>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>Expenses by category</h3>
          {Object.keys(expByCategory).length === 0 ? (
            <p style={{ color: '#aaa', fontSize: 13 }}>No expenses recorded yet.</p>
          ) : Object.entries(expByCategory).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => {
            const pct = totalExpenses > 0 ? (amt / totalExpenses * 100).toFixed(0) : 0
            return (
              <div key={cat} style={{ marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#666', marginBottom: 4 }}>
                  <span>{cat}</span>
                  <span>MVR {amt.toFixed(2)} <span style={{ color: '#aaa' }}>({pct}%)</span></span>
                </div>
                <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: '#FFA500', borderRadius: 3 }} />
                </div>
              </div>
            )
          })}
        </Card>
      </div>

      {/* Expenses table */}
      <Card>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: '#0d1b2a' }}>All expenses</h3>
        <Table columns={expColumns} data={expenses} emptyMessage="No expenses yet. Add your first expense above." />
      </Card>

      {modal && (
        <Modal title="Add expense" onClose={() => setModal(false)}>
          <FormRow>
            <Input label="Description *" value={form.description} onChange={f('description')} placeholder="e.g. Monthly warehouse rent" style={{ gridColumn: 'span 2' }} />
          </FormRow>
          <FormRow>
            <Select label="Category" value={form.category} onChange={f('category')} options={EXP_CATS} />
            <Input label="Amount (MVR) *" type="number" step="0.01" value={form.amount} onChange={f('amount')} placeholder="0.00" />
          </FormRow>
          <Input label="Date" type="date" value={form.expense_date} onChange={f('expense_date')} style={{ marginBottom: 16 }} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={saveExpense} disabled={saving}>{saving ? 'Saving…' : 'Add expense'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
