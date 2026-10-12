import { getSupabaseUrl } from "./supabase-server";

const hostedProjectRef = "fcawktdjoxvahhgvkebx";
const isolatedTargets = new Set(["http://127.0.0.1:56321", "http://127.0.0.1:56621", "http://127.0.0.1:56821", "http://127.0.0.1:56921", "http://127.0.0.1:57021"]);

/** A server-only deployment choice. An invalid or missing choice fails closed. */
export function d5oCommandRuntime(): "pilot" | "rehearsal" | "production" | null {
  if (process.env.D5O_HOSTED_ENABLED !== "1") return null;
  try {
    const origin = new URL(getSupabaseUrl()).origin;
    if (process.env.D5O_ISOLATED_PILOT === "1" &&
      (!process.env.D5O_COMMAND_RUNTIME || process.env.D5O_COMMAND_RUNTIME === "pilot") &&
      process.env.NODE_ENV === "development" &&
      isolatedTargets.has(origin) &&
      origin === process.env.D5O_ISOLATED_PILOT_URL)
      return "pilot";
    if (process.env.D5O_COMMAND_RUNTIME === "rehearsal" &&
      process.env.D5O_ISOLATED_PILOT !== "1" &&
      process.env.NODE_ENV === "production" &&
      isolatedTargets.has(origin) &&
      origin === process.env.D5O_REHEARSAL_TARGET_URL)
      return "rehearsal";
    if (process.env.D5O_COMMAND_RUNTIME === "production" &&
      process.env.D5O_ISOLATED_PILOT !== "1" &&
      process.env.NODE_ENV === "production" &&
      process.env.RYBEXOS_RUNTIME_MODE === "production" &&
      origin === `https://${hostedProjectRef}.supabase.co`)
      return "production";
  } catch { /* A malformed target never enables a command runtime. */ }
  return null;
}

export function authoritativeD5OCommandsReady(): boolean {
  return d5oCommandRuntime() !== null;
}

export function hostedD5OTargetReady() {
  return authoritativeD5OCommandsReady();
}
