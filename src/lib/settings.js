const KEY = 'bnj_settings_v1'

export const DEFAULT_SETTINGS = {
  // Company
  businessName: "Brick's & Joy",
  tagline: 'Premium LEGO & Building Sets',
  phone: '',
  email: '',
  address: '',
  instagram: '',
  businessHours: '',

  // Financial
  currency: 'MVR',
  taxLabel: 'GST',
  taxRate: 0,
  taxIncluded: false,

  // Inventory
  lowStockThreshold: 10,
  invoicePrefix: 'INV',

  // Display
  dateFormat: 'YYYY-MM-DD',    // 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY'
  defaultOrderView: 'cards',   // 'cards' | 'list'
  defaultOrderFilter: 'created',

  // Order defaults
  defaultChannel: 'Retail store',
  defaultPaymentMethod: 'Cash',

  // Communication
  smsFooter: "— Brick's & Joy",
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch {}
}

export function formatDate(dateStr, format) {
  if (!dateStr) return ''
  const fmt = format || getSettings().dateFormat || 'YYYY-MM-DD'
  const [y, m, d] = (dateStr || '').split('-')
  if (!y || !m || !d) return dateStr
  if (fmt === 'DD/MM/YYYY') return `${d}/${m}/${y}`
  if (fmt === 'MM/DD/YYYY') return `${m}/${d}/${y}`
  return dateStr // YYYY-MM-DD
}
