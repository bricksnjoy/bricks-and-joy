// Local-timezone date helpers.
// new Date().toISOString() gives the UTC date — in the Maldives (UTC+5) that is
// YESTERDAY between midnight and 5 AM, which put wrong dates on orders and made
// "today" metrics miss early-morning activity. Always use these instead.

export function toLocalISO(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

export const localToday = () => toLocalISO(new Date())

// First day of the current month, local time — "YYYY-MM"
export const localMonth = () => localToday().slice(0, 7)

// Local date N days ago — "YYYY-MM-DD"
export function localDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return toLocalISO(d)
}
