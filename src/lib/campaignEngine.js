// ── Campaign "brain" ────────────────────────────────────────────────────────
// A built-in generator that turns an occasion (name + date) into a full sales
// campaign plan, tailored to the shop's real catalog & inventory. Designed so a
// Claude-powered generator can later replace generateCampaignPlan() with the
// same return shape.

// Knowledge base of common occasions. `aliases` drive keyword detection from the
// occasion name; `keywords` are matched against the shop's products to find what
// to stock up on; `stockUpNew` are ideas to bring in; the rest are copy.
export const OCCASION_LIBRARY = [
  {
    id: 'valentines', name: "Valentine's Day", emoji: '🌹', md: '02-14',
    aliases: ['valentine', 'valentines', "valentine's", 'love day'],
    keywords: ['flower', 'rose', 'bouquet', 'heart', 'love', 'plush', 'teddy', 'chocolate', 'couple', 'romance', 'gift'],
    stockUpNew: ['Fresh rose bouquets', 'Heart-shaped gift sets', 'Teddy bears & plush', 'Chocolate gift boxes', 'Couple keychains / mugs'],
    packages: ['"Sweetheart" bouquet + plush bundle', 'Couple gift box: flowers + chocolate + card', 'Build-a-rose set + handwritten card'],
    marketing: ['Post a "Valentine\'s Gift Guide" reel ~3 weeks out', 'Offer free gift wrapping on orders over a set amount', 'Run a couples giveaway with a local cafe', 'Daily countdown stories in the final week'],
  },
  {
    id: 'mothers', name: "Mother's Day", emoji: '💐', md: '05-11',
    aliases: ['mother', 'mothers', "mother's", 'mum', 'mom'],
    keywords: ['flower', 'bouquet', 'rose', 'plush', 'jewel', 'gift', 'spa', 'candle', 'mug'],
    stockUpNew: ['Mixed flower bouquets', 'Jewellery & accessories', 'Scented candles', 'Personalised mugs', 'Gift hampers'],
    packages: ['"Best Mum" hamper: flowers + candle + card', 'Pamper box bundle', 'Flowers + chocolates combo'],
    marketing: ['Share customer "thank you mum" stories', 'Last-minute gift guide reel', 'Free delivery weekend promo', 'Gift-wrapping add-on upsell'],
  },
  {
    id: 'fathers', name: "Father's Day", emoji: '👔', md: '06-15',
    aliases: ['father', 'fathers', "father's", 'dad'],
    keywords: ['car', 'model', 'tool', 'watch', 'gadget', 'sport', 'gift', 'mug', 'kit'],
    stockUpNew: ['Model car/bike kits', 'Gadgets & accessories', 'Sports gear', 'Personalised mugs', 'Tool/grooming sets'],
    packages: ['"For Dad" model kit + card', 'Gadget gift box', 'Sports fan bundle'],
    marketing: ['"Gifts Dad actually wants" post', 'Reels of top gift picks', 'Bundle discount weekend', 'Email past customers a gift guide'],
  },
  {
    id: 'eid', name: 'Eid', emoji: '🌙', md: '03-30',
    aliases: ['eid', 'ramadan', 'fitr', 'adha'],
    keywords: ['gift', 'sweet', 'dates', 'decor', 'lantern', 'family', 'set', 'kids'],
    stockUpNew: ['Eid gift hampers', 'Kids gift sets', 'Festive decorations', 'Sweets & dates boxes', 'Family board games'],
    packages: ['Eid kids gift bundle', 'Family game-night box', 'Festive decoration pack'],
    marketing: ['"Eid Mubarak" gift guide', 'Eidi (gift money) envelope giveaway', 'Family bundle promo', 'Festive decor reels'],
  },
  {
    id: 'christmas', name: 'Christmas', emoji: '🎄', md: '12-25',
    aliases: ['christmas', 'xmas', 'noel', 'santa'],
    keywords: ['gift', 'toy', 'set', 'plush', 'lego', 'build', 'game', 'ornament', 'advent', 'santa', 'tree'],
    stockUpNew: ['Advent calendars', 'Big-build gift sets', 'Stocking-filler toys', 'Festive ornaments', 'Family board games'],
    packages: ['Stocking-filler bundle', '"Big gift" premium set + wrap', 'Family game-night box'],
    marketing: ['Launch a "Christmas Gift Guide" by early November', '12 days of deals countdown', 'Free wrapping + gift cards', 'Last-shipping-date reminders'],
  },
  {
    id: 'newyear', name: 'New Year', emoji: '🎆', md: '01-01',
    aliases: ['new year', 'newyear', 'nye'],
    keywords: ['party', 'game', 'gift', 'decor', 'set', 'celebration'],
    stockUpNew: ['Party supplies', 'Celebration board games', 'Decorations', 'Gift sets', 'Countdown novelties'],
    packages: ['Party-night bundle', 'Family game pack', 'New Year gift box'],
    marketing: ['"New Year, new fun" sale', 'Clear-out / end-of-year discounts', 'Party essentials reel', 'Resolution-themed gift ideas'],
  },
  {
    id: 'backtoschool', name: 'Back to School', emoji: '🎒', md: '08-01',
    aliases: ['back to school', 'school', 'term'],
    keywords: ['educational', 'learn', 'stem', 'puzzle', 'book', 'stationery', 'building', 'kids'],
    stockUpNew: ['Educational/STEM kits', 'Puzzles', 'Stationery sets', 'Backpacks & accessories', 'Reading books'],
    packages: ['"Smart start" learning bundle', 'STEM kit + puzzle combo', 'Stationery starter pack'],
    marketing: ['"Back to school" essentials guide', 'Parent-targeted bundle deals', 'Learning-through-play reels', 'Bulk/classroom discount offer'],
  },
  {
    id: 'halloween', name: 'Halloween', emoji: '🎃', md: '10-31',
    aliases: ['halloween', 'spooky'],
    keywords: ['costume', 'spooky', 'scary', 'pumpkin', 'mask', 'decor', 'candy'],
    stockUpNew: ['Costumes & masks', 'Spooky decorations', 'Trick-or-treat novelties', 'Themed plush', 'Glow toys'],
    packages: ['Costume + accessory bundle', 'Spooky decor pack', 'Trick-or-treat goodie box'],
    marketing: ['Costume lookbook reels', 'Spooky-display in-store photos', 'Countdown to Halloween posts', 'Best-costume customer contest'],
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

export function addDays(date, days) {
  const d = new Date(date); d.setDate(d.getDate() + days); return d
}

export function toISODate(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

// Status of a campaign relative to today, given lead time (prep window) in days.
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

// catalog: supplier_products rows; inventoryNames: Set of normalized product names
export function generateCampaignPlan({ name, dateISO, leadDays = 90 }, catalog = [], inventoryNames = new Set()) {
  const preset = detectOccasion(name)
  const theme = preset || {
    name, emoji: '🗓️', keywords: [],
    stockUpNew: ['Seasonal best-sellers', 'New arrivals to feature', 'Gift-ready bundles'],
    packages: ['Themed gift bundle', 'Best-sellers value pack'],
    marketing: ['Announce the campaign 3–4 weeks ahead', 'Run a themed giveaway', 'Daily countdown stories', 'Email past customers a special offer'],
  }
  const kw = theme.keywords || []

  // Find products you already carry that fit the theme
  const matched = kw.length
    ? catalog.filter(p => {
        const hay = `${p.product_name || ''} ${p.category || ''} ${p.tags || ''} ${p.description || ''}`.toLowerCase()
        return kw.some(k => hay.includes(k))
      })
    : []

  // Dedupe by product name, note whether it's already in inventory
  const seen = new Set()
  const stockUpExisting = []
  matched.forEach(p => {
    const key = slug(p.product_name)
    if (seen.has(key)) return
    seen.add(key)
    stockUpExisting.push({
      name: p.product_name,
      supplier: p.supplier_name || '',
      cost: p.cost_price || null,
      inInventory: inventoryNames.has(key.trim()),
    })
  })

  const occ = nextOccurrence(dateISO) || new Date()
  const checklist = CHECKLIST_TEMPLATE
    .filter(t => t.off <= Math.max(leadDays, 1) + 5)
    .map((t, i) => ({
      id: `c${i}`,
      text: t.text.replace(/\{name\}/g, name),
      due: toISODate(addDays(occ, -t.off)),
      done: false,
    }))

  const matchCount = stockUpExisting.length
  const summary = preset
    ? `${name} is a high-opportunity occasion. People shop for ${kw.slice(0, 4).join(', ')}. ` +
      (matchCount
        ? `You already carry ${matchCount} matching product${matchCount === 1 ? '' : 's'} — make sure ${matchCount === 1 ? 'it is' : 'they are'} well stocked and front-and-centre. `
        : `You don't carry obvious ${name} products yet — bringing some in could open a new revenue stream. `) +
      `Start prep ~${leadDays} days ahead so stock arrives in time.`
    : `Plan for ${name}: feature your best-sellers, build a themed bundle, and start promoting ~${leadDays} days ahead so everything is ready on the day.`

  return {
    themeName: preset ? preset.name : name,
    emoji: theme.emoji,
    summary,
    stockUpExisting,
    stockUpNew: theme.stockUpNew || [],
    packages: theme.packages || [],
    marketing: theme.marketing || [],
    checklist,
    generatedAt: new Date().toISOString(),
    source: 'built-in',
  }
}
