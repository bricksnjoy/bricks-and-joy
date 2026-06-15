import React, { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [name, setName] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name } }
        })
        if (error) throw error
        setError('Account created! You can now log in.')
        setMode('login')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // decorative floating toy bricks
  const bricks = [
    { c: '#FFA500', s: 46, top: '12%', left: '8%', d: 0, dur: 7 },
    { c: '#378ADD', s: 34, top: '70%', left: '12%', d: 1.2, dur: 8 },
    { c: '#1D9E75', s: 28, top: '24%', left: '85%', d: 0.6, dur: 6.5 },
    { c: '#E24B4A', s: 40, top: '78%', left: '82%', d: 1.8, dur: 9 },
    { c: '#FFC04D', s: 24, top: '46%', left: '90%', d: 0.3, dur: 7.5 },
    { c: '#7fd3ff', s: 30, top: '88%', left: '45%', d: 2.1, dur: 8.5 },
  ]

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #fff8f0 0%, #e8f4fd 100%)', fontFamily: "'Poppins', sans-serif", padding: '16px',
      position: 'relative', overflow: 'hidden'
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800;900&display=swap');
        @keyframes float { 0%,100%{ transform: translateY(0) rotate(0deg); } 50%{ transform: translateY(-26px) rotate(8deg); } }
        @keyframes popIn { 0%{ opacity:0; transform: scale(0.6) translateY(20px);} 60%{ transform: scale(1.06);} 100%{ opacity:1; transform: scale(1) translateY(0);} }
        @keyframes bob { 0%,100%{ transform: translateY(0);} 50%{ transform: translateY(-7px);} }
        @keyframes slideUp { from{ opacity:0; transform: translateY(16px);} to{ opacity:1; transform: translateY(0);} }
        .bnj-card { animation: slideUp 0.5s 0.15s ease both; }
        .bnj-input { width:100%; padding:11px 13px; border:1.5px solid #e6e6e6; border-radius:10px; font-size:14px; font-family:inherit; box-sizing:border-box; outline:none; transition: all 0.18s; background:#fafafa; }
        .bnj-input:focus { border-color:#FFA500; background:#fff; box-shadow:0 0 0 3px rgba(255,165,0,0.12); }
        .bnj-btn { background: linear-gradient(135deg,#FFB733,#FF9500); color:#fff; border:none; border-radius:10px; padding:13px; font-size:14.5px; font-weight:700; cursor:pointer; font-family:inherit; margin-top:6px; box-shadow:0 6px 16px rgba(255,149,0,0.32); transition: transform 0.15s, box-shadow 0.15s; }
        .bnj-btn:hover:not(:disabled) { transform: translateY(-2px); box-shadow:0 10px 22px rgba(255,149,0,0.42); }
        .bnj-btn:active:not(:disabled) { transform: translateY(0); }
      `}</style>

      {/* Floating decorative bricks */}
      {bricks.map((b, i) => (
        <svg key={i} width={b.s} height={b.s * 1.0} viewBox="0 0 40 40" aria-hidden="true"
          style={{ position: 'absolute', top: b.top, left: b.left, opacity: 0.5, filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.08))', animation: `float ${b.dur}s ease-in-out ${b.d}s infinite`, pointerEvents: 'none' }}>
          <rect x="4" y="12" width="32" height="24" rx="3" fill={b.c} />
          <ellipse cx="13" cy="12" rx="6" ry="4" fill={b.c} />
          <ellipse cx="27" cy="12" rx="6" ry="4" fill={b.c} />
          <ellipse cx="13" cy="11" rx="6" ry="4" fill="rgba(255,255,255,0.35)" />
          <ellipse cx="27" cy="11" rx="6" ry="4" fill="rgba(255,255,255,0.35)" />
          <rect x="4" y="12" width="32" height="7" rx="3" fill="rgba(255,255,255,0.22)" />
        </svg>
      ))}

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 34 }}>
          <img src="/logo.png" alt="Brick's & Joy" style={{ width: 116, height: 116, objectFit: 'contain', display: 'block', margin: '0 auto 12px', filter: 'drop-shadow(0 10px 22px rgba(255,165,0,0.35))', animation: 'popIn 0.6s ease both, bob 3s 0.6s ease-in-out infinite' }} />
          <p style={{ color: '#29b6f6', fontSize: 11, margin: '6px 0 0', textTransform: 'uppercase', letterSpacing: '1.8px', fontWeight: 700 }}>Toy Company · Business Manager</p>
        </div>

        {/* Card */}
        <div className="bnj-card" style={{ background: '#fff', borderRadius: 18, border: '1px solid #f0f0f0', padding: '32px 28px', boxShadow: '0 12px 40px rgba(13,27,42,0.10)' }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 24px', color: '#0d1b2a' }}>
            {mode === 'login' ? 'Sign in to your account' : 'Create an account'}
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'signup' && (
              <div>
                <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Full name</label>
                <input className="bnj-input" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" required />
              </div>
            )}
            <div>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Email</label>
              <input className="bnj-input" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#666', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 5 }}>Password</label>
              <input className="bnj-input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>

            {error && (
              <div style={{ background: error.includes('created') ? '#e8f5e9' : '#fdecea', color: error.includes('created') ? '#2e7d32' : '#c62828', padding: '10px 14px', borderRadius: 8, fontSize: 13 }}>
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="bnj-btn" style={{ cursor: loading ? 'wait' : 'pointer', opacity: loading ? 0.7 : 1 }}>
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 13, color: '#999', margin: '20px 0 0' }}>
            {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
            <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}
              style={{ background: 'none', border: 'none', color: '#FFA500', cursor: 'pointer', fontWeight: 500, fontFamily: 'inherit', fontSize: 13 }}>
              {mode === 'login' ? 'Sign up' : 'Sign in'}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
