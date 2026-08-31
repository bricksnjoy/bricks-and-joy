// The `supabase` object — except there is no Supabase behind it any more.
//
// The shop and the back office make about four hundred calls that look like
//
//     supabase.from('orders').select('*').eq('status', 'created').order('order_date')
//
// spread across forty-odd files. When the app moved to our own server on the
// KVM2 box, rewriting every one of those was the obvious plan and the wrong
// one: four hundred hand edits is four hundred chances to change a filter by
// accident, in code that decides what a customer is charged.
//
// So the calls stayed exactly as they were, and this file changed instead. It
// exports the same `supabase` object with the same methods, and each one now
// gathers up what was asked for and posts it to /api, which runs the query
// against our PostgreSQL and answers in the same { data, error } shape.
//
// What is behind each part now:
//
//     .from(...)          -> POST /api/db/query          (PostgreSQL)
//     .auth               -> /api/auth/*                 (our own accounts)
//     .storage            -> /api/storage/*              (Cloudflare R2)
//     .rpc(...)           -> POST /api/rpc/:name
//     .functions.invoke   -> POST /api/functions/:name   (were Edge Functions)
//     .channel(...)       -> a WebSocket to /realtime     (who's online)

const API = (process.env.REACT_APP_API_URL || '/api').replace(/\/+$/, '')

// Where uploaded pictures are read from. Set REACT_APP_R2_PUBLIC_BASE to the
// bucket's public address (a custom domain, or the r2.dev URL) and browsers
// fetch straight from Cloudflare. Left unset, the API serves them instead —
// which works, but pays for the bandwidth twice.
const R2_PUBLIC_BASE = (process.env.REACT_APP_R2_PUBLIC_BASE || '').replace(/\/+$/, '')

const STORAGE_KEY = 'bnj.auth.session'

// ─────────────────────────────────────────────────────────────────────────────
// The session
// ─────────────────────────────────────────────────────────────────────────────
// Kept in localStorage, the way supabase-js kept it, so a signed-in tab
// survives a refresh and every tab shares one session.

let session = null
const listeners = new Set()

const readStored = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') } catch { return null }
}

function setSession(next, event) {
  session = next || null
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch { /* private browsing — the session just won't outlive the tab */ }

  const name = event || (session ? 'SIGNED_IN' : 'SIGNED_OUT')
  listeners.forEach(fn => { try { fn(name, session) } catch { /* a listener's problem */ } })
}

session = readStored()

// Signing out in one tab signs out the others.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key !== STORAGE_KEY) return
    session = readStored()
    listeners.forEach(fn => { try { fn(session ? 'SIGNED_IN' : 'SIGNED_OUT', session) } catch { /* ignore */ } })
  })
}

const expired = () => !session?.expires_at || session.expires_at * 1000 < Date.now() + 30_000

// One refresh at a time, however many calls are waiting on it.
let refreshing = null
async function refreshSession() {
  if (!session?.refresh_token) return null
  if (refreshing) return refreshing

  refreshing = (async () => {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.data?.session) { setSession(null, 'SIGNED_OUT'); return null }
      setSession(body.data.session, 'TOKEN_REFRESHED')
      return session
    } catch {
      // The server is unreachable, which is not the same as being signed out —
      // keep the session and let the failing call report the network error.
      return null
    } finally {
      refreshing = null
    }
  })()

  return refreshing
}

// ─────────────────────────────────────────────────────────────────────────────
// Talking to the API
// ─────────────────────────────────────────────────────────────────────────────
async function apiFetch(path, { method = 'POST', body, headers = {}, raw = false, retry = true, passthrough = false } = {}) {
  if (session && expired()) await refreshSession()

  const opts = { method, headers: { ...headers } }
  if (session?.access_token) opts.headers.Authorization = `Bearer ${session.access_token}`

  if (raw) opts.body = body
  else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(`${API}${path}`, opts)
  } catch (e) {
    // Offline, or the server is down. Shaped like a Supabase error so the
    // pages that check error.message keep working.
    return { data: null, error: { message: `Could not reach the server (${e.message})`, code: 'NETWORK' } }
  }

  // The token went stale between the check above and the request landing.
  if (res.status === 401 && retry && session?.refresh_token) {
    const fresh = await refreshSession()
    if (fresh) return apiFetch(path, { method, body, headers, raw, passthrough, retry: false })
  }

  let payload
  try { payload = await res.json() } catch { payload = null }

  // The ported Edge Functions answer with their own shape — { ok }, or
  // { error, detail } — and callers read it directly, so it is handed back
  // whole rather than being unwrapped as a { data, error } envelope.
  if (passthrough) {
    if (!res.ok) return { data: null, error: { message: payload?.error?.message || payload?.detail || `Request failed (${res.status})`, code: String(res.status) } }
    return { data: payload, error: null }
  }

  if (payload && ('data' in payload || 'error' in payload)) {
    return { data: payload.data ?? null, error: payload.error ?? null }
  }
  if (!res.ok) {
    return { data: null, error: { message: payload?.message || `Request failed (${res.status})`, code: String(res.status) } }
  }
  return { data: payload, error: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// .from(table) — the query builder
// ─────────────────────────────────────────────────────────────────────────────
// Same chain as supabase-js, and thenable in the same way: nothing is sent
// until the chain is awaited or .then() is called on it.

class QueryBuilder {
  constructor(table) {
    this._q = {
      table,
      op: 'select',
      columns: '*',
      filters: [],
      order: [],
      limit: null,
      offset: null,
      values: undefined,
      onConflict: undefined,
      returning: false,
      single: null,
    }
  }

  // On a read this picks the columns. Chained after a write it means "and give
  // me back the rows", which is what `.insert(x).select()` has always meant.
  select(columns) {
    if (this._q.op === 'select') this._q.columns = columns || '*'
    else { this._q.returning = true; this._q.columns = columns || '*' }
    return this
  }

  insert(values) { this._q.op = 'insert'; this._q.values = values; return this }
  update(values) { this._q.op = 'update'; this._q.values = values; return this }
  delete()       { this._q.op = 'delete'; return this }

  upsert(values, options = {}) {
    this._q.op = 'upsert'
    this._q.values = values
    if (options.onConflict) this._q.onConflict = options.onConflict
    return this
  }

  eq(column, value)    { this._q.filters.push(['eq', column, value]); return this }
  neq(column, value)   { this._q.filters.push(['neq', column, value]); return this }
  gt(column, value)    { this._q.filters.push(['gt', column, value]); return this }
  gte(column, value)   { this._q.filters.push(['gte', column, value]); return this }
  lt(column, value)    { this._q.filters.push(['lt', column, value]); return this }
  lte(column, value)   { this._q.filters.push(['lte', column, value]); return this }
  like(column, value)  { this._q.filters.push(['like', column, value]); return this }
  ilike(column, value) { this._q.filters.push(['ilike', column, value]); return this }
  is(column, value)    { this._q.filters.push(['is', column, value]); return this }
  in(column, values)   { this._q.filters.push(['in', column, values]); return this }
  contains(column, v)  { this._q.filters.push(['contains', column, v]); return this }

  // match({ a: 1, b: 2 }) is shorthand for .eq('a', 1).eq('b', 2)
  match(criteria) {
    Object.entries(criteria || {}).forEach(([k, v]) => this._q.filters.push(['eq', k, v]))
    return this
  }

  filter(column, operator, value) { this._q.filters.push([operator, column, value]); return this }

  order(column, { ascending = true, nullsFirst } = {}) {
    this._q.order.push([column, ascending, nullsFirst])
    return this
  }

  limit(n) { this._q.limit = n; return this }

  range(from, to) {
    this._q.offset = from
    this._q.limit = to - from + 1
    return this
  }

  single()      { this._q.single = 'one'; return this }
  maybeSingle() { this._q.single = 'maybe'; return this }

  _run() { return apiFetch('/db/query', { body: this._q }) }

  // Thenable, so `await supabase.from(...)...` works and so does .then/.catch.
  then(onFulfilled, onRejected) { return this._run().then(onFulfilled, onRejected) }
  catch(onRejected) { return this._run().catch(onRejected) }
  finally(onFinally) { return this._run().finally(onFinally) }
}

// ─────────────────────────────────────────────────────────────────────────────
// .storage — Cloudflare R2
// ─────────────────────────────────────────────────────────────────────────────
function storageBucket(bucket) {
  return {
    /**
     * The file goes to the API, which puts it in R2.
     *
     * One difference worth knowing: the server decides the final object name
     * for anyone who is not signed-in staff, so a shopper uploading a payment
     * slip cannot overwrite a product photo. The name it chose comes back as
     * `data.path` — always use that, not the name you asked for.
     */
    async upload(name, body, options = {}) {
      const form = new FormData()
      const type = options.contentType || body?.type || 'application/octet-stream'
      form.append('file', body instanceof Blob ? body : new Blob([body], { type }), name)
      form.append('name', name)
      if (options.upsert) form.append('upsert', 'true')

      const { data, error } = await apiFetch(`/storage/${bucket}/upload`, { body: form, raw: true })
      if (error) return { data: null, error }
      return { data: { path: data.path, publicUrl: data.publicUrl, fullPath: `${bucket}/${data.path}` }, error: null }
    },

    // Synchronous, like supabase-js — pages read .data.publicUrl straight away.
    getPublicUrl(name) {
      const key = encodeURIComponent(name)
      const url = R2_PUBLIC_BASE ? `${R2_PUBLIC_BASE}/${key}` : `${API}/storage/${bucket}/${key}`
      return { data: { publicUrl: url } }
    },

    async remove(names) {
      const list = Array.isArray(names) ? names : [names]
      const results = []
      for (const n of list) {
        const { error } = await apiFetch(`/storage/${bucket}/${encodeURIComponent(n)}`, { method: 'DELETE' })
        if (error) return { data: null, error }
        results.push({ name: n })
      }
      return { data: results, error: null }
    },

    async list(prefix = '') {
      const { data, error } = await apiFetch(`/storage/${bucket}?prefix=${encodeURIComponent(prefix)}`, { method: 'GET' })
      if (error) return { data: null, error }
      return { data: (data.keys || []).map(k => ({ name: k.key, size: k.size, updated_at: k.modified })), error: null }
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// .channel(...) — "who's online"
// ─────────────────────────────────────────────────────────────────────────────
// A thin presence channel over one WebSocket. Only the parts App.js uses are
// here: join, track, presence sync, and leaving.

function realtimeUrl() {
  const base = API.startsWith('http')
    ? API
    : `${window.location.origin}${API}`
  return base.replace(/^http/, 'ws').replace(/\/api$/, '') + '/realtime'
}

class PresenceChannel {
  constructor(name, config = {}) {
    this.name = name
    this.key = config?.config?.presence?.key || session?.user?.id || null
    this.state = 'closed'
    this._presence = {}
    this._handlers = []
    this._ws = null
    this._pending = null      // what to track once the socket is up
    this._closed = false
    this._retry = 0
  }

  on(type, filter, handler) {
    // Only presence sync is used, but keep the three-argument shape.
    this._handlers.push({ type, event: filter?.event, handler: handler || filter })
    return this
  }

  presenceState() { return this._presence }

  subscribe(onStatus) {
    this._onStatus = onStatus
    this._connect()
    return this
  }

  _emitSync() {
    this._handlers
      .filter(h => h.type === 'presence' && (!h.event || h.event === 'sync'))
      .forEach(h => { try { h.handler() } catch { /* a handler's problem */ } })
  }

  _connect() {
    if (this._closed || !session?.access_token) return

    let ws
    try {
      ws = new WebSocket(`${realtimeUrl()}?token=${encodeURIComponent(session.access_token)}`)
    } catch {
      return
    }
    this._ws = ws

    ws.onopen = () => {
      this._retry = 0
      ws.send(JSON.stringify({ type: 'join', channel: this.name, key: this.key }))
    }

    ws.onmessage = e => {
      let msg
      try { msg = JSON.parse(e.data) } catch { return }

      if (msg.type === 'joined') {
        this.state = 'joined'
        if (this._pending) ws.send(JSON.stringify({ type: 'track', channel: this.name, meta: this._pending }))
        if (this._onStatus) this._onStatus('SUBSCRIBED')
        return
      }
      if (msg.type === 'sync' && msg.channel === this.name) {
        this._presence = msg.state || {}
        this._emitSync()
      }
    }

    ws.onclose = () => {
      this.state = 'closed'
      this._presence = {}
      this._emitSync()
      if (this._closed) return
      // Wi-Fi drops and laptops sleep. Back off rather than hammering.
      const wait = Math.min(30_000, 1000 * 2 ** this._retry++)
      setTimeout(() => this._connect(), wait)
    }

    ws.onerror = () => { try { ws.close() } catch { /* already closing */ } }
  }

  track(meta) {
    this._pending = meta
    if (this._ws?.readyState === WebSocket.OPEN && this.state === 'joined') {
      this._ws.send(JSON.stringify({ type: 'track', channel: this.name, meta }))
    }
    return Promise.resolve('ok')
  }

  untrack() { return this.unsubscribe() }

  unsubscribe() {
    this._closed = true
    this.state = 'closed'
    try {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._ws.send(JSON.stringify({ type: 'leave', channel: this.name }))
      }
      this._ws?.close()
    } catch { /* already gone */ }
    this._ws = null
    return Promise.resolve('ok')
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Coming back from Google, and from a password-reset email
// ─────────────────────────────────────────────────────────────────────────────
// Google hands the tokens back in the URL fragment — never the query string, so
// they cannot end up in a server log or a Referer header. Pick them up, store
// them, and tidy the address bar.

let pendingResetToken = null

if (typeof window !== 'undefined') {
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  if (hash.get('access_token') && hash.get('refresh_token')) {
    setSession({
      access_token: hash.get('access_token'),
      refresh_token: hash.get('refresh_token'),
      expires_at: Number(hash.get('expires_at')) || Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: null,
    }, 'SIGNED_IN')
    window.history.replaceState({}, '', window.location.pathname + window.location.search)
  }

  const params = new URLSearchParams(window.location.search)
  if (params.get('reset_token')) {
    pendingResetToken = params.get('reset_token')
    params.delete('reset_token')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''))
  }
}

// A session restored from a Google redirect has no user on it yet; fill it in.
async function hydrateUser() {
  if (!session || session.user) return
  const { data } = await apiFetch('/auth/user', { method: 'GET' })
  if (data?.user) setSession({ ...session, user: data.user }, 'USER_UPDATED')
}
hydrateUser()

// ─────────────────────────────────────────────────────────────────────────────
// .auth
// ─────────────────────────────────────────────────────────────────────────────
const auth = {
  async signInWithPassword({ email, password }) {
    const { data, error } = await apiFetch('/auth/signin', { body: { email, password } })
    if (error) return { data: { user: null, session: null }, error }
    setSession(data.session, 'SIGNED_IN')
    return { data: { user: data.user, session: data.session }, error: null }
  },

  async signUp({ email, password, options = {} }) {
    const { data, error } = await apiFetch('/auth/signup', { body: { email, password, data: options.data || {} } })
    if (error) return { data: { user: null, session: null }, error }
    setSession(data.session, 'SIGNED_IN')
    return { data: { user: data.user, session: data.session }, error: null }
  },

  async signOut() {
    const token = session?.refresh_token
    setSession(null, 'SIGNED_OUT')
    if (token) await apiFetch('/auth/signout', { body: { refresh_token: token } })
    return { error: null }
  },

  async getSession() {
    if (session && expired()) await refreshSession()
    return { data: { session }, error: null }
  },

  async getUser() {
    if (!session) return { data: { user: null }, error: null }
    if (session.user) return { data: { user: session.user }, error: null }
    const { data, error } = await apiFetch('/auth/user', { method: 'GET' })
    if (data?.user) setSession({ ...session, user: data.user }, 'USER_UPDATED')
    return { data: { user: data?.user || null }, error }
  },

  onAuthStateChange(callback) {
    listeners.add(callback)
    // supabase-js announced the current state on subscribe; several pages rely
    // on that to stop showing a spinner, so keep doing it.
    Promise.resolve().then(() => callback(session ? 'SIGNED_IN' : 'SIGNED_OUT', session))
    return {
      data: {
        subscription: {
          unsubscribe() { listeners.delete(callback) },
        },
      },
    }
  },

  // Sends the "choose a new password" email. Always reports success, whether or
  // not that address has an account — otherwise this becomes a way to find out
  // who shops here.
  async resetPasswordForEmail(email, options = {}) {
    const { error } = await apiFetch('/auth/recover', { body: { email, redirectTo: options.redirectTo } })
    return { data: {}, error }
  },

  // Google. Leaves the page; the server bounces back with tokens in the
  // fragment, which the block above picks up.
  signInWithOAuth({ provider, options = {} }) {
    if (provider !== 'google') {
      return Promise.resolve({ data: null, error: { message: `${provider} sign-in is not set up` } })
    }
    const back = options.redirectTo || window.location.origin
    window.location.href = `${API}/auth/google?redirect_to=${encodeURIComponent(back)}`
    return Promise.resolve({ data: { provider, url: null }, error: null })
  },

  // Setting a new password: after following a reset link (the token is picked
  // up from the URL above), or while signed in.
  async updateUser({ password, currentPassword } = {}) {
    if (!password) return { data: { user: null }, error: { message: 'A new password is required' } }

    const path = pendingResetToken ? '/auth/reset' : '/auth/password'
    const body = pendingResetToken
      ? { token: pendingResetToken, password }
      : { current_password: currentPassword, password }

    const { data, error } = await apiFetch(path, { body })
    if (error) return { data: { user: null }, error }

    pendingResetToken = null
    setSession(data.session, 'USER_UPDATED')
    return { data: { user: data.user }, error: null }
  },

  // True when the page was opened from a reset link, so the shop knows to show
  // the "choose a new password" form.
  hasRecoveryToken() { return Boolean(pendingResetToken) },
}

// ─────────────────────────────────────────────────────────────────────────────
export const supabase = {
  from: table => new QueryBuilder(table),

  rpc: (name, args = {}) => apiFetch(`/rpc/${name}`, { body: args }),

  auth,

  storage: { from: storageBucket },

  functions: {
    // `error` means the call never landed — not reachable, or refused. A
    // function that ran and failed reports it inside `data` ({ error, detail }),
    // exactly as the Edge Functions did, and callers already read it there.
    invoke: (name, { body } = {}) =>
      apiFetch(`/functions/${name}`, { body: body || {}, passthrough: true }),
  },

  channel: (name, config) => new PresenceChannel(name, config),
  removeChannel: channel => channel?.unsubscribe?.(),
  getChannels: () => [],
}

export default supabase
