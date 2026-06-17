// ── Campaign "brain" ────────────────────────────────────────────────────────
// A built-in generator that turns an occasion (name + date) into a full toy-shop
// sales campaign plan, tailored to the shop's real catalog & inventory, with
// clickable links to find real products online. Same return shape as the
// Claude/Gemini generator so they're interchangeable.

const enc = encodeURIComponent
// Product-finder links (no API needed — these open real search results)
export const shopSearch = {
  lego: q => `https://www.lego.com/en-us/search?q=${enc(q)}`,
  amazon: q => `https://www.amazon.com/s?k=${enc(q)}`,
  google: q => `https://www.google.com/search?tbm=shop&q=${enc(q)}`,
}

// Knowledge base of common occasions. `aliases` drive detection from the name;
// `keywords` match the shop's own products; `newProducts` are toy/LEGO-specific
// ideas to bring in (each with a reason).
export const OCCASION_LIBRARY = [
  {
    id: 'valentines', name: "Valentine's Day", emoji: '🌹', md: '02-14',
    aliases: ['valentine', 'valentines', "valentine's", 'love day'],
    keywords: ['flower', 'rose', 'bouquet', 'heart', 'love', 'plush', 'teddy', 'chocolate', 'couple', 'romance', 'gift'],
    audience: 'Couples & partners (18–40) and anyone buying a romantic gift',
    newProducts: [
      { name: 'LEGO Botanical rose bouquet & flower sets', why: 'Romantic and lasts forever — a top Valentine\'s seller' },
      { name: 'LEGO heart / "love" gift boxes', why: 'Ready-made, giftable, easy impulse buy' },
      { name: 'Teddy bears & plush', why: 'The classic partner gift' },
      { name: 'Couples board / date-night games', why: 'Experience gift that bundles well' },
      { name: 'Chocolate + small-toy gift boxes', why: 'Low-cost add-on at the till' },
    ],
    packages: ['"Sweetheart" LEGO bouquet + plush bundle', 'Couple gift box: flowers + chocolate + card', 'Build-a-rose set + handwritten card'],
    marketing: ['Post a "Valentine\'s Gift Guide" reel ~3 weeks out', 'Free gift wrapping over a spend amount', 'Couples giveaway with a local cafe', 'Daily countdown stories in the final week'],
  },
  {
    id: 'mothers', name: "Mother's Day", emoji: '💐', md: '05-11',
    aliases: ['mother', 'mothers', "mother's", 'mum', 'mom'],
    keywords: ['flower', 'bouquet', 'rose', 'plush', 'jewel', 'gift', 'spa', 'candle', 'mug', 'orchid', 'succulent'],
    audience: 'Kids, teens and dads buying for mums; whole families',
    newProducts: [
      { name: 'LEGO Botanical Collection (flowers, bonsai, orchid)', why: 'Flowers that never wilt — the standout Mother\'s Day pick' },
      { name: 'LEGO Succulents / plant sets', why: 'Desk-friendly, affordable gift' },
      { name: 'Craft & jewellery-making kits', why: 'Thoughtful, hands-on gift' },
      { name: 'Candle / spa gift sets', why: 'Easy pamper bundle' },
    ],
    packages: ['"Best Mum" hamper: LEGO flowers + candle + card', 'Pamper box bundle', 'Flowers + chocolates combo'],
    marketing: ['Share "thank you mum" customer stories', 'Last-minute gift guide reel', 'Free-delivery weekend', 'Gift-wrapping upsell'],
  },
  {
    id: 'fathers', name: "Father's Day", emoji: '👔', md: '06-15',
    aliases: ['father', 'fathers', "father's", 'dad'],
    keywords: ['car', 'model', 'technic', 'tool', 'watch', 'gadget', 'sport', 'gift', 'kit', 'motorbike'],
    audience: 'Kids and partners buying for dads; hobbyist men',
    newProducts: [
      { name: 'LEGO Technic cars & motorbikes', why: 'Dads love buildable, displayable vehicles' },
      { name: 'LEGO Icons (classic cars, etc.)', why: 'Premium "adult" gift sets' },
      { name: 'Model kits & desk gadgets', why: 'Hobby gift with good margin' },
      { name: 'Sports fan merchandise', why: 'Personal-interest gift' },
    ],
    packages: ['"For Dad" Technic set + card', 'Gadget gift box', 'Sports fan bundle'],
    marketing: ['"Gifts Dad actually wants" post', 'Top-picks reels', 'Bundle discount weekend', 'Email past customers a gift guide'],
  },
  {
    id: 'eid', name: 'Eid', emoji: '🌙', md: '03-30',
    aliases: ['eid', 'ramadan', 'fitr', 'adha'],
    keywords: ['gift', 'sweet', 'dates', 'decor', 'lantern', 'family', 'set', 'kids', 'board'],
    audience: 'Families with kids; people buying Eidi (gift) presents',
    newProducts: [
      { name: 'Mid-size LEGO gift sets', why: 'A favourite Eidi gift for kids' },
      { name: 'Kids gift hampers (toys + sweets)', why: 'Ready-to-give, higher basket value' },
      { name: 'Family board games', why: 'Perfect for Eid gatherings' },
      { name: 'Festive decorations', why: 'Home décor demand spikes before Eid' },
    ],
    packages: ['Eid kids gift bundle', 'Family game-night box', 'Festive decoration pack'],
    marketing: ['"Eid Mubarak" gift guide', 'Eidi envelope giveaway', 'Family bundle promo', 'Festive decor reels'],
  },
  {
    id: 'christmas', name: 'Christmas', emoji: '🎄', md: '12-25',
    aliases: ['christmas', 'xmas', 'noel', 'santa'],
    keywords: ['gift', 'toy', 'set', 'plush', 'lego', 'build', 'game', 'ornament', 'advent', 'santa', 'tree', 'winter'],
    audience: 'Parents, grandparents and gift-buyers of every age',
    newProducts: [
      { name: 'LEGO Advent Calendars', why: '#1 seasonal seller — order early, they sell out' },
      { name: 'LEGO Winter Village / Icons sets', why: 'Festive display piece + premium gift' },
      { name: 'Big-build "hero" gift sets', why: 'The main present under the tree' },
      { name: 'Stocking-filler small toys', why: 'High-volume impulse add-ons' },
      { name: 'Family board games', why: 'Holiday gatherings' },
    ],
    packages: ['Stocking-filler bundle', '"Big gift" premium set + wrap', 'Family game-night box'],
    marketing: ['Launch a "Christmas Gift Guide" by early November', '12 days of deals countdown', 'Free wrapping + gift cards', 'Last-shipping-date reminders'],
  },
  {
    id: 'newyear', name: 'New Year', emoji: '🎆', md: '01-01',
    aliases: ['new year', 'newyear', 'nye'],
    keywords: ['party', 'game', 'gift', 'decor', 'set', 'celebration'],
    audience: 'Families and party hosts',
    newProducts: [
      { name: 'Family & party board games', why: 'NYE gatherings' },
      { name: 'Large building sets ("new year project")', why: 'Resolution / hobby angle' },
      { name: 'Clearance bundles', why: 'Move end-of-year stock fast' },
    ],
    packages: ['Party-night bundle', 'Family game pack', 'New Year gift box'],
    marketing: ['"New Year, new fun" sale', 'End-of-year clearance', 'Party essentials reel', 'Resolution-themed gift ideas'],
  },
  {
    id: 'backtoschool', name: 'Back to School', emoji: '🎒', md: '08-01',
    aliases: ['back to school', 'school', 'term'],
    keywords: ['educational', 'learn', 'stem', 'puzzle', 'book', 'stationery', 'building', 'kids'],
    audience: 'Parents of school-age kids; teachers',
    newProducts: [
      { name: 'LEGO Education / STEM sets', why: 'Learning through play — a parent favourite' },
      { name: 'Puzzles & brain games', why: 'Screen-free learning' },
      { name: 'Stationery + small-toy bundles', why: 'Easy back-to-school add-ons' },
    ],
    packages: ['"Smart start" learning bundle', 'STEM kit + puzzle combo', 'Stationery starter pack'],
    marketing: ['"Back to school" essentials guide', 'Parent-targeted bundle deals', 'Learning-through-play reels', 'Bulk/classroom discount'],
  },
  {
    id: 'halloween', name: 'Halloween', emoji: '🎃', md: '10-31',
    aliases: ['halloween', 'spooky'],
    keywords: ['costume', 'spooky', 'scary', 'pumpkin', 'mask', 'decor', 'candy', 'glow'],
    audience: 'Parents of kids; party-goers',
    newProducts: [
      { name: 'Costumes & masks', why: 'Core Halloween purchase' },
      { name: 'LEGO Halloween / BrickHeadz seasonal sets', why: 'Themed collectible' },
      { name: 'Glow-in-the-dark & spooky toys', why: 'Party + trick-or-treat' },
    ],
    packages: ['Costume + accessory bundle', 'Spooky decor pack', 'Trick-or-treat goodie box'],
    marketing: ['Costume lookbook reels', 'Spooky in-store display photos', 'Countdown to Halloween posts', 'Best-costume customer contest'],
  },
]

export function detectOccasion(name = '') {
  const n = name.toLowerCase().trim()
  return OCCASION_LIBRARY.find(o =>
    o.aliases.some(a => n.includes(a)) || n.includes(o.id) || n.includes(o.name.toLowerCase())
  ) || null
}

// ── date helpers (yearly recurring aware) ────────────────────────────────────
export function nextOccurrence(dateISO, fromDate = new Date()) {
  if (!dateISO) return null
  const base = new Date(dateISO + (dateISO.length <= 10 ? 'T00:00:00' : ''))
  if (isNaN(base)) return null
  const today = new Date(fromDate); today.setHours(0, 0, 0, 0)
  let d = new Date(today.getFullYear(), base.getMonth(), base.getDate())
  if (d < today) d = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate())
  return d
}
export function daysBetween(a, b) {
  const ms = new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)
  return Math.round(ms / 86400000)
}
export function addDays(date, days) { const d = new Date(date); d.setDate(d.getDate() + days); return d }
export function toISODate(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}
export function campaignStatus(dateISO, leadDays = 90, fromDate = new Date()) {
  const occ = nextOccurrence(dateISO, fromDate)
  if (!occ) return { key: 'none', label: 'No date', occ: null, daysUntil: null, prepDate: null }
  const today = new Date(fromDate); today.setHours(0, 0, 0, 0)
  const prep = addDays(occ, -leadDays)
  const dU = daysBetween(today, occ)
  if (dU <= 2) return { key: 'active', label: 'Happening now', occ, daysUntil: dU, prepDate: prep }
  if (today >= prep) return { key: 'prep', label: 'Prep time — start now', occ, daysUntil: dU, prepDate: prep }
  return { key: 'scheduled', label: 'Scheduled', occ, daysUntil: dU, prepDate: prep }
}

// ── the generator ────────────────────────────────────────────────────────────
const CHECKLIST_TEMPLATE = [
  { off: 90, text: "Review last year's {name} sales and set this year's target" },
  { off: 85, text: 'Order extra stock of the key {name} products from suppliers' },
  { off: 60, text: 'Design {name} gift packages / bundles & set pricing' },
  { off: 45, text: 'Plan discounts and prepare price tags / labels' },
  { off: 30, text: 'Create the social media content calendar for {name}' },
  { off: 21, text: 'Launch teaser posts and email subscribers' },
  { off: 14, text: 'Set up the in-store / website {name} display' },
  { off: 7, text: 'Send a reminder email/SMS to customers' },
  { off: 3, text: 'Final stock check — restock fast movers' },
  { off: 1, text: 'Schedule {name}-day posts & stories' },
]
const slug = s => (s || '').toLowerCase()

export function generateCampaignPlan({ name, dateISO, leadDays = 90 }, catalog = [], inventoryNames = new Set()) {
  const preset = detectOccasion(name)
  const theme = preset || {
    name, emoji: '🧸', keywords: [],
    audience: 'Parents and gift-buyers; kids browsing with parents',
    newProducts: [
      { name: 'Seasonal best-sellers', why: 'Proven sellers carry the campaign' },
      { name: 'New LEGO / building-set arrivals', why: 'Fresh stock drives repeat visits' },
      { name: 'Gift-ready bundles', why: 'Higher basket value' },
    ],
    packages: ['Themed gift bundle', 'Best-sellers value pack'],
    marketing: ['Announce 3–4 weeks ahead', 'Run a themed giveaway', 'Daily countdown stories', 'Email past customers a special offer'],
  }
  const kw = theme.keywords || []

  // Products you already carry that fit the theme
  const matched = kw.length
    ? catalog.filter(p => {
        const hay = `${p.product_name || ''} ${p.category || ''} ${p.tags || ''} ${p.description || ''}`.toLowerCase()
        return kw.some(k => hay.includes(k))
      })
    : []
  const seen = new Set()
  const stockUpExisting = []
  matched.forEach(p => {
    const key = slug(p.product_name)
    if (seen.has(key)) return
    seen.add(key)
    stockUpExisting.push({ name: p.product_name, supplier: p.supplier_name || '', cost: p.cost_price || null, inInventory: inventoryNames.has(key.trim()) })
  })

  const occ = nextOccurrence(dateISO) || new Date()
  const yr = occ.getFullYear()
  const checklist = CHECKLIST_TEMPLATE
    .filter(t => t.off <= Math.max(leadDays, 1) + 5)
    .map((t, i) => ({ id: `c${i}`, text: t.text.replace(/\{name\}/g, name), due: toISODate(addDays(occ, -t.off)), done: false }))

  // New products to bring in — each with a "find it" link
  const newProducts = (theme.newProducts || []).map(p => {
    const it = typeof p === 'string' ? { name: p } : p
    const lego = /lego|technic|botanical|brickheadz|building|build/i.test(it.name)
    return { ...it, where: (lego ? shopSearch.lego(it.name.replace(/lego/i, '').trim() || it.name) : shopSearch.google(`${it.name} ${name}`)) }
  })

  // Where to find products (clickable searches)
  const shopLinks = [
    { label: `LEGO.com — ${name} & themed sets`, url: shopSearch.lego(name) },
    ...kw.slice(0, 2).map(k => ({ label: `LEGO.com — ${k} sets`, url: shopSearch.lego(k) })),
    { label: `Amazon — ${name} toys`, url: shopSearch.amazon(`${name} toys`) },
    { label: `Google Shopping — trending ${name} toys ${yr}`, url: shopSearch.google(`trending ${name} toys ${yr}`) },
  ]

  const pricing = [
    'Bundle 2–3 items as a "gift set" priced ~10–15% below buying them separately.',
    'Prefer a free add-on (gift wrap / card) over a spend threshold instead of deep discounts — protects margin.',
    `Tiered deal: e.g. spend MVR 500 get 10% off, MVR 1000 get 15% off.`,
    'Early-bird price in week 1, then standard price as the date nears.',
  ]
  const display = [
    `Front-of-store ${name} table with hero products at eye level and clear price tags.`,
    `Themed window/shelf with a "Gifts under MVR ___" basket for impulse buys.`,
    `Place a QR code by the display linking to your online catalog.`,
  ]
  const kpis = [
    `Units sold of your ${name} hero products vs last year`,
    'Revenue from bundles / gift sets',
    'New / first-time customers during the campaign',
    'Social reach, saves & shares on campaign posts',
    'Enquiries (DM/email) converted to sales',
  ]
  const trending = [
    `Check TikTok & Instagram Reels for viral ${name} toy ideas trending right now`,
    `See what LEGO, Mattel & Hot Wheels are pushing for ${name} and ride the wave`,
    `Building sets tied to current movies/shows tend to spike this season`,
    `"Blind box" surprise toys and sensory/fidget toys keep selling fast`,
  ]
  const howToRun = [
    `Phase 1 (≈${leadDays}–45 days out): Lock in stock — order your hero ${name} toys from suppliers.`,
    `Phase 2 (45–21 days out): Build bundles, set pricing/discounts, shoot product photos & reels.`,
    `Phase 3 (21–7 days out): Tease on social, email subscribers, start light promos.`,
    `Phase 4 (final week): Go all-in — daily posts/stories, countdown deals, eye-catching display.`,
    `Phase 5 (the day): Flash deals on best-sellers, free gift wrap, capture customer photos for next year.`,
  ]

  const matchCount = stockUpExisting.length
  const summary = preset
    ? `${name} is a high-opportunity occasion for a toy shop. Shoppers look for ${kw.slice(0, 4).join(', ')}. ` +
      (matchCount ? `You already carry ${matchCount} matching toy${matchCount === 1 ? '' : 's'} — keep ${matchCount === 1 ? 'it' : 'them'} well stocked and front-and-centre. ` : `You don't carry obvious ${name} toys yet — bringing some in could open a new revenue stream. `) +
      `Start prep ~${leadDays} days ahead so stock arrives in time.`
    : `Plan for ${name}: feature your best-selling toys, build a themed gift bundle, and start promoting ~${leadDays} days ahead so everything is ready on the day.`

  return {
    themeName: preset ? preset.name : name,
    emoji: theme.emoji,
    summary,
    audience: theme.audience || 'Parents and gift-buyers',
    trending,
    stockUpExisting,
    newProducts,
    shopLinks,
    packages: theme.packages || [],
    pricing,
    marketing: theme.marketing || [],
    display,
    kpis,
    howToRun,
    checklist,
    generatedAt: new Date().toISOString(),
    source: 'built-in',
  }
}
