import { d5oCommandRuntime } from "@/lib/d5o/auth/hosted-target";

const localScheduleOrigins = new Set(["http://127.0.0.1:61430", "http://127.0.0.1:61431"]);

/** Check the browser-visible host, not Next's internally reconstructed request URL. */
export function validLocalScheduleOrigin(headers: Headers): boolean {
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin || !host || headers.get("sec-fetch-site") !== "same-origin") return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || parsed.host !== host) return false;
    const runtime = d5oCommandRuntime();
    if (runtime === "pilot"
      && (origin === "http://127.0.0.1:61641" ||
        process.env.D5O_ISOLATED_PILOT_URL === "http://127.0.0.1:56621" && origin === "http://127.0.0.1:61642" ||
        process.env.D5O_ISOLATED_PILOT_URL === "http://127.0.0.1:56821" && origin === "http://127.0.0.1:61645")) return true;
    if (runtime === "rehearsal") return origin === "http://127.0.0.1:61643" ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:56321" && origin === "http://127.0.0.1:61644") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:56921" && origin === "http://127.0.0.1:61644") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:57721" && origin === "http://127.0.0.1:61644") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:57721" && origin === "http://127.0.0.1:61651") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:56821" && origin === "http://127.0.0.1:61645") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:57021" && origin === "http://127.0.0.1:61647") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:57121" && origin === "http://127.0.0.1:61648") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:57221" && origin === "http://127.0.0.1:61649") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:57421" && origin === "http://127.0.0.1:61650") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:58221" && origin === "http://127.0.0.1:61650") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:58221" && origin === "http://127.0.0.1:61656") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:58521" && origin === "http://127.0.0.1:61657") ||
      (process.env.D5O_REHEARSAL_TARGET_URL === "http://127.0.0.1:57621" && origin === "http://127.0.0.1:61651");
    if (runtime === "production") return parsed.protocol === "https:";
    return localScheduleOrigins.has(origin);
  } catch { return false; }
}
