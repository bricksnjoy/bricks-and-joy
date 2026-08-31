// Generates a seasonal campaign plan with AI, in the shape the Planning tab
// expects. Ported from the campaign-ai Edge Function, both providers intact:
//
//   claude  (default) — Anthropic, with live web search, so the trending-toy
//                       suggestions are actually current. Paid per use.
//   gemini            — Google Gemini Flash. Has a free tier, but answers from
//                       model knowledge only.
//
// When the chosen provider has no key configured this returns { error:
// 'no_api_key' } and the app falls back to its own built-in generator, exactly
// as before.

const CLAUDE_MODEL = () => process.env.CAMPAIGN_AI_MODEL || 'claude-sonnet-4-6'
const GEMINI_MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.0-flash'

function extractJSON(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('no json')
  return JSON.parse(text.slice(start, end + 1))
}

function buildPrompts(name, dateISO, leadDays, catalog) {
  const catalogList = (catalog || [])
    .slice(0, 150)
    .map(p => `- ${p.name}${p.category ? ` [${p.category}]` : ''}${p.inInventory ? ' (in inventory)' : ' (catalog only)'}`)
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

async function runClaude(p) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL(),
      max_tokens: 2500,
      system: p.system,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: p.user }],
    }),
  })
  if (!res.ok) throw new Error(await res.text())
  const data = await res.json()
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n')
  return extractJSON(text)
}

async function runGemini(p) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL()}:generateContent?key=${process.env.GEMINI_API_KEY}`
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
  const text = (data.candidates?.[0]?.content?.parts || []).map(b => b.text || '').join('\n')
  return extractJSON(text)
}

async function generateCampaignPlan(body = {}) {
  const { name, dateISO, leadDays = 90, catalog = [], provider = 'claude' } = body
  const prompts = buildPrompts(name, dateISO, leadDays, catalog)
  try {
    if (provider === 'gemini') {
      if (!process.env.GEMINI_API_KEY) return { error: 'no_api_key', provider }
      return await runGemini(prompts)
    }
    if (!process.env.ANTHROPIC_API_KEY) return { error: 'no_api_key', provider: 'claude' }
    return await runClaude(prompts)
  } catch (e) {
    return { error: 'failed', detail: String(e).slice(0, 300) }
  }
}

module.exports = { generateCampaignPlan }
