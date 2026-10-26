import { getSupabaseUrl } from "./supabase-server";
import { resolveD5OCommandRuntime, type D5OCommandRuntime } from "./runtime-identity";

/** A server-only deployment choice. An invalid or missing choice fails closed. */
export function d5oCommandRuntime(): D5OCommandRuntime | null {
  return resolveD5OCommandRuntime({ ...process.env, NEXT_PUBLIC_SUPABASE_URL: getSupabaseUrl() });
}

export function authoritativeD5OCommandsReady(): boolean {
  return d5oCommandRuntime() !== null;
}

export function hostedD5OTargetReady() {
  return authoritativeD5OCommandsReady();
}
