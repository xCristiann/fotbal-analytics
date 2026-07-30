import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

// Folosit in browser (componente 'use client'). Foloseste doar cheia
// publica (anon), niciodata service_role.
export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);
