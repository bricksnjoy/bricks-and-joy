import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Modal, Spinner, useToast, Toasts } from '../components/UI'
import { Tag, Plus, Edit2, Trash2, Package, AlertTriangle } from 'lucide-react'

const PRESET_COLORS = ['#FFA500','#7F77DD','#1D9E75','#378ADD','#E24B4A','#0F6E56','#f57f17','#29b6f6','#c62828','#6a1b9a']

const DEFAULT_CATS = ['Building & Blocks','Action Figures','Dolls & Plush','Board Games','Outdoor & Sports','Educational','Vehicles & RC','Arts & Crafts','Puzzles','Other']

export default function Categories() {
  const [categories, setCategories] = useState([])  // from categories table
  const [productCats, setProductCats] = useState([]) // unique cats used in products
  const [productCounts, setProductCounts] = useState({}) // cat -> count
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'add' | category obj for edit
  const [form, setForm] = useState({ name: '', color: '#FFA500' })
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [cats, prods] = await Promise.all([
      supabase.from('categories').select('*').order('name'),
      supabase.from('products').select('category'),
    ])
    const catData = cats.data || []
    const prodData = prods.data || []

    // Count products per category
    const counts = {}
    prodData.forEach(p => { if (p.category) counts[p.category] = (counts[p.category] || 0) + 1 })
    setProductCounts(counts)

    // Unique categories from products
    const usedCats = [...new Set(prodData.map(p => p.category).filter(Boolean))]
    setProductCats(usedCats)
    setCategories(catData)
    setLoading(false)
  }

  // Build merged list: managed categories + legacy ones from products not yet in the table
  function getMergedList() {
    const managedNames = new Set(categories.map(c => c.name))
    const legacy = productCats.filter(c => !managedNames.has(c))
    return { managed: categories, legacy }
  }

  function openAdd() {
    setForm({ name: '', color: '#FFA500' })
    setModal('add')
  }

  function openEdit(cat) {
    setForm({ name: cat.name, color: cat.color || '#FFA500' })
    setModal(cat)
  }

  async function save() {
    if (!form.name.trim()) { toast.error('Name is required'); return }
    setSaving(true)
    if (modal === 'add') {
      const { error } = await supabase.from('categories').insert({ name: form.name.trim(), color: form.color })
      if (error) { toast.error(error.message.includes('unique') ? 'Category already exists' : 'Failed to save'); setSaving(false); return }
      toast.success('Category added!')
    } else {
      const oldName = modal.name
      const { error } = await supabase.from('categories').update({ name: form.name.trim(), color: form.color }).eq('id', modal.id)
      if (error) { toast.error('Failed to update'); setSaving(false); return }
      // Rename in products if name changed
      if (oldName !== form.name.trim()) {
        await supabase.from('products').update({ category: form.name.trim() }).eq('category', oldName)
        toast.success(`Renamed "${oldName}" → "${form.name.trim()}" and updated all products`)
      } else {
        toast.success('Category updated!')
      }
    }
    setSaving(false)
    setModal(null)
    load()
  }

  async function deleteCat(cat) {
    const count = productCounts[cat.name] || 0
    if (count > 0) { setDeleteConfirm({ cat, count }); return }
    await supabase.from('categories').delete().eq('id', cat.id)
    toast.success('Deleted')
    load()
  }

  async function confirmDelete() {
    const { cat } = deleteConfirm
    // Reassign products to 'Other'
    await supabase.from('products').update({ category: 'Other' }).eq('category', cat.name)
    await supabase.from('categories').delete().eq('id', cat.id)
    toast.success(`Deleted "${cat.name}" — ${deleteConfirm.count} product(s) moved to "Other"`)
    setDeleteConfirm(null)
    load()
  }

  async function importLegacy(name) {
    const color = PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
    const { error } = await supabase.from('categories').insert({ name, color })
    if (error) { toast.error('Failed to import'); return }
    toast.success(`"${name}" added to managed categories`)
    load()
  }

  async function seedDefaults() {
    if (!window.confirm('Add all default Brick\'s & Joy categories?')) return
    const managedNames = new Set(categories.map(c => c.name))
    const toAdd = DEFAULT_CATS.filter(n => !managedNames.has(n))
    if (toAdd.length === 0) { toast.info('All defaults already exist'); return }
    const records = toAdd.map((name, i) => ({ name, color: PRESET_COLORS[i % PRESET_COLORS.length] }))
    await supabase.from('categories').insert(records)
    toast.success(`Added ${records.length} default categories`)
    load()
  }

  const { managed, legacy } = getMergedList()

  return (
    <div>
      <PageHeader
        title="Product Categories"
        subtitle="Manage categories used across inventory and sales reports"
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            {categories.length === 0 && (
              <Button variant="ghost" onClick={seedDefaults}><Plus size={14} /> Seed defaults</Button>
            )}
            <Button onClick={openAdd}><Plus size={14} /> Add category</Button>
          </div>
        }
      />

      {loading ? <Spinner /> : (
        <>
          {/* Stats */}
          <div className="grid-collapse" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Managed categories', value: managed.length, color: '#FFA500' },
              { label: 'Legacy (unmanaged)', value: legacy.length, color: '#7F77DD' },
              { label: 'Total products', value: Object.values(productCounts).reduce((a, b) => a + b, 0), color: '#1D9E75' },
            ].map((s, i) => (
              <Card key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: s.color + '14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Tag size={18} color={s.color} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#bbb', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600, marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#0d1b2a' }}>{s.value}</div>
                </div>
              </Card>
            ))}
          </div>

          {/* Managed categories */}
          <Card style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag size={14} color="#FFA500" /> Managed Categories
            </h3>
            {managed.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#ccc' }}>
                <p style={{ fontSize: 13, marginBottom: 12 }}>No managed categories yet.</p>
                <Button variant="ghost" onClick={seedDefaults}><Plus size={13} /> Seed default categories</Button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                {managed.map(cat => (
                  <div key={cat.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', border: '1px solid #f0f0f0', borderRadius: 12, transition: 'box-shadow 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.07)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: (cat.color || '#FFA500') + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <div style={{ width: 12, height: 12, borderRadius: '50%', background: cat.color || '#FFA500' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cat.name}</div>
                      <div style={{ fontSize: 11, color: '#bbb', marginTop: 1 }}>
                        <Package size={10} style={{ display: 'inline', marginRight: 3 }} />
                        {productCounts[cat.name] || 0} product{productCounts[cat.name] !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button className="icon-btn" onClick={() => openEdit(cat)} title="Edit"><Edit2 size={13} /></button>
                      <button className="icon-btn danger" onClick={() => deleteCat(cat)} title="Delete"><Trash2 size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Legacy categories */}
          {legacy.length > 0 && (
            <Card>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={14} color="#f57f17" /> Legacy Categories
              </h3>
              <p style={{ fontSize: 12, color: '#aaa', margin: '0 0 14px' }}>These categories exist in your products but aren't managed. Click to add them.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {legacy.map(name => (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#f8f7f4', border: '1px solid #eee', borderRadius: 99, padding: '5px 12px 5px 8px', fontSize: 12 }}>
                    <span style={{ color: '#666' }}>{name}</span>
                    <span style={{ fontSize: 10, color: '#bbb' }}>{productCounts[name] || 0} products</span>
                    <button onClick={() => importLegacy(name)} style={{ background: '#FFA500', color: '#fff', border: 'none', borderRadius: 99, padding: '2px 8px', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>Add</button>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {/* Add / Edit modal */}
      {modal && (
        <Modal
          title={modal === 'add' ? 'Add category' : `Edit "${modal.name}"`}
          subtitle={modal !== 'add' && productCounts[modal.name] ? `Used by ${productCounts[modal.name]} product(s) — renaming will update them all` : undefined}
          onClose={() => setModal(null)}
          width={440}
        >
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 6 }}>Category name <span style={{ color: '#FFA500' }}>*</span></label>
            <input
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Board Games"
              autoFocus
              style={{ width: '100%', padding: '10px 13px', border: '1px solid #e0e0e0', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ marginBottom: 22 }}>
            <label style={{ fontSize: 11, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: 8 }}>Color</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setForm(p => ({ ...p, color: c }))} style={{
                  width: 30, height: 30, borderRadius: 8, background: c, border: form.color === c ? '3px solid #0d1b2a' : '2px solid transparent',
                  cursor: 'pointer', transition: 'transform 0.1s', transform: form.color === c ? 'scale(1.15)' : 'scale(1)',
                }} />
              ))}
            </div>
          </div>
          {/* Preview */}
          <div style={{ background: '#f8f7f4', borderRadius: 10, padding: '12px 14px', marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: form.color + '18', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 12, height: 12, borderRadius: '50%', background: form.color }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#0d1b2a' }}>{form.name || 'Preview'}</span>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : modal === 'add' ? 'Add category' : 'Save changes'}</Button>
          </div>
        </Modal>
      )}

      {/* Delete confirm modal */}
      {deleteConfirm && (
        <Modal title="Delete category?" onClose={() => setDeleteConfirm(null)} width={420}>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px', marginBottom: 20, fontSize: 13, color: '#b91c1c' }}>
            <strong>"{deleteConfirm.cat.name}"</strong> is used by {deleteConfirm.count} product(s). Deleting it will move those products to "Other".
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="danger" onClick={confirmDelete}>Delete &amp; move to Other</Button>
          </div>
        </Modal>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
