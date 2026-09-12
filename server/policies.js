// Who may read and write what.
//
// This file does the job Supabase's Row Level Security used to do. RLS worked
// because the browser held a token the database itself could read; now the
// browser talks to us and we hold the database password, so the rule has to be
// enforced here instead. Everything below is a direct translation of the
// policies that were in supabase_schema.sql, with two deliberate changes noted
// at the bottom.
//
// Three kinds of caller:
//   anon      — nobody is signed in (a visitor browsing the shop)
//   customer  — signed in through the shop
//   staff     — signed in to the back office
//
// A rule is a list of the roles allowed to do that thing. `own` narrows a role
// down to its own rows: the API adds the filter itself, so a customer asking
// for "all orders" silently gets only theirs, and cannot ask for anyone else's.

const ANY = ['anon', 'customer', 'staff']
const STAFF = ['staff']
const SIGNED_IN = ['customer', 'staff']

// Every back-office table: signed-in staff, everything, same as
// "Authenticated users can do everything" was.
const backOffice = {
  select: STAFF, insert: STAFF, update: STAFF, delete: STAFF,
}

// What a caller who is not staff may put in a row.
//
// The rules above answer "may you write to this table at all". They have to say
// yes to orders and customers, because a shopper checking out is a stranger —
// but that let a stranger set *any* column, including marking their own order
// paid and delivered, or approving their own review. Table-level permission was
// never meant to be the only thing standing there.
//
// `allow` is the set of columns the shop genuinely sends. Anything else is
// dropped. `force` is written afterwards, over the top of whatever arrived, so
// the answers that matter are the server's and not the request's.
//
// Note what this does not do: unit_price is on the allow list, because the
// browser has to say what is being bought. A determined shopper can still
// under-price their own order — which is why every website order lands as
// "under review" for a person to look at before anything is dispatched.
const guard = (allow, force) => ({ allow: new Set(allow), force: force || null })

const GUARDS = {
  orders: guard(
    [
      'customer_id', 'customer_name',
      'product_id', 'product_name', 'qty', 'unit_price', 'discount',
      'order_date', 'invoice_number', 'payment_method',
      'transfer_slip_url', 'fulfilment', 'special_request', 'notes',
    ],
    // Nobody places their own order as paid, delivered, or as a shop sale.
    { status: 'review', payment_status: 'unpaid', channel: 'Website' },
  ),

  customers: guard(
    ['id', 'name', 'phone', 'email', 'address', 'landmark', 'notes'],
  ),

  // A review is written by a stranger and read by everyone, so it waits for
  // somebody to say yes. Back office → Website → Reviews.
  product_reviews: guard(
    ['product_id', 'author_id', 'author_name', 'rating', 'comment'],
    { approved: false },
  ),

  customer_profiles: guard(
    ['id', 'email', 'full_name', 'phone', 'island', 'address', 'landmark', 'notes', 'updated_at'],
  ),
}

const TABLES = {
  // ── Back office ──────────────────────────────────────────────────────────
  products:              backOffice,
  suppliers:             backOffice,
  purchase_orders:       backOffice,
  supplier_products:     backOffice,
  supplier_payments:     backOffice,
  expenses:              backOffice,
  email_contacts:        backOffice,
  categories:            backOffice,
  events:                backOffice,
  event_giveaways:       backOffice,
  order_analyses:        backOffice,
  order_analysis_items:  backOffice,
  loans:                 backOffice,
  loan_payments:         backOffice,
  reconciliations:       backOffice,
  settled_entries:       backOffice,
  app_settings:          backOffice,
  report_settings:       backOffice,
  cash_movements:        backOffice,
  period_locks:          backOffice,
  tasks:                 backOffice,
  message_log:           backOffice,
  campaigns:             backOffice,
  ad_campaigns:          backOffice,
  profiles:              backOffice,

  // The coupon list itself is staff-only. Shoppers never read it — they call
  // the validate_coupon function instead, which answers yes/no about one code.
  coupons:               backOffice,

  // Append-only. No update, no delete, for anyone: a log that can be edited is
  // not a log.
  audit_log:             { select: STAFF, insert: STAFF, update: [], delete: [] },

  // ── Shop ─────────────────────────────────────────────────────────────────
  // The public product view. cost_price is not in it, so browsing is safe.
  shop_products:         { select: ANY, insert: [], update: [], delete: [] },

  // Hero text, promos, shipping fees — the shop reads them, staff edit them.
  site_settings:         { select: ANY, insert: STAFF, update: STAFF, delete: STAFF },

  // Anyone can read reviews; you must be signed in to leave one.
  product_reviews:       { select: ANY, insert: SIGNED_IN, update: STAFF, delete: STAFF },

  // A visitor checking out creates their customer record; a signed-in shopper
  // may update their own and nobody else's.
  customers: {
    select: STAFF, insert: ANY, update: STAFF, delete: STAFF,
    own: { role: 'customer', column: 'id', ops: ['select', 'insert', 'update'] },
  },

  // Same shape for orders: a visitor may place one, a signed-in shopper may
  // read their own history, staff run the business.
  orders: {
    select: STAFF, insert: ANY, update: STAFF, delete: STAFF,
    own: { role: 'customer', column: 'customer_id', ops: ['select'] },
  },

  // Saved delivery details. Yours and only yours.
  customer_profiles: {
    select: STAFF, insert: [], update: STAFF, delete: STAFF,
    own: { role: 'customer', column: 'id', ops: ['select', 'insert', 'update', 'delete'] },
  },
}

// Functions callable through /api/rpc, and who may call them.
const FUNCTIONS = {
  validate_coupon: { roles: ANY, args: ['p_code', 'p_subtotal'] },
}

// Server-side functions (what used to be Edge Functions), and who may invoke
// them. All staff-only: these spend money (SMS credits, AI tokens, email quota)
// and must never become an open relay.
const EDGE = {
  'send-sms':       STAFF,
  'send-email':     STAFF,
  'campaign-ai':    STAFF,
  'monthly-report': STAFF,
}

/**
 * Decide whether `role` may perform `op` on `table`.
 *
 * @returns {{ok: false, reason: string} |
 *           {ok: true, force?: {column: string, value: string}}}
 *   `force` means "allowed, but only for their own rows" — the caller must add
 *   it as a filter on reads and as a locked value on writes.
 *   `guard` limits which columns a non-staff caller may set, and pins the ones
 *   the server decides.
 */
function authorize(table, op, role, userId) {
  const rule = TABLES[table]
  if (!rule) return { ok: false, reason: `Table '${table}' is not available through the API` }

  // Staff are trusted with every column; everyone else writes through a guard
  // where one exists. Reads are unaffected — this only shapes what goes in.
  const guardFor = op === 'insert' || op === 'update'
    ? (role === 'staff' ? null : GUARDS[table] || null)
    : null

  const allowed = rule[op] || []
  if (allowed.includes(role)) return { ok: true, guard: guardFor }

  const own = rule.own
  if (own && own.role === role && own.ops.includes(op)) {
    if (!userId) return { ok: false, reason: 'Sign in to do that' }
    return { ok: true, force: { column: own.column, value: userId }, guard: guardFor }
  }

  return {
    ok: false,
    reason: role === 'anon'
      ? 'Sign in to do that'
      : `Not allowed to ${op} ${table}`,
  }
}

const knownTable = t => Object.prototype.hasOwnProperty.call(TABLES, t)

module.exports = { TABLES, FUNCTIONS, EDGE, authorize, knownTable }

// ── Two things that are deliberately stricter than they were ────────────────
//
// 1. orders / customers. Supabase had both "Authenticated users can do
//    everything" AND "Customers read own orders" on `orders`. Postgres ORs
//    permissive policies together, so the narrow one never narrowed anything:
//    any shopper who created an account could read — and write — every order
//    and every customer record in the shop. The same applied to `customers`.
//    Here a customer only ever reaches their own rows.
//
// 2. audit_log had no update or delete policy in Supabase either, so this
//    matches; it is spelled out explicitly so it stays that way.
