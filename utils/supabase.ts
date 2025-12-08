// trivia-rush\utils\supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Optional client for browser-side usage (not used directly here but handy)
export const supabaseBrowser = createClient(supabaseUrl, supabaseAnonKey);

// Server-side client using service role key (required for inserting scores)
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseServer = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey)
  : null;
