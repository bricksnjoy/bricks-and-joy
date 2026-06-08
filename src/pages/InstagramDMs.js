import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Badge, Spinner, Button } from '../components/UI'
import { Instagram, MessageCircle, ShoppingCart } from 'lucide-react'

export default function InstagramDMs() {
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('channel', 'Online')
      .ilike('notes', '%Instagram DM%')
      .order('created_at', { ascending: false })
    setOrders(data || [])
    setLoading(false)
  }

  async function updateStatus(id, status) {
    await supabase.from('orders').update({ status }).eq('id', id)
    load()
  }

  const statusColors = { pending: 'amber', transit: 'blue', delivered: 'green', cancelled: 'red' }
  const statusLabels = { pending: 'Pending', transit: 'Dispatched', delivered: 'Delivered', cancelled: 'Cancelled' }

  return (
    <div>
      <PageHeader title="Instagram Orders" subtitle="Orders received via Instagram DM bot" />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 24 }}>
        {['pending', 'transit', 'delivered'].map(s => (
          <div key={s} style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '16px 20px' }}>
            <div style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{statusLabels[s]}</div>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{orders.filter(o => o.status === s).length}</div>
          </div>
        ))}
        <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 12, padding: '16px 20px' }}>
          <div style={{ fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Revenue</div>
          <div style={{ fontSize: 26, fontWeight: 700, color: '#2e7d32' }}>
            ${orders.filter(o => o.status === 'delivered').reduce((s, o) => s + Number(o.total_price || 0), 0).toFixed(2)}
          </div>
        </div>
      </div>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Instagram size={16} color="#E1306C" />
          <span style={{ fontWeight: 600, fontSize: 14 }}>Instagram DM orders</span>
        </div>
        {loading ? <Spinner /> : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>
            <MessageCircle size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p style={{ fontSize: 14 }}>No Instagram orders yet.</p>
            <p style={{ fontSize: 12, marginTop: 4 }}>Once your bot is connected, orders from Instagram DMs will appear here automatically.</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>{['Customer', 'Product', 'Qty', 'Total', 'Date', 'Status', ''].map(h => (
                <th key={h} style={{ textAlign: 'left', padding: '6px 12px', fontSize: 11, color: '#999', borderBottom: '1px solid #eee', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {orders.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>{o.customer_name}</td>
                  <td style={{ padding: '10px 12px' }}>{o.product_name}</td>
                  <td style={{ padding: '10px 12px' }}>{o.qty}</td>
                  <td style={{ padding: '10px 12px', fontWeight: 500 }}>${Number(o.total_price || 0).toFixed(2)}</td>
                  <td style={{ padding: '10px 12px', color: '#888', fontSize: 12 }}>{o.order_date}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <select value={o.status} onChange={e => updateStatus(o.id, e.target.value)}
                      style={{ border: 'none', background: 'transparent', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: '#333' }}>
                      {Object.entries(statusLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge color={statusColors[o.status]}>{statusLabels[o.status]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card style={{ marginTop: 20, background: '#fff8f0', border: '1px solid #ffe0cc' }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <Instagram size={20} color="#E1306C" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Bot setup status</div>
            <div style={{ fontSize: 13, color: '#666', lineHeight: 1.6 }}>
              Webhook URL: <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>https://bricks-and-joy.vercel.app/api/instagram-webhook</code><br />
              Verify token: <code style={{ background: '#f0f0f0', padding: '2px 6px', borderRadius: 4, fontSize: 12 }}>bricksandjoy2026</code>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
