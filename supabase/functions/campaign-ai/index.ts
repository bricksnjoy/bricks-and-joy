// Supabase Edge Function: campaign-ai
// Generates a TOY-shop sales campaign plan with Claude, using live web search to
// follow current toy trends and recommend specific products available online.
// Returns JSON in the shape the Planning tab expects.
//
// Deploy:
//   supabase functions deploy campaign-ai --no-verify-jwt
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   (optional: CAMPAIGN_AI_MODEL=claude-sonnet-4-6)
//
// The frontend calls it via supabase.functions.invoke('campaign-ai', { body: {...} }).
// If it isn't deployed / no key, the app silently falls back to the built-in generator.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const MODEL = Deno.env.get('CAMPAIGN_AI_MODEL') ?? 'claude-sonnet-4-6'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function extractJSON(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('no json')
  return JSON.parse(text.slice(start, end + 1))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    if (!ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'no_api_key' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })

    const { name, dateISO, leadDays = 90, catalog = [] } = await req.json()
    const catalogList = (catalog || [])
      .slice(0, 150)
      .map((p: any) => `- ${p.name}${p.category ? ` [${p.category}]` : ''}${p.inInventory ? ' (in inventory)' : ' (catalog only)'}`)
      .join('\n')

    const system = `You are a senior retail marketing strategist for "Brick's & Joy", a toys and building-blocks shop in the Maldives (currency: MVR). You design seasonal sales campaigns.
Rules:
- Everything must relate to TOYS, building blocks, games, plush, and kids' gifts.
- Use web search to find CURRENT, ongoing toy trends and SPECIFIC real products available online for this occasion.
- Be concrete and practical for a small shop. Keep each item short.
- Recommend pushing relevant products from the shop's existing list when they fit.`

    const user = `Occasion: ${name}
Date: ${dateISO}
Prep lead time: ${leadDays} days before the date.

The shop's current catalog/inventory:
${catalogList || '(catalog is empty)'}

Search the web for what's trending for ${name} in toys this year, then respond with ONLY a JSON object (no markdown, no prose) with exactly these keys:
{
  "summary": "2-3 sentence overview of the opportunity for a toy shop",
  "trending": ["short bullets on CURRENT trending toys/themes for this occasion, with the trend reason"],
  "stockUpExisting": ["exact product names copied from the shop's list above that fit this occasion"],
  "newProducts": [{"name":"specific toy product to bring in","why":"why it sells for this occasion","where":"where to source it online (brand/retailer/marketplace)"}],
  "packages": ["gift bundle / package ideas combining toys"],
  "marketing": ["marketing & social post ideas to attract customers"],
  "howToRun": ["phase-by-phase plan for how to run the campaign over the lead time"],
  "checklist": [{"text":"task","offsetDays":60}]
}
Aim for 4-6 items per array. offsetDays = days before the date the task should be done.`

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        system,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        messages: [{ role: 'user', content: user }],
      }),
    })

    if (!res.ok) {
      const t = await res.text()
      return new Response(JSON.stringify({ error: 'anthropic_error', detail: t }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } })
    }

    const data = await res.json()
    const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
    const plan = extractJSON(text)
    return new Response(JSON.stringify(plan), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'failed', detail: String(e) }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
