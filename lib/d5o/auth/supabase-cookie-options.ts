/** Local D5O targets share 127.0.0.1 cookies even when their ports differ. */
export function d5oSupabaseCookieOptions(supabaseUrl: string) {
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol === "http:" && url.hostname === "127.0.0.1" &&
      ["56321", "56621", "56821", "56921"].includes(url.port)) {
      return { name: `sb-d5o-local-${url.port}-auth-token` };
    }
  } catch { /* Invalid targets retain the default cookie name; target guards reject them. */ }
  return undefined;
}
