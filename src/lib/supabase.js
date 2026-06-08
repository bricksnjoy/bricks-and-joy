import { createClient } from '@supabase/supabase-js'

// Replace these with your actual Supabase project values
// Found in: Supabase Dashboard → Project Settings → API
const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL || 'YOUR_SUPABASE_URL'
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY || 'YOUR_SUPABASE_ANON_KEY'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
