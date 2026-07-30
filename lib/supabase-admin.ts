import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Folosit DOAR pe server (cron, API routes). NU importa asta niciodata
// dintr-un fisier cu 'use client' - cheia service_role nu trebuie sa
// ajunga in bundle-ul de browser.
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});
