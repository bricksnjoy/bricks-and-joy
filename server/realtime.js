// "Who's online", over a plain WebSocket.
//
// This is the one piece of Supabase Realtime the app actually used: a shared
// presence channel that every open back-office session joins, so the header can
// show who else is in and which page they are on. Nothing subscribes to table
// changes, so none of that is here.
//
// The wire protocol is small enough to describe in full:
//
//   client -> { type: 'join',  channel, key }      join, identified by key
//   client -> { type: 'track', channel, meta }     "here is what I'm doing"
//   client -> { type: 'leave', channel }
//   client -> { type: 'ping' }
//   server -> { type: 'joined', channel }
//   server -> { type: 'sync',   channel, state }   the whole channel, every time
//
// `state` is shaped the way supabase-js shaped it — { key: [meta] } — so the
// header component reads it unchanged.

const { WebSocketServer } = require('ws')
const jwt = require('jsonwebtoken')

// channel name -> Map(presence key -> { meta, sockets:Set })
const channels = new Map()

const stateOf = channel => {
  const members = channels.get(channel)
  if (!members) return {}
  const out = {}
  for (const [key, entry] of members) out[key] = [entry.meta]
  return out
}

function broadcast(channel) {
  const members = channels.get(channel)
  if (!members) return
  const payload = JSON.stringify({ type: 'sync', channel, state: stateOf(channel) })
  const seen = new Set()
  for (const entry of members.values()) {
    for (const ws of entry.sockets) {
      if (seen.has(ws) || ws.readyState !== ws.OPEN) continue
      seen.add(ws)
      try { ws.send(payload) } catch { /* closing */ }
    }
  }
}

function leaveAll(ws) {
  for (const [name, members] of channels) {
    for (const [key, entry] of members) {
      if (!entry.sockets.delete(ws)) continue
      // Someone can have the back office open in two tabs; they only drop off
      // the list when the last one goes.
      if (!entry.sockets.size) members.delete(key)
      broadcast(name)
    }
    if (!members.size) channels.delete(name)
  }
}

function attach(server, { path = '/realtime' } = {}) {
  const wss = new WebSocketServer({
    server, path, maxPayload: 16 * 1024,

    // Presence shows names, emails and which page a colleague is on, so a token
    // is required to listen — this is not public information. Checking it here
    // rather than after connecting means an unauthenticated caller is turned
    // away at the handshake with a 401 and never becomes a socket at all.
    verifyClient(info, done) {
      const token = new URL(info.req.url, 'http://x').searchParams.get('token')
      try {
        info.req.claims = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'bricksandjoy' })
        done(true)
      } catch {
        done(false, 401, 'Unauthorized')
      }
    },
  })

  wss.on('connection', (ws, req) => {
    const claims = req.claims

    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })

    ws.on('message', raw => {
      let msg
      try { msg = JSON.parse(raw) } catch { return }
      const channel = String(msg.channel || '')
      if (!channel && msg.type !== 'ping') return

      if (msg.type === 'ping') { ws.send(JSON.stringify({ type: 'pong' })); return }

      if (msg.type === 'join') {
        // A client may only announce itself as the user its token says it is.
        const key = String(msg.key || claims.sub)
        if (key !== claims.sub) { ws.close(4403, 'forbidden'); return }

        if (!channels.has(channel)) channels.set(channel, new Map())
        const members = channels.get(channel)
        const entry = members.get(key) || { meta: {}, sockets: new Set() }
        entry.sockets.add(ws)
        members.set(key, entry)

        ws.send(JSON.stringify({ type: 'joined', channel }))
        broadcast(channel)
        return
      }

      if (msg.type === 'track') {
        const members = channels.get(channel)
        const entry = members && members.get(claims.sub)
        if (!entry) return
        // Trust the token for identity, the message only for what they're doing.
        entry.meta = { ...(msg.meta || {}), email: claims.email, id: claims.sub }
        broadcast(channel)
        return
      }

      if (msg.type === 'leave') {
        const members = channels.get(channel)
        const entry = members && members.get(claims.sub)
        if (!entry) return
        entry.sockets.delete(ws)
        if (!entry.sockets.size) members.delete(claims.sub)
        if (!members.size) channels.delete(channel)
        broadcast(channel)
      }
    })

    ws.on('close', () => leaveAll(ws))
    ws.on('error', () => leaveAll(ws))
  })

  // A laptop lid closing does not send a close frame, so without this the
  // header would keep showing people who left hours ago.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) { leaveAll(ws); ws.terminate(); continue }
      ws.isAlive = false
      try { ws.ping() } catch { /* already gone */ }
    }
  }, 30_000)

  wss.on('close', () => clearInterval(heartbeat))
  console.log(`[realtime] presence listening on ${path}`)
  return wss
}

module.exports = { attach }
