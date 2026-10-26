import { createHash } from "node:crypto";

export type D5OCommandRuntime = "pilot" | "rehearsal" | "production" | "staging";

const productionProjectRef = "fcawktdjoxvahhgvkebx";
const isolatedTargets = new Set(["http://127.0.0.1:56321", "http://127.0.0.1:56621", "http://127.0.0.1:56821", "http://127.0.0.1:56921", "http://127.0.0.1:57021", "http://127.0.0.1:57121", "http://127.0.0.1:57221", "http://127.0.0.1:57421", "http://127.0.0.1:57621", "http://127.0.0.1:57721", "http://127.0.0.1:58221", "http://127.0.0.1:58521", "http://127.0.0.1:59241", "http://127.0.0.1:59341", "http://127.0.0.1:59641", "http://127.0.0.1:59741"]);

type Environment = Readonly<Record<string, string | undefined>>;

const isSha256 = (value: string | undefined): value is string => Boolean(value && /^[a-f0-9]{64}$/.test(value));
const fingerprint = (value: string) => createHash("sha256").update(value).digest("hex");

/** Resolves only an exact, authorized command target; unknown combinations fail closed. */
export function resolveD5OCommandRuntime(env: Environment): D5OCommandRuntime | null {
  if (env.D5O_HOSTED_ENABLED !== "1") return null;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    const origin = url.origin;
    if (env.D5O_ISOLATED_PILOT === "1" &&
      (!env.D5O_COMMAND_RUNTIME || env.D5O_COMMAND_RUNTIME === "pilot") &&
      env.NODE_ENV === "development" &&
      isolatedTargets.has(origin) && origin === env.D5O_ISOLATED_PILOT_URL)
      return "pilot";
    if (env.D5O_COMMAND_RUNTIME === "rehearsal" &&
      env.D5O_ISOLATED_PILOT !== "1" && env.NODE_ENV === "production" &&
      isolatedTargets.has(origin) && origin === env.D5O_REHEARSAL_TARGET_URL)
      return "rehearsal";
    if (env.D5O_COMMAND_RUNTIME === "production" &&
      env.D5O_ISOLATED_PILOT !== "1" && env.NODE_ENV === "production" &&
      env.RYBEXOS_RUNTIME_MODE === "production" &&
      origin === `https://${productionProjectRef}.supabase.co`)
      return "production";
    if (env.D5O_COMMAND_RUNTIME !== "staging") return null;

    const ref = env.D5O_STAGING_SUPABASE_REF;
    const branch = env.D5O_STAGING_GIT_BRANCH;
    const publicKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const secretKey = env.SUPABASE_SECRET_KEY;
    const publicHash = env.D5O_STAGING_PUBLISHABLE_KEY_SHA256;
    const secretHash = env.D5O_STAGING_SECRET_KEY_SHA256;
    if (env.D5O_ISOLATED_PILOT === "1" || env.NODE_ENV !== "production" ||
      env.RYBEXOS_RUNTIME_MODE !== "production" || env.RYBEXOS_AUTH_MODE !== "supabase" ||
      env.RYBEXOS_DATA_SOURCE !== "database" || env.VERCEL !== "1" ||
      env.VERCEL_ENV !== "preview" || env.VERCEL_TARGET_ENV !== "preview" ||
      env.VERCEL_PROJECT_ID !== env.D5O_STAGING_VERCEL_PROJECT_ID ||
      !env.VERCEL_PROJECT_ID?.startsWith("prj_") ||
      !branch || branch === "main" || env.VERCEL_GIT_COMMIT_REF !== branch ||
      !ref || !/^[a-z0-9]{20}$/.test(ref) || ref === productionProjectRef ||
      origin !== `https://${ref}.supabase.co` || url.href !== `${origin}/` ||
      !publicKey || !secretKey || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY ||
      !isSha256(publicHash) || !isSha256(secretHash) ||
      fingerprint(publicKey) !== publicHash || fingerprint(secretKey) !== secretHash)
      return null;
    return "staging";
  } catch {
    return null;
  }
}
