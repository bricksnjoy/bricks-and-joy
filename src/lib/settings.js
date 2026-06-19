const KEY = 'bnj_settings_v1'

export const DEFAULT_SETTINGS = {
  // Company
  businessName: "Brick's & Joy",
  tagline: 'Premium LEGO & Building Sets',
  phone: '',
  email: '',
  address: '',
  instagram: '',

  // Financial
  currency: 'MVR',
  taxLabel: 'GST',
  taxRate: 0,        // percent
  taxIncluded: false, // is tax already in the price?

  // Inventory
  lowStockThreshold: 10,
  invoicePrefix: 'INV',

  // Operational
  businessHours: '',
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
