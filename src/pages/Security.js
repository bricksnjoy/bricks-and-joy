import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { PageHeader, Card, Spinner, useToast, Toasts } from '../components/UI'
import { ShieldCheck, ShieldAlert, RefreshCw, Check, Trash2, Info } from 'lucide-react'

// What the browser's security policy would have blocked.
//
// The policy lives in deploy/Caddyfile and is set to Report-Only: browsers work
// out what it would stop, allow it anyway, and post a note to /api/csp-report,
// which saves it to the security_reports table. This page is where those notes
// are read, because a report nobody sees is not worth collecting.
//
// It is written for somebody who does not know what a Content-Security-Policy
// is. Every row says, in a sentence, what was blocked and whether it matters.

// Each rule in the policy, in plain words, with how much it would worry us.
// 'high' means a script or an outbound connection — the two things an attacker
// actually wants. 'low' means a picture or a font the policy simply has not
// been told about, which is a missing line in the config, not an intrusion.
const RULES = {
  'script-src': {
    level: 'high',
    what: 'Some JavaScript tried to run',
    why: 'This is the one that matters most. If it names a website we do not recognise, treat it seriously.',
  },
  'connect-src': {
    level: 'high',
    what: 'The page tried to send data to another server',
    why: 'Worth checking who it was trying to reach. If it is not a service we use, that is how stolen data leaves a site.',
  },
  'object-src': {
    level: 'high',
    what: 'The page tried to embed a plug-in',
    why: 'Nothing on our site does this. It should never appear.',
  },
  'base-uri': {
    level: 'high',
    what: 'Something tried to change where the page’s links point',
    why: 'Nothing on our site does this. It is a known trick for quietly redirecting visitors.',
  },
  'form-action': {
    level: 'high',
    what: 'A form tried to submit to another website',
    why: 'Our forms only ever post back to us. Anything else would be sending somebody’s details elsewhere.',
  },
  'frame-src': {
    level: 'medium',
    what: 'The page tried to embed another site inside it',
    why: 'We do not embed anything, so this is unexpected.',
  },
  'img-src': {
    level: 'low',
    what: 'A picture could not be shown',
    why: 'Almost always a place we forgot to list, such as a new image host. Easy to allow.',
  },
  'style-src': {
    level: 'low',
    what: 'Some styling was blocked',
    why: 'Usually a stylesheet from somewhere we have not listed yet.',
  },
  'font-src': {
    level: 'low',
    what: 'A font could not be loaded',
    why: 'Usually a font service we have not listed yet.',
  },
  'media-src': {
    level: 'low',
    what: 'Audio or video was blocked',
    why: 'Something we have not listed yet.',
  },
  'default-src': {
    level: 'medium',
    what: 'Something was blocked that no other rule covers',
    why: 'Worth a look to see what kind of thing it was.',
  },
}

const LEVEL = {
  high:   { bg: '#FDECEA', fg: '#c0392b', label: 'Look at this' },
  medium: { bg: '#FFF3D6', fg: '#b8740a', label: 'Worth a look' },
  low:    { bg: '#EAF2FD', fg: '#2f6fc0', label: 'Probably harmless' },
}

const ruleFor = d => RULES[d] || { level: 'medium', what: `The rule "${d}" was triggered`, why: 'Not one of the usual ones.' }

// We already know about this one. The receipt, invoice, label and report print
// windows are built with window.open and carry a small inline script that calls
// window.print(); they inherit the page's policy, so Report-Only mode is
// expected to flag them. Saying so here saves somebody a worried afternoon.
const isKnownPrinting = r => r.directive === 'script-src' && /^(inline|self|eval)$/i.test(r.blocked_uri)

const fmtWhen = ts => {
  if (!ts) return '—'
  const d = new Date(ts)
  const mins = Math.round((Date.now() - d.getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short' }) + ' · ' +
    d.toLocaleTimeString('en', { hour: 'numeric', minute: '2-digit' })
}

export default function Security() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [notSetup, setNotSetup] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [busy, setBusy] = useState(null)
  const toast = useToast()

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('security_reports').select('*').order('last_seen', { ascending: false }).limit(300)
    if (error) setNotSetup(true)
    else { setNotSetup(false); setRows(data || []) }
    setLoading(false)
  }

  async function acknowledge(r) {
    setBusy(r.id)
    const email = (await supabase.auth.getUser()).data?.user?.email || null
    const { error } = await supabase.from('security_reports')
      .update({ acknowledged: true, acknowledged_by: email, acknowledged_at: new Date().toISOString() })
      .eq('id', r.id)
    setBusy(null)
    if (error) return toast.error('Could not mark it as reviewed: ' + error.message)
    toast.success('Marked as reviewed')
    load()
  }

  async function remove(r) {
    setBusy(r.id)
    const { error } = await supabase.from('security_reports').delete().eq('id', r.id)
    setBusy(null)
    if (error) return toast.error('Could not remove it: ' + error.message)
    toast.success('Removed')
    load()
  }

  const open = rows.filter(r => !r.acknowledged)
  const done = rows.filter(r => r.acknowledged)
  const shown = showDone ? done : open

  const refresh = (
    <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#fff', border: '1px solid #eee', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'inherit', color: '#555' }}>
      <RefreshCw size={13} /> Refresh
    </button>
  )

  return (
    <div>
      <PageHeader title="Security" subtitle="What the website's security policy would have blocked" action={refresh} />

      {notSetup ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '46px 24px' }}>
            <ShieldAlert size={32} color="#FFA500" style={{ marginBottom: 12 }} />
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a', marginBottom: 6 }}>Not set up yet</div>
            <div style={{ fontSize: 13, color: '#888', maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
              The security_reports table does not exist yet. It is created automatically
              on the next deploy — nothing to do by hand.
            </div>
          </div>
        </Card>
      ) : loading ? <Spinner /> : (
        <>
          {/* What this page is, for whoever opens it without context. */}
          <Card style={{ marginBottom: 16, background: '#F7FAFF', border: '1px solid #E4EDFA' }}>
            <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start' }}>
              <Info size={16} color="#2f6fc0" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: '#456', lineHeight: 1.65 }}>
                The website tells every visitor's browser where it is allowed to load things from —
                our own server, and a short list of services we use. Anything else gets reported here.
                <br />
                Right now this is in <strong>watch mode</strong>: nothing is actually being blocked, so
                nothing on the site can break. We are collecting a list first. Once this page stays
                empty through normal use, the policy gets switched on for real.
              </div>
            </div>
          </Card>

          {/* Tabs: things to look at, and things already dealt with. */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            <button onClick={() => setShowDone(false)}
              style={{ padding: '8px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                background: !showDone ? '#0d1b2a' : '#f3f1ec', color: !showDone ? '#fff' : '#777' }}>
              Needs a look{open.length ? ` (${open.length})` : ''}
            </button>
            <button onClick={() => setShowDone(true)}
              style={{ padding: '8px 14px', borderRadius: 99, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
                background: showDone ? '#0d1b2a' : '#f3f1ec', color: showDone ? '#fff' : '#777' }}>
              Reviewed{done.length ? ` (${done.length})` : ''}
            </button>
          </div>

          {shown.length === 0 ? (
            <Card>
              <div style={{ textAlign: 'center', padding: '44px 24px' }}>
                <ShieldCheck size={32} color={showDone ? '#e0e0e0' : '#1D9E75'} style={{ marginBottom: 12 }} />
                <div style={{ fontWeight: 700, fontSize: 15, color: '#0d1b2a', marginBottom: 6 }}>
                  {showDone ? 'Nothing reviewed yet' : 'Nothing to look at'}
                </div>
                <div style={{ fontSize: 13, color: '#888', maxWidth: 420, margin: '0 auto', lineHeight: 1.6 }}>
                  {showDone
                    ? 'Anything you mark as reviewed will be kept here.'
                    : 'No browser has reported anything being blocked. That is the result we want.'}
                </div>
              </div>
            </Card>
          ) : (
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {shown.map((r, i) => {
                const rule = ruleFor(r.directive)
                const lv = LEVEL[rule.level] || LEVEL.medium
                const known = isKnownPrinting(r)
                return (
                  <div key={r.id} style={{ display: 'flex', gap: 12, padding: '14px 16px', borderTop: i ? '1px solid #f6f6f6' : 'none', alignItems: 'flex-start' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, background: known ? '#EAF2FD' : lv.bg, color: known ? '#2f6fc0' : lv.fg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {known ? <Info size={15} /> : <ShieldAlert size={15} />}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 3 }}>
                        <span style={{ fontSize: 13.5, fontWeight: 700, color: '#0d1b2a' }}>{rule.what}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.4px', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 99, background: known ? '#EAF2FD' : lv.bg, color: known ? '#2f6fc0' : lv.fg }}>
                          {known ? 'Known — our own printing' : lv.label}
                        </span>
                      </div>

                      <div style={{ fontSize: 12.5, color: '#667', lineHeight: 1.6, marginBottom: 5 }}>
                        {known
                          ? 'This is our own receipt, invoice, label and report printing. Those windows carry a small script that opens the print dialogue, and the policy counts it. It is expected, and it has to be changed before the policy can be switched on for real — otherwise printing would stop working.'
                          : rule.why}
                      </div>

                      <div style={{ fontSize: 11.5, color: '#999', lineHeight: 1.7 }}>
                        <div><span style={{ color: '#bbb' }}>Where it wanted to load from: </span><code style={{ background: '#f6f6f6', padding: '1px 6px', borderRadius: 4, color: '#556' }}>{r.blocked_uri}</code></div>
                        <div><span style={{ color: '#bbb' }}>On the page: </span>{r.document_uri || '—'}</div>

                        {/* What actually tried to run. "inline" names the rule and
                            nothing else; this names the script. Browsers send only
                            the first characters, on purpose — enough to recognise a
                            thing, not enough to give away what it was carrying. */}
                        {r.sample && (
                          <div>
                            <span style={{ color: '#bbb' }}>What tried to run: </span>
                            <code style={{ background: '#fff8ec', border: '1px solid #ffe2b8', padding: '1px 6px', borderRadius: 4, color: '#8a5a00', wordBreak: 'break-all' }}>{r.sample}</code>
                            <span style={{ color: '#ccc' }}> (first few characters only)</span>
                          </div>
                        )}
                        {r.source_file && (
                          <div>
                            <span style={{ color: '#bbb' }}>Came from: </span>
                            <code style={{ background: '#f6f6f6', padding: '1px 6px', borderRadius: 4, color: '#556', wordBreak: 'break-all' }}>
                              {r.source_file}{r.line_number ? `:${r.line_number}` : ''}
                            </code>
                          </div>
                        )}
                        <div>
                          <span style={{ color: '#bbb' }}>Seen: </span>
                          {r.hits} time{r.hits === 1 ? '' : 's'} · first {fmtWhen(r.first_seen)} · last {fmtWhen(r.last_seen)}
                        </div>
                        {r.acknowledged && (
                          <div style={{ color: '#1D9E75' }}>
                            Reviewed by {r.acknowledged_by || 'someone'} {fmtWhen(r.acknowledged_at)}
                          </div>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      {!r.acknowledged && (
                        <button className="icon-btn primary" title="Mark as reviewed" disabled={busy === r.id}
                          onClick={() => acknowledge(r)}>
                          <Check size={14} />
                        </button>
                      )}
                      <button className="icon-btn danger" title="Remove — use once it is actually fixed" disabled={busy === r.id}
                        onClick={() => remove(r)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </Card>
          )}
        </>
      )}

      <Toasts toasts={toast.toasts} />
    </div>
  )
}
