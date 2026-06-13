import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Button, Input, Select, Modal, Spinner, useToast, Toasts } from '../components/UI'
import { Plus, Trash2, CheckCircle, Circle, ChevronLeft, ChevronRight, Calendar, ClipboardList } from 'lucide-react'

const PRIORITIES = ['Low', 'Medium', 'High']
const PRIORITY_COLORS = { Low: '#1D9E75', Medium: '#f57f17', High: '#c62828' }
const TASK_EMPTY = { title: '', date: new Date().toISOString().split('T')[0], priority: 'Medium', notes: '' }

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}
function getFirstDayOfMonth(year, month) {
  return new Date(year, month, 1).getDay()
}

export default function TasksCalendar() {
  const [tasks, setTasks] = useState([])
  const [taskHistory, setTaskHistory] = useState(() => { try { return JSON.parse(localStorage.getItem('bj_tasks_history') || '[]') } catch { return [] } })
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('calendar')
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(TASK_EMPTY)
  const [saving, setSaving] = useState(false)
  const [calDate, setCalDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState(null)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const storedTasks = JSON.parse(localStorage.getItem('bj_tasks') || '[]')
    const { data: ords } = await supabase
      .from('orders')
      .select('*')
      .in('status', ['pending', 'transit'])
      .order('order_date')
    setTasks(storedTasks)
    setOrders(ords || [])
    setLoading(false)
  }

  function saveTasks(updated) {
    localStorage.setItem('bj_tasks', JSON.stringify(updated))
    setTasks(updated)
  }

  function saveHistory(updated) {
    localStorage.setItem('bj_tasks_history', JSON.stringify(updated))
    setTaskHistory(updated)
  }

  function completeTask(id) {
    const task = tasks.find(t => t.id === id)
    if (task) {
      const completed = { ...task, done: true, completed_at: new Date().toISOString() }
      saveHistory([completed, ...taskHistory])
    }
    saveTasks(tasks.filter(t => t.id !== id))
    toast.success('Task completed! ✅')
  }

  function deleteTask(id) {
    if (!window.confirm('Delete this task?')) return
    saveTasks(tasks.filter(t => t.id !== id))
    toast.success('Deleted')
  }

  function deleteHistoryTask(id) {
    saveHistory(taskHistory.filter(t => t.id !== id))
    toast.success('Removed from history')
  }

  function clearHistory() {
    if (!window.confirm('Clear all task history?')) return
    saveHistory([])
    toast.success('History cleared')
  }

  function openAdd(date) {
    setForm({ ...TASK_EMPTY, date: date || new Date().toISOString().split('T')[0] })
    setModal(true)
  }

  function addTask() {
    if (!form.title) return
    setSaving(true)
    const newTask = { ...form, id: Date.now().toString(), done: false, created_at: new Date().toISOString() }
    saveTasks([...tasks, newTask])
    setSaving(false)
    setModal(false)
    toast.success('Task added!')
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  // Calendar helpers
  const year = calDate.getFullYear()
  const month = calDate.getMonth()
  const daysInMonth = getDaysInMonth(year, month)
  const firstDay = getFirstDayOfMonth(year, month)
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`
  const today = new Date().toISOString().split('T')[0]

  function prevMonth() { setCalDate(new Date(year, month - 1, 1)); setSelectedDay(null) }
  function nextMonth() { setCalDate(new Date(year, month + 1, 1)); setSelectedDay(null) }

  // Events per day
  function getEventsForDay(day) {
    const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
    const dayTasks = tasks.filter(t => t.date === dateStr)
    const dayDeliveries = orders.filter(o => o.order_date === dateStr && o.delivery_person)
    return { tasks: dayTasks, deliveries: dayDeliveries }
  }

  const selectedDateStr = selectedDay ? `${monthStr}-${String(selectedDay).padStart(2, '0')}` : null
  const selectedEvents = selectedDay ? getEventsForDay(selectedDay) : null

  const pendingTasks = tasks.filter(t => !t.done)
  const todayTasks = tasks.filter(t => t.date === today)
  const upcomingDeliveries = orders.filter(o => o.delivery_person && o.order_date >= today)

  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div>
      <style>{`
        .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 1px; background: #eee; border-radius: 12px; overflow: hidden; }
        .cal-cell { background: #fff; min-height: 90px; padding: 8px; cursor: pointer; transition: background 0.1s; position: relative; }
        .cal-cell:hover { background: #fafafa; }
        .cal-cell.today { background: #FFF8E7; }
        .cal-cell.selected { background: #FFF0CC; outline: 2px solid #FFA500; outline-offset: -2px; }
        .cal-cell.empty { background: #fafafa; cursor: default; }
        .cal-header-cell { background: #f8f7f4; padding: 10px 8px; text-align: center; font-size: 11px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: 0.5px; }
        .task-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin: 1px; }
        .tab-btn { padding: 8px 20px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; font-weight: 600; font-family: inherit; display: flex; align-items: center; gap: 6px; transition: all 0.15s; }
        @media (max-width: 768px) { .cal-cell { min-height: 60px; padding: 4px; } .cal-cell .event-label { display: none; } }
      `}</style>

      <PageHeader title="Tasks & Calendar"
        subtitle="Track tasks and deliveries by date"
        action={<Button onClick={() => openAdd()}><Plus size={15} /> Add task</Button>} />

      {/* Summary row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        {[
          { label: "Today's tasks", value: todayTasks.length, color: todayTasks.length > 0 ? '#f57f17' : '#1D9E75' },
          { label: 'Pending tasks', value: pendingTasks.length, color: pendingTasks.length > 0 ? '#c62828' : '#1D9E75' },
          { label: 'Completed total', value: taskHistory.length, color: '#1D9E75' },
          { label: 'Active deliveries', value: upcomingDeliveries.length, color: '#378ADD' },
        ].map((m, i) => (
          <div key={i} style={{ background: '#fff', borderRadius: 14, padding: '16px 20px', border: '1px solid #eee' }}>
            <div style={{ fontSize: 11, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{m.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {[['calendar', 'Calendar', Calendar], ['tasks', 'Task List', ClipboardList], ['history', 'History', CheckCircle]].map(([id, label, Icon]) => (
          <button key={id} className="tab-btn" onClick={() => setActiveTab(id)}
            style={{ background: activeTab === id ? '#FFA500' : '#fff', color: activeTab === id ? '#fff' : '#555', border: activeTab === id ? 'none' : '1px solid #eee' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {loading ? <Spinner /> : <>

        {/* ── CALENDAR ── */}
        {activeTab === 'calendar' && (
          <div style={{ display: 'grid', gridTemplateColumns: selectedDay ? '1fr 300px' : '1fr', gap: 16 }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {/* Month nav */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid #f0f0f0' }}>
                <button onClick={prevMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex' }}><ChevronLeft size={18} /></button>
                <div style={{ fontWeight: 800, fontSize: 18, color: '#0d1b2a' }}>
                  {calDate.toLocaleDateString('en', { month: 'long', year: 'numeric' })}
                </div>
                <button onClick={nextMonth} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex' }}><ChevronRight size={18} /></button>
              </div>

              {/* Day headers */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: '#f8f7f4', borderBottom: '1px solid #eee' }}>
                {DAYS.map(d => <div key={d} className="cal-header-cell">{d}</div>)}
              </div>

              {/* Calendar grid */}
              <div className="cal-grid">
                {/* Empty cells before first day */}
                {Array.from({ length: firstDay }).map((_, i) => (
                  <div key={`e-${i}`} className="cal-cell empty" />
                ))}
                {/* Day cells */}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                  const dateStr = `${monthStr}-${String(day).padStart(2, '0')}`
                  const { tasks: dt, deliveries: dd } = getEventsForDay(day)
                  const isToday = dateStr === today
                  const isSelected = selectedDay === day
                  return (
                    <div key={day} className={`cal-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}`}
                      onClick={() => setSelectedDay(isSelected ? null : day)}>
                      <div style={{ fontSize: 13, fontWeight: isToday ? 800 : 500, color: isToday ? '#FFA500' : '#0d1b2a', marginBottom: 4 }}>{day}</div>
                      {/* Task dots */}
                      {dt.map(t => (
                        <div key={t.id} className="event-label" style={{ fontSize: 10, background: PRIORITY_COLORS[t.priority] + '22', color: PRIORITY_COLORS[t.priority], borderRadius: 4, padding: '1px 4px', marginBottom: 2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          ☐ {t.title}
                        </div>
                      ))}
                      {/* Delivery dots */}
                      {dd.map(o => (
                        <div key={o.id} className="event-label" style={{ fontSize: 10, background: '#EEF4FF', color: '#378ADD', borderRadius: 4, padding: '1px 4px', marginBottom: 2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          🚴 {o.delivery_person}
                        </div>
                      ))}
                      {/* Mobile dots only */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, marginTop: 2 }}>
                        {dt.map(t => <span key={t.id} className="task-dot" style={{ background: PRIORITY_COLORS[t.priority] }} />)}
                        {dd.map(o => <span key={o.id} className="task-dot" style={{ background: '#378ADD' }} />)}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              <div style={{ padding: '12px 20px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 16, fontSize: 11, color: '#aaa' }}>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#c62828', marginRight: 4 }} />High priority</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#f57f17', marginRight: 4 }} />Medium priority</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#1D9E75', marginRight: 4 }} />Low priority</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#378ADD', marginRight: 4 }} />Delivery</span>
              </div>
            </Card>

            {/* Day detail panel */}
            {selectedDay && selectedEvents && (
              <div>
                <Card>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0d1b2a' }}>
                      {new Date(selectedDateStr).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
                    </div>
                    <button onClick={() => openAdd(selectedDateStr)}
                      style={{ background: '#FFA500', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit' }}>
                      + Task
                    </button>
                  </div>

                  {selectedEvents.tasks.length === 0 && selectedEvents.deliveries.length === 0 && (
                    <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>Nothing scheduled</p>
                  )}

                  {selectedEvents.tasks.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Tasks</div>
                      {selectedEvents.tasks.map(t => (
                        <div key={t.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#f8f7f4', borderRadius: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, color: '#0d1b2a' }}>{t.title}</div>
                            {t.notes && <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{t.notes}</div>}
                            <span style={{ fontSize: 10, fontWeight: 700, color: PRIORITY_COLORS[t.priority], marginTop: 4, display: 'inline-block' }}>{t.priority}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => completeTask(t.id)} title="Mark done" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1D9E75', padding: 2 }}><CheckCircle size={16} /></button>
                            <button onClick={() => deleteTask(t.id)} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c62828', padding: 2 }}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {selectedEvents.deliveries.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, marginTop: 12 }}>Deliveries</div>
                      {selectedEvents.deliveries.map(o => (
                        <div key={o.id} style={{ padding: '10px 12px', background: '#EEF4FF', borderRadius: 10, marginBottom: 8 }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: '#0d1b2a' }}>{o.product_name}</div>
                          <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>👤 {o.customer_name || 'Walk-in'}</div>
                          <div style={{ fontSize: 12, color: '#378ADD', marginTop: 2 }}>🚴 {o.delivery_person}</div>
                          <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, fontFamily: 'monospace' }}>{o.invoice_number || '—'}</div>
                        </div>
                      ))}
                    </>
                  )}
                </Card>
              </div>
            )}
          </div>
        )}

        {/* ── TASK LIST ── */}
        {activeTab === 'tasks' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', margin: 0 }}>Pending tasks ({pendingTasks.length})</h3>
                <Button onClick={() => openAdd()}><Plus size={13} /> Add task</Button>
              </div>

              {pendingTasks.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>
                  <CheckCircle size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
                  <p style={{ fontSize: 14 }}>All clear! No pending tasks.</p>
                </div>
              ) : (
                // Group by date
                (() => {
                  const grouped = {}
                  pendingTasks.sort((a, b) => a.date.localeCompare(b.date)).forEach(t => {
                    if (!grouped[t.date]) grouped[t.date] = []
                    grouped[t.date].push(t)
                  })
                  return Object.entries(grouped).map(([date, dayTasks]) => (
                    <div key={date} style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: date === today ? '#FFA500' : '#aaa', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {date === today && '📌 '}{new Date(date + 'T00:00:00').toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
                        {date < today && <span style={{ color: '#c62828', fontSize: 10 }}>OVERDUE</span>}
                      </div>
                      {dayTasks.map(t => (
                        <div key={t.id} style={{ display: 'flex', gap: 12, padding: '12px 14px', border: '1px solid #eee', borderRadius: 10, marginBottom: 8, alignItems: 'flex-start', borderLeft: `3px solid ${PRIORITY_COLORS[t.priority]}` }}>
                          <button onClick={() => completeTask(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ccc', padding: 0, marginTop: 1, flexShrink: 0 }}>
                            <Circle size={18} />
                          </button>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 14, color: '#0d1b2a' }}>{t.title}</div>
                            {t.notes && <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>{t.notes}</div>}
                            <span style={{ fontSize: 10, fontWeight: 700, color: PRIORITY_COLORS[t.priority], marginTop: 4, display: 'inline-block', background: PRIORITY_COLORS[t.priority] + '15', padding: '2px 6px', borderRadius: 4 }}>{t.priority}</span>
                          </div>
                          <button onClick={() => deleteTask(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ddd', padding: 2 }}><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  ))
                })()
              )}
            </Card>

            {/* Upcoming deliveries */}
            <div>
              <Card>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', marginBottom: 14 }}>🚴 Active deliveries</h3>
                {upcomingDeliveries.length === 0 ? (
                  <p style={{ color: '#aaa', fontSize: 13 }}>No deliveries assigned.</p>
                ) : upcomingDeliveries.slice(0, 10).map(o => (
                  <div key={o.id} style={{ padding: '10px 12px', background: '#f8f7f4', borderRadius: 10, marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{o.product_name}</div>
                    <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>👤 {o.customer_name || 'Walk-in'}</div>
                    <div style={{ fontSize: 12, color: '#378ADD', marginTop: 2 }}>🚴 {o.delivery_person}</div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>{o.order_date}</div>
                  </div>
                ))}
              </Card>
            </div>
          </div>
        )}

        {/* ── HISTORY ── */}
        {activeTab === 'history' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0d1b2a', margin: 0 }}>Completed tasks ({taskHistory.length})</h3>
              {taskHistory.length > 0 && <Button variant="ghost" onClick={clearHistory}><Trash2 size={13} /> Clear all</Button>}
            </div>
            {taskHistory.length === 0 ? (
              <Card>
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#aaa' }}>
                  <CheckCircle size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
                  <p style={{ fontSize: 14 }}>No completed tasks yet.</p>
                </div>
              </Card>
            ) : taskHistory.map(t => (
              <div key={t.id} style={{ display: 'flex', gap: 12, padding: '12px 16px', border: '1px solid #eee', borderRadius: 10, marginBottom: 8, background: '#fff', borderLeft: `3px solid #1D9E75`, alignItems: 'flex-start' }}>
                <CheckCircle size={18} color="#1D9E75" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: '#0d1b2a', textDecoration: 'line-through', opacity: 0.7 }}>{t.title}</div>
                  {t.notes && <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>{t.notes}</div>}
                  <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11, color: '#aaa' }}>
                    <span>📅 Due: {t.date}</span>
                    <span>✅ Done: {t.completed_at ? new Date(t.completed_at).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</span>
                    <span style={{ color: PRIORITY_COLORS[t.priority], fontWeight: 600 }}>{t.priority}</span>
                  </div>
                </div>
                <button onClick={() => deleteHistoryTask(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ddd', padding: 2, flexShrink: 0 }}><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </>}

      {/* Add task modal */}
      {modal && (
        <Modal title="Add task" onClose={() => setModal(false)} width={460}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Task title *</label>
            <input value={form.title} onChange={f('title')} placeholder="e.g. Follow up with supplier, Restock LEGOs…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Date</label>
              <input type="date" value={form.date} onChange={f('date')}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Priority</label>
              <select value={form.priority} onChange={f('priority')}
                style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Notes</label>
            <textarea value={form.notes} onChange={f('notes')} placeholder="Any extra details…"
              style={{ width: '100%', padding: '9px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', minHeight: 60, boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={addTask} disabled={saving || !form.title}>{saving ? 'Adding…' : 'Add task'}</Button>
          </div>
        </Modal>
      )}
      <Toasts toasts={toast.toasts} />
    </div>
  )
}
