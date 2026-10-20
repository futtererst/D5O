import { NextRequest, NextResponse } from "next/server";
import { createRybexSupabaseAdminClient } from "@/lib/d5o/auth/supabase-server";
import { validLocalScheduleOrigin } from "@/lib/d5o/scheduling/request-origin";

export const dynamic = "force-dynamic";
const response = (message: string, status = 200) => NextResponse.json({ message }, {
  status, headers: { "Cache-Control": "no-store" },
});
export async function POST(request: NextRequest) {
  if (!validLocalScheduleOrigin(request.headers)) return response("Request unavailable.", 403);
  try {
    const raw = await request.text();
    if (raw.length > 300) return response("Request unavailable.", 400);
    const { email } = JSON.parse(raw) as { email?: string };
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response("Enter a valid email address.", 400);
    const allowedAddress = process.env.D5O_APPROVED_TEST_EMAIL_ADDRESS?.trim().toLowerCase();
    if (!allowedAddress) return response("Password recovery is not configured for this synthetic trial.", 503);
    if (email.trim().toLowerCase() === allowedAddress) {
      const browserOrigin = request.headers.get("origin") ?? "";
      const origin = process.env.D5O_ISOLATED_PILOT === "1" && /^http:\/\/127\.0\.0\.1:\d+$/.test(browserOrigin)
        ? browserOrigin : "https://d5o-system-of-work.vercel.app";
      try {
        const admin = createRybexSupabaseAdminClient();
        await admin.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
          redirectTo: `${origin}/auth/set-password`,
        });
      } catch { /* Public responses never reveal a provider or account-specific outcome. */ }
    }
    return response("If this address has an eligible account, a recovery email has been requested. Check the approved mailbox.");
  } catch {
    return response("Recovery is temporarily unavailable. Try again later.", 503);
  }
}
