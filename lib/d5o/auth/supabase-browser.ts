"use client";

import { createBrowserClient } from "@supabase/ssr";
import { d5oSupabaseCookieOptions } from "./supabase-cookie-options";

type Database = Record<string, unknown>;

export function createRybexSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Supabase browser client requires NEXT_PUBLIC_SUPABASE_URL and a public publishable/anon key.");
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseKey, {
    cookieOptions: d5oSupabaseCookieOptions(supabaseUrl)
  });
}
