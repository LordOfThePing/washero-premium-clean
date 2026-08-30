import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const API_URL = import.meta.env.VITE_API_URL as string;
const ANON_KEY = import.meta.env.VITE_ANON_KEY as string;

if (!API_URL || !ANON_KEY) {
  throw new Error(
    "[Washero] Missing VITE_API_URL or VITE_ANON_KEY. Set them in your environment.",
  );
}

// Import the db client like this:
// import { db } from "@/integrations/db/client";

const isBrowser = typeof window !== "undefined";

export const db = createClient<Database>(API_URL, ANON_KEY, {
  auth: {
    storage: isBrowser ? window.localStorage : undefined,
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
  }
});
