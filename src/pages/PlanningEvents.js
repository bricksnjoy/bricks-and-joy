import React, { useState } from 'react'
import Planning from './Planning'
import Events from './Events'
import { Sparkles, PartyPopper } from 'lucide-react'

const TABS = [
  { key: 'planning', label: 'Planning', icon: Sparkles },
  { key: 'events', label: 'Events', icon: PartyPopper },
]

export default function PlanningEvents() {
  const [tab, setTab] = useState('planning')
  return (
    <div>
      <div style={{ display: 'inline-flex', background: '#f0f0f0', borderRadius: 10, padding: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.key ? 700 : 500,
              background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#0d1b2a' : '#888', boxShadow: tab === t.key ? '0 1px 4px rgba(0,0,0,0.1)' : 'none' }}>
            <t.icon size={14} color={tab === t.key ? '#FFA500' : '#aaa'} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'planning' ? <Planning /> : <Events />}
    </div>
  )
}
