"use client";

import { createBrowserClient } from "@supabase/ssr";
import { useEffect, useState, type ReactNode } from "react";

export function AdminIdentityBoundary({ userId, children }: { userId: string; children: ReactNode }) {
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) return;
    const client = createBrowserClient(url, key);
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      if (session?.user?.id === userId) return;
      setChanged(true);
      window.location.replace(session?.user ? window.location.pathname + window.location.search : "/auth/sign-in");
    });
    return () => subscription.unsubscribe();
  }, [userId]);
  if (changed) return <main role="status">Account changed. Rechecking workspace administration access…</main>;
  return <>{children}</>;
}
