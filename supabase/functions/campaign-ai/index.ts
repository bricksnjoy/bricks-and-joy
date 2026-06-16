// Supabase Edge Function: campaign-ai
// Generates a TOY-shop sales campaign plan with AI, returning JSON in the shape
// the Planning tab expects. Supports two providers via the `provider` body field:
//   - "claude" (default): Anthropic Claude WITH live web search (paid per use)
//   - "gemini": Google Gemini Flash (has a free tier; model-knowledge only)
//
// Deploy:
//   supabase functions deploy campaign-ai --no-verify-jwt
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...        # for Claude mode
//   supabase secrets set GEMINI_API_KEY=AIza...              # for free Gemini mode
//   (optional: CAMPAIGN_AI_MODEL=claude-sonnet-4-6  GEMINI_MODEL=gemini-2.0-flash)
//
// The frontend calls it via supabase.functions.invoke('campaign-ai', { body: {...} }).
// If the chosen provider isn't configured, the app falls back to the built-in generator.

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const CLAUDE_MODEL = Deno.env.get('CAMPAIGN_AI_MODEL') ?? 'claude-sonnet-4-6'
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.0-flash'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

function extractJSON(text: string) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('no json')
  return JSON.parse(text.slice(start, end + 1))
}

function buildPrompts(name: string, dateISO: string, leadDays: number, catalog: any[]) {
  const catalogList = (catalog || [])
    .slice(0, 150)
    .map((p: any) => `- ${p.name}${p.category ? ` [${p.category}]` : ''}${p.inInventory ? ' (in inventory)' : ' (catalog only)'}`)
    .join('\n')

  const system = `You are a senior retail marketing strategist for "Brick's & Joy", a toys and building-blocks shop in the Maldives (currency: MVR). You design seasonal sales campaigns.
Rules:
- Everything must relate to TOYS, building blocks, games, plush, and kids' gifts.
- Recommend CURRENT, trending toys and SPECIFIC real products for this occasion.
- Be concrete and practical for a small shop. Keep each item short.
- Recommend pushing relevant products from the shop's existing list when they fit.`

  const user = `Occasion: ${name}
Date: ${dateISO}
Prep lead time: ${leadDays} days before the date.

The shop's current catalog/inventory:
${catalogList || '(catalog is empty)'}

Respond with ONLY a JSON object (no markdown, no prose) with exactly these keys:
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
  return { system, user }
}

async function runClaude(p: { system: string; user: string }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 2500,
      system: p.system,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: p.user }],
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
  return extractJSON(text)
}

async function runGemini(p: { system: string; user: string }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: p.system }] },
      contents: [{ role: 'user', parts: [{ text: p.user }] }],
      generationConfig: { temperature: 0.8, responseMimeType: 'application/json', maxOutputTokens: 2500 },
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  const text = (data.candidates?.[0]?.content?.parts || []).map((b: any) => b.text || '').join('\n')
  return extractJSON(text)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const { name, dateISO, leadDays = 90, catalog = [], provider = 'claude' } = await req.json()
    const prompts = buildPrompts(name, dateISO, leadDays, catalog)

    if (provider === 'gemini') {
      if (!GEMINI_API_KEY) return json({ error: 'no_api_key', provider }, 400)
      return json(await runGemini(prompts))
    }
    if (!ANTHROPIC_API_KEY) return json({ error: 'no_api_key', provider: 'claude' }, 400)
    return json(await runClaude(prompts))
  } catch (e) {
    return json({ error: 'failed', detail: String(e) }, 500)
  }
})
