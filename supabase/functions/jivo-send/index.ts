// Supabase Edge Function — JivoChat outbound reply (Bot API).
// Called by the app's Live Chat reply box. Sends a BOT_MESSAGE to JivoChat,
// which delivers it to the Instagram / Facebook user, then records the
// outgoing message in chat_messages and clears the thread's unread count.
//
// Deploy:  supabase functions deploy jivo-send
// Secrets: supabase secrets set JIVO_PROVIDER_ID=your_provider_id
//          supabase secrets set JIVO_TOKEN=your_shared_token
//
// Request body (from the app): { "thread_id": "2037", "text": "Hello!" }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function uuid() {
  return crypto.randomUUID()
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { thread_id, text } = await req.json().catch(() => ({}))
    if (!thread_id || !text) {
      return new Response(JSON.stringify({ error: 'thread_id and text required' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: thread } = await sb.from('chat_threads').select('*').eq('id', thread_id).maybeSingle()
    if (!thread) {
      return new Response(JSON.stringify({ error: 'thread not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const providerId = Deno.env.get('JIVO_PROVIDER_ID') || ''
    const token = Deno.env.get('JIVO_TOKEN') || ''
    if (!providerId || !token) {
      return new Response(JSON.stringify({ error: 'JIVO_PROVIDER_ID / JIVO_TOKEN not set' }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    // Bot → JivoChat outbound endpoint
    const endpoint = `https://bot.jivosite.com/webhooks/${providerId}/${token}`
    const payload = {
      event: 'BOT_MESSAGE',
      id: uuid(),
      client_id: thread.client_id,
      chat_id: thread.id,
      message: { type: 'TEXT', text },
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const ok = res.ok
    const respText = await res.text().catch(() => '')

    if (ok) {
      await sb.from('chat_messages').insert({
        thread_id: thread.id,
        direction: 'out',
        sender_name: 'You',
        body: text,
        msg_type: 'TEXT',
      })
      await sb.from('chat_threads').update({
        last_message: text,
        last_at: new Date().toISOString(),
        unread: 0,
      }).eq('id', thread.id)
    }

    return new Response(JSON.stringify({ ok, jivo_status: res.status, jivo_response: respText }), {
      status: ok ? 200 : 502,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
