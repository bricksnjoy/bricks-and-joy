// Supabase Edge Function — JivoChat inbound webhook (Bot API).
// JivoChat POSTs every incoming Instagram / Facebook DM here as a CLIENT_MESSAGE.
// We store the message in chat_threads / chat_messages so it shows up in the
// in-app Live Chat inbox. Human replies go back out via the `jivo-send` function.
//
// Deploy:  supabase functions deploy jivo-inbound --no-verify-jwt
//          (JivoChat can't send a Supabase JWT — we authenticate with the token
//           JivoChat appends to the URL instead.)
// Secrets: supabase secrets set JIVO_TOKEN=your_shared_token
//
// In JivoChat → Channels → Bot, set the webhook URL to:
//   https://YOUR_PROJECT_REF.supabase.co/functions/v1/jivo-inbound
// JivoChat will append /<token> automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// JivoChat sends the source channel in a few possible shapes — normalize it.
function channelOf(body: any): string {
  const raw = (
    body?.chat?.channel || body?.message?.channel || body?.channel ||
    body?.chat?.type || body?.type || ''
  ).toString().toLowerCase()
  if (raw.includes('insta')) return 'instagram'
  if (raw.includes('face') || raw.includes('messenger') || raw.includes('fb')) return 'facebook'
  if (raw.includes('telegram')) return 'telegram'
  if (raw.includes('whats')) return 'whatsapp'
  return raw || 'jivochat'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    // Token is the last path segment JivoChat appends to the configured URL.
    const url = new URL(req.url)
    const pathToken = url.pathname.split('/').filter(Boolean).pop() || ''
    const expected = Deno.env.get('JIVO_TOKEN') || ''
    if (expected && pathToken !== expected) {
      return new Response(JSON.stringify({ error: 'bad token' }), { status: 401, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const body = await req.json().catch(() => ({}))
    const event = (body.event || body.type || 'CLIENT_MESSAGE').toString().toUpperCase()

    // We only persist client (incoming) messages. Everything else is acknowledged.
    const isClientMsg = event === 'CLIENT_MESSAGE' || (!body.event && body.message && body.sender)
    if (!isClientMsg) {
      return new Response('{}', { headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const chatId = String(body.chat_id ?? body.chatId ?? body.chat?.id ?? '')
    const clientId = String(body.client_id ?? body.clientId ?? body.sender?.id ?? '')
    if (!chatId) return new Response('{}', { headers: { ...cors, 'Content-Type': 'application/json' } })

    const senderName = body.sender?.name || body.client?.name || 'Customer'
    const avatar = body.sender?.avatar || body.sender?.photo || null
    const text = body.message?.text || body.message?.title || ''
    const msgType = (body.message?.type || 'TEXT').toString().toUpperCase()
    const channel = channelOf(body)

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // Upsert the thread, bump unread + last message.
    const { data: existing } = await sb.from('chat_threads').select('unread').eq('id', chatId).maybeSingle()
    await sb.from('chat_threads').upsert({
      id: chatId,
      client_id: clientId,
      client_name: senderName,
      channel,
      avatar_url: avatar,
      last_message: text || `[${msgType.toLowerCase()}]`,
      last_at: new Date().toISOString(),
      unread: (existing?.unread || 0) + 1,
    }, { onConflict: 'id' })

    await sb.from('chat_messages').insert({
      thread_id: chatId,
      direction: 'in',
      sender_name: senderName,
      body: text,
      msg_type: msgType,
    })

    // Empty object = "no automatic bot reply"; a human will respond from the app.
    return new Response('{}', { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
