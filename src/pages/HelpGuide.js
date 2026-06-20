import React, { useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Search, LifeBuoy, ShoppingCart, BookOpen, Truck, Lightbulb,
  Users, Package, Tag, Building2, MessageSquare, Sparkles, CalendarDays,
  FileText, DollarSign, BarChart2, LayoutDashboard, Smartphone, ChevronRight, ArrowLeft
} from 'lucide-react'

// ── Guide content ─────────────────────────────────────────────────────────────
// Each guide is a "how-to" card with numbered steps. A step can carry an optional
// `tip` callout. Keep these in plain language — this is the manual for new staff.
const GUIDES = [
  {
    id: 'getting-started',
    icon: LayoutDashboard,
    color: '#0d1b2a',
    title: 'Getting around the app',
    desc: 'The basics — the menu, the dashboard, and finding things.',
    steps: [
      { text: 'The left side menu is how you move between sections. On a phone, tap the ☰ menu icon at the top-left to open it.' },
      { text: 'The Dashboard is your home screen — today’s sales, this month’s total, revenue, profit, active orders, stock levels and recent orders at a glance.' },
      { text: 'Tap the three-dots (⋯) next to “Sign out” at the bottom of the menu for extra options: this How-to guide and “Reorganize menu”.' },
      { text: 'Use “Reorganize menu” to drag sections and pages into the order you like. Press “Done organizing” when finished.', tip: 'Your menu layout is saved on this device, so it stays the way you set it.' },
      { text: 'Open this guide any time from the three-dots menu, and use the search box at the top to jump straight to a task.' },
    ],
  },
  {
    id: 'team',
    icon: Users,
    color: '#0d1b2a',
    title: 'Adding staff & managing access',
    desc: 'Sign-ups are invite-only — here’s how the owner adds a team member.',
    steps: [
      { text: 'For security, no one can create their own account. Only an administrator can add staff.', tip: 'The login screen is sign-in only — there is no public sign-up.' },
      { text: 'Open your Supabase dashboard → Authentication → Users → “Add user”.' },
      { text: 'Enter the staff member’s email and a temporary password, and tick “Auto confirm user” so they can log in right away.' },
      { text: 'Share that email and password with them — they sign in on the app’s login screen and can change the password later.' },
      { text: 'Add the same person under Message Center → Contacts using the exact same email.', tip: 'Matching the email means orders they create show “by <their name>” instead of the raw email.' },
      { text: 'To remove access, go back to Authentication → Users and delete or ban that user.' },
    ],
  },
  {
    id: 'customers',
    icon: Users,
    color: '#378ADD',
    title: 'Adding & managing customers',
    desc: 'Keep a clean customer list so orders and delivery notes come out right.',
    steps: [
      { text: 'Open Customers and press “Add customer”.' },
      { text: 'Enter the name and phone number. Add the email and Instagram username if you have them.', tip: 'Type the phone number without 960 — it’s added automatically when sending an SMS.' },
      { text: 'Fill in the Address, and the Landmark right below it (e.g. “near the school”). Leave Landmark blank if you don’t have it.', tip: 'The landmark is added to delivery notes to help the rider find the place.' },
      { text: 'Save. The customer now appears when you create an order and in the delivery notes.' },
      { text: 'To change a customer’s details later, find them in the list and use Edit.' },
    ],
  },
  {
    id: 'new-order',
    icon: ShoppingCart,
    color: '#FFA500',
    title: 'Taking a new order',
    desc: 'From picking the customer to saving the order.',
    steps: [
      { text: 'Make sure the customer exists first (see “Adding & managing customers”).' },
      { text: 'Go to Orders and press “New order”.' },
      { text: 'Choose the customer — this is required, an order can’t be saved without one.' },
      { text: 'Add the product: tap the camera button to scan its barcode, or pick it from the dropdown. The price fills in automatically.', tip: 'Scanning is fastest — point your phone camera at the product’s barcode.' },
      { text: 'Selling more than one item? Press “Add item” and add the next product.' },
      { text: 'Giving a discount? Pick MVR or % and type the amount, next to the Discount label.' },
      { text: 'Pick the Channel (where the sale came from — retail, Instagram, etc.) and add any notes.' },
      { text: 'Press “Add order”. New orders start as “Order created” and instantly appear in Deliveries and the Message Center.', tip: 'The order date is set to today automatically. To back-date it, open the order with Edit afterwards.' },
    ],
  },
  {
    id: 'manage-orders',
    icon: ShoppingCart,
    color: '#7F77DD',
    title: 'Managing an order (status, payment, returns)',
    desc: 'Everything you can do to an order after it’s created.',
    steps: [
      { text: 'In Orders, switch between the card view (big product photo) and list view using the toggle on the right.' },
      { text: 'Tap the product photo on a card to see the full order details.' },
      { text: 'Change the order’s progress with the status dropdown on the card: Order created → Dispatched → Delivered (or Cancelled).' },
      { text: 'To record a payment, press the “Payment” button, choose Paid / Partial / Unpaid, pick the method, and upload the bank slip if there is one.', tip: 'The payment badge on the card shows the current status — it updates when you save in the Payment box.' },
      { text: 'Use the three-dots (⋮) on a card for: Edit, SMS (text the customer), Return, or Delete.' },
      { text: 'A Return cancels the order, puts the stock back, and logs the refund as an expense automatically.' },
      { text: 'Filter the list with the tabs on top (Created, Dispatched, Delivered, Cancelled, All).' },
    ],
  },
  {
    id: 'deliveries',
    icon: Truck,
    color: '#1D9E75',
    title: 'Assigning deliveries',
    desc: 'Attach a delivery person and date to each order — for your records.',
    steps: [
      { text: 'Open Deliveries. Every order shows as a card with the product photo and customer.' },
      { text: 'Type the delivery staff name in “Delivery staff” and set the “Delivery date”. The date defaults to the order’s date until you change it.' },
      { text: 'Press Save on the card to store it. The card border turns orange until you’ve saved.', tip: 'Nothing is saved until you press Save — so you can change your mind before committing.' },
      { text: 'Filter with the tabs on top: Unassigned, Assigned, Delivered or All — the numbers show how many are in each.' },
      { text: 'The “Deliveries by staff” panel shows how many each person has delivered and how many they’re assigned.' },
      { text: 'This tab is record-keeping only — it does not control who you can message. Sending the note is done in the Message Center.' },
    ],
  },
  {
    id: 'message-center',
    icon: MessageSquare,
    color: '#E24B4A',
    title: 'Sending SMS & emails',
    desc: 'Broadcasts, delivery notes, and one-off messages — all in one place.',
    steps: [
      { text: 'Open the Message Center. Pick a channel (SMS or Email) for each action.' },
      { text: 'Broadcast: send all your customers an SMS about a sale or announcement. Write the message and send.', tip: 'Type numbers without 960 anywhere — it’s added automatically when the SMS goes out.' },
      { text: 'Deliveries: pick an order to auto-generate its delivery note, then send it to any staff member. Email gives a long detailed note; SMS uses the short compact format.' },
      { text: 'Stock & Tasks: quickly message the team about low stock or jobs to do.' },
      { text: 'Contacts: add staff, directors and delivery people once — they’re shared everywhere SMS/email is used. Add a phone number to text them.' },
      { text: 'Use “Compose” in Contacts to send anyone an email or SMS about anything — type the address/number directly or tick saved contacts.' },
    ],
  },
  {
    id: 'inventory',
    icon: Package,
    color: '#0F6E56',
    title: 'Managing inventory & stock',
    desc: 'Add products, photos, barcodes, and keep stock counts right.',
    steps: [
      { text: 'Open Inventory and press “Add product”. Fill in the name, category, prices and stock count.' },
      { text: 'Upload a product photo so it shows on order and delivery cards.' },
      { text: 'Give it a barcode/SKU so it can be scanned when taking orders or doing stock.' },
      { text: 'Use the tabs to filter: Active, Retired, Low Stock, Cleared Out.', tip: 'A “Stock alert” shows at the top of Orders when items are low or out — tap it to see exactly which.' },
      { text: 'Use “Select” to tick several products at once and retire, delete or print barcodes in bulk.' },
      { text: 'Stock goes down automatically when you sell, and back up when you receive a batch or process a return.' },
    ],
  },
  {
    id: 'categories',
    icon: Tag,
    color: '#FFA500',
    title: 'Organising categories',
    desc: 'Group products so they’re easy to filter and report on.',
    steps: [
      { text: 'Open Categories to see all your product groups and how many products are in each.' },
      { text: 'Add a category and give it a colour so it’s easy to spot.' },
      { text: 'Assign products to a category from the product’s details in Inventory.' },
      { text: 'Categories are used across filters and the financial reports, so keep them tidy.' },
    ],
  },
  {
    id: 'suppliers',
    icon: Building2,
    color: '#7F77DD',
    title: 'Setting up suppliers',
    desc: 'Add the companies you buy stock from.',
    steps: [
      { text: 'Open Vendors and add a new supplier.' },
      { text: 'Fill in the company, contact name, phone and any notes correctly.', tip: 'The contact name shows as the main name in the Supplier Catalog, with the company underneath.' },
      { text: 'Once added, the supplier appears in the Supplier Catalog and when creating batch orders.' },
    ],
  },
  {
    id: 'add-products',
    icon: BookOpen,
    color: '#1D9E75',
    title: 'Importing a supplier’s product catalog',
    desc: 'Bulk-add a supplier’s products from an Excel sheet.',
    steps: [
      { text: 'Add the supplier first in Vendors (see “Setting up suppliers”).' },
      { text: 'Open Supplier Catalog, download the import template and fill it in.', tip: 'If a column doesn’t apply to a product, just leave it blank.' },
      { text: 'No picture link? Leave the image column empty — you can add each photo after importing.' },
      { text: 'Select the supplier, then import your filled-in template.' },
      { text: 'The importer marks each row as New, Changed or Duplicate. Press Import to add the new ones and update the changed ones.', tip: 'Re-importing the same sheet won’t create duplicates — unchanged rows are skipped.' },
      { text: 'Use “Price compare” to see the same product across different suppliers and spot the best price.' },
    ],
  },
  {
    id: 'batch-order',
    icon: Truck,
    color: '#378ADD',
    title: 'Ordering stock (batch / purchase orders)',
    desc: 'Buy from a supplier and receive it into inventory.',
    steps: [
      { text: 'In Supplier Catalog, tick the products you want and create a batch order — or start one directly in Purchase Orders.' },
      { text: 'The batch now shows in Purchase Orders under “Ongoing”.' },
      { text: 'After paying the supplier, press “Payment”, upload the slip and mark it Paid.' },
      { text: 'Add extra costs (shipping, customs) to the batch so your real cost is accurate.' },
      { text: 'When goods arrive, set the status to “Received” (or “Mark all received”).', tip: 'Receiving a batch automatically adds every item to your Inventory — no manual entry.' },
      { text: 'Finished batches move to the “History” tab, and payments are tracked in “Payment History”.' },
    ],
  },
  {
    id: 'planning',
    icon: Sparkles,
    color: '#E24B4A',
    title: 'Planning seasonal campaigns',
    desc: 'Get ready for Eid, Ramadan, birthdays and big sale days in advance.',
    steps: [
      { text: 'Open Planning and add a campaign with its occasion date.' },
      { text: 'The app builds a plan — what to stock up on, package ideas, marketing and a checklist.' },
      { text: 'Set how many days before the event you want to start preparing.' },
      { text: 'You’ll get an email reminder when it’s time to begin, and again for the final push.' },
    ],
  },
  {
    id: 'tasks',
    icon: CalendarDays,
    color: '#FFA500',
    title: 'Tasks & calendar',
    desc: 'Keep track of jobs and important dates.',
    steps: [
      { text: 'Open Tasks & Calendar to see the month view.' },
      { text: 'Add a task with a due date and it shows on the calendar.' },
      { text: 'Tick tasks off as you finish them.' },
      { text: 'Use it for restock reminders, follow-ups, deliveries and anything date-based.' },
    ],
  },
  {
    id: 'reports',
    icon: FileText,
    color: '#0d1b2a',
    title: 'Financial reports',
    desc: 'See your profit and download proper documents.',
    steps: [
      { text: 'Open Financial Reports and choose the period at the top.' },
      { text: 'View the Income Statement, Balance Sheet, Cash Flow, GST/Tax and Monthly reports.' },
      { text: 'Download any report as a CSV (opens in Excel / Google Sheets) or Print/PDF where available.' },
      { text: 'Use the Download Documents section for Orders, Costs, Customers and Journal exports.' },
    ],
  },
  {
    id: 'costs',
    icon: DollarSign,
    color: '#E24B4A',
    title: 'Tracking costs & expenses',
    desc: 'Log every business cost — ads, giveaways, samples, operations.',
    steps: [
      { text: 'Open Cost Management and press “Add cost”.' },
      { text: 'Enter the amount, pick a category and the date, and a short description.' },
      { text: 'Filter by category or month to see where money is going.' },
      { text: 'The “By category” breakdown shows your biggest spending areas.', tip: 'Refunds from returns are logged here automatically.' },
    ],
  },
  {
    id: 'analytics',
    icon: BarChart2,
    color: '#1D9E75',
    title: 'Analytics',
    desc: 'Understand your best sellers and trends.',
    steps: [
      { text: 'Open Analytics for charts on sales, top products and customers.' },
      { text: 'Use it to decide what to restock and what to promote.' },
    ],
  },
  {
    id: 'phone-tips',
    icon: Smartphone,
    color: '#7F77DD',
    title: 'Using it on your phone',
    desc: 'Quick tips for the mobile view.',
    steps: [
      { text: 'Tap ☰ at the top-left to open the menu; tap a page to jump there.' },
      { text: 'Filter tabs that don’t fit can be swiped left/right.' },
      { text: 'Wide tables (like payment history) can be scrolled sideways to see all columns.' },
      { text: 'Order and delivery cards stack the photo on top with the details below for easy tapping.' },
    ],
  },
]

export default function HelpGuide({ onClose }) {
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState(null)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return GUIDES
    return GUIDES
      .map(g => {
        const titleHit = g.title.toLowerCase().includes(q) || g.desc.toLowerCase().includes(q)
        const steps = g.steps.filter(s => s.text.toLowerCase().includes(q) || (s.tip || '').toLowerCase().includes(q))
        if (titleHit) return g
        if (steps.length) return { ...g, steps }
        return null
      })
      .filter(Boolean)
  }, [q])

  const active = openId ? GUIDES.find(g => g.id === openId) : null

  return createPortal((
    <div className="help-overlay" style={{
      position: 'fixed', inset: 0, background: '#f8f7f4', zIndex: 3000,
      display: 'flex', flexDirection: 'column', fontFamily: "'Poppins', sans-serif",
      animation: 'helpIn 0.25s ease both',
    }}>
      <style>{`
        @keyframes helpIn { from { opacity: 0; transform: scale(0.99); } to { opacity: 1; transform: scale(1); } }
        @keyframes helpRise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
        .help-card { animation: helpRise 0.35s ease backwards; }
        .help-step:hover { background: #faf9f6; }
        .help-x:hover { background: #fee !important; color: #c0392b !important; }
        .help-scroll::-webkit-scrollbar { width: 8px; }
        .help-scroll::-webkit-scrollbar-thumb { background: #e0ddd6; border-radius: 99px; }
        .help-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .help-tile {
          display: flex; align-items: center; gap: 16px; text-align: left;
          background: #fff; border: 1px solid #eee; border-radius: 16px;
          padding: 20px 22px; cursor: pointer; font-family: inherit; width: 100%;
          transition: all 0.16s ease; animation: helpRise 0.35s ease backwards;
        }
        .help-tile:hover { border-color: #d8d4cc; box-shadow: 0 6px 20px rgba(0,0,0,0.07); transform: translateY(-2px); }
        .help-tile .chev { color: #ccc; transition: transform 0.16s ease, color 0.16s ease; }
        .help-tile:hover .chev { color: #FFA500; transform: translateX(3px); }
        .help-back { display: inline-flex; align-items: center; gap: 7px; background: #fff; border: 1px solid #eee; border-radius: 99px; padding: 8px 16px 8px 12px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; color: #555; transition: all 0.15s; margin-bottom: 20px; }
        .help-back:hover { border-color: #FFA500; color: #FFA500; transform: translateX(-2px); }
        @media (max-width: 720px) { .help-grid { grid-template-columns: 1fr; } }
        @media (max-width: 600px) {
          .help-header { flex-wrap: wrap; padding: 12px 14px !important; gap: 10px !important; }
          .help-search { order: 3; flex-basis: 100% !important; max-width: 100% !important; margin: 0 !important; }
          .help-scroll { padding: 16px 14px 50px !important; }
          .help-title { font-size: 15px !important; }
        }
      `}</style>

      {/* Header */}
      <div className="help-header" style={{
        background: '#fff', borderBottom: '1px solid #eee', padding: '16px 26px',
        display: 'flex', alignItems: 'center', gap: 16, flexShrink: 0,
        boxShadow: '0 1px 6px rgba(0,0,0,0.04)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <div style={{ background: 'linear-gradient(135deg,#FFA500,#ff8c00)', borderRadius: 12, width: 38, height: 38, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(255,165,0,0.3)' }}>
            <LifeBuoy size={20} color="#fff" />
          </div>
          <div>
            <div className="help-title" style={{ fontSize: 16, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px' }}>Help &amp; Guidelines</div>
            <div style={{ fontSize: 12, color: '#aaa' }}>How this works — new here or just need a reminder?</div>
          </div>
        </div>

        {/* Search */}
        <div className="help-search" style={{ position: 'relative', flex: 1, minWidth: 180, maxWidth: 460, margin: '0 auto' }}>
          <Search size={16} color="#bbb" style={{ position: 'absolute', left: 13, top: 12 }} />
          <input
            autoFocus
            value={query}
            onChange={e => { setQuery(e.target.value); setOpenId(null) }}
            placeholder="Search for a task… e.g. discount, supplier, receive stock"
            style={{ width: '100%', padding: '11px 14px 11px 38px', border: '1px solid #e6e3dd', borderRadius: 99, fontSize: 13.5, fontFamily: 'inherit', outline: 'none', background: '#faf9f6', boxSizing: 'border-box' }}
          />
        </div>

        <button onClick={onClose} className="help-x" title="Close" style={{
          background: '#f5f4f1', border: 'none', cursor: 'pointer', color: '#666',
          width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center',
          justifyContent: 'center', transition: 'all 0.15s', flexShrink: 0,
        }}>
          <X size={20} />
        </button>
      </div>

      {/* Body */}
      <div className="help-scroll" style={{ flex: 1, overflowY: 'auto', padding: '26px 26px 60px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto' }}>

          {/* ── DETAIL VIEW — a single guide's steps ── */}
          {active ? (
            <div className="help-card">
              <button className="help-back" onClick={() => setOpenId(null)}>
                <ArrowLeft size={15} /> All guides
              </button>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 22 }}>
                <div style={{ background: `${active.color}18`, borderRadius: 14, width: 52, height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <active.icon size={26} color={active.color} />
                </div>
                <div>
                  <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#0d1b2a', letterSpacing: '-0.3px' }}>{active.title}</h2>
                  <p style={{ margin: '3px 0 0', fontSize: 13.5, color: '#999' }}>{active.desc}</p>
                </div>
              </div>

              {/* Steps */}
              <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 16, padding: '14px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                {active.steps.map((s, i) => (
                  <div key={i} className="help-step" style={{ display: 'flex', gap: 13, padding: '12px 10px', borderRadius: 10, transition: 'background 0.15s' }}>
                    <div style={{
                      flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                      background: active.color, color: '#fff', fontSize: 13, fontWeight: 800,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{i + 1}</div>
                    <div style={{ paddingTop: 2 }}>
                      <div style={{ fontSize: 14, color: '#2c3a47', lineHeight: 1.55 }}>{s.text}</div>
                      {s.tip && (
                        <div style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginTop: 8, background: '#FFF8E1', border: '1px solid #FAEEDA', borderRadius: 9, padding: '8px 11px' }}>
                          <Lightbulb size={14} color="#f0a500" style={{ flexShrink: 0, marginTop: 1 }} />
                          <span style={{ fontSize: 12.5, color: '#8a6d1b', lineHeight: 1.5 }}>{s.tip}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <>
              {filtered.length === 0 && (
                <div style={{ textAlign: 'center', padding: '70px 0', color: '#c4c4c4' }}>
                  <Search size={34} color="#dcd8d0" />
                  <div style={{ marginTop: 14, fontWeight: 600, color: '#999' }}>No guide matches “{query}”.</div>
                  <div style={{ fontSize: 13, marginTop: 4 }}>Try a simpler word like “order”, “product” or “supplier”.</div>
                </div>
              )}

              {/* ── CARD GRID — tap a card to open it ── */}
              <div className="help-grid">
                {filtered.map((g, gi) => (
                  <button key={g.id} className="help-tile" onClick={() => { setOpenId(g.id); document.querySelector('.help-scroll')?.scrollTo({ top: 0 }) }}
                    style={{ animationDelay: `${gi * 40}ms` }}>
                    <div style={{ background: `${g.color}18`, borderRadius: 12, width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <g.icon size={22} color={g.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#0d1b2a', letterSpacing: '-0.2px' }}>{g.title}</div>
                      <div style={{ fontSize: 12.5, color: '#999', marginTop: 3, lineHeight: 1.45 }}>{g.desc}</div>
                    </div>
                    <ChevronRight className="chev" size={20} />
                  </button>
                ))}
              </div>

              {/* Footer note */}
              {!q && (
                <div style={{ textAlign: 'center', color: '#bbb', fontSize: 12.5, marginTop: 28 }}>
                  Tap a card to see step-by-step instructions. More guides added over time.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  ), document.body)
}
