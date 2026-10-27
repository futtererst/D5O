// Create a restricted one-line, SSL-required URI from the first line of a user file.
// Never logs or commits the URI.
import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

const source = process.argv[2];
if (!source) throw Error("provide source URI file path");
const file = realpathSync(source);
const first = readFileSync(file, "utf8").split(/\r?\n/)[0].trim();
const url = new URL(first);
const ref = "fcawktdjoxvahhgvkebx";
const direct = url.hostname === `db.${ref}.supabase.co`
  && decodeURIComponent(url.username) === "postgres";
const session = url.hostname.endsWith(".pooler.supabase.com")
  && decodeURIComponent(url.username) === `postgres.${ref}`;
if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !(direct || session)
    || (url.port || "5432") !== "5432"
    || url.pathname !== "/postgres"
    || !url.password || url.password.includes("YOUR-PASSWORD"))
  throw Error("first line is not a complete D5O direct or session-pooler URI");
url.searchParams.set("sslmode", "require");
const output = join(dirname(file), session ? "postgres-session-url.normalized.txt" : "postgres-url.normalized.txt");
writeFileSync(output, url.toString() + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ normalized: true, mode: session ? "session-pooler" : "direct",
  outputFile: output, sourceLinesIgnored: readFileSync(file, "utf8").split(/\r?\n/).length - 1 }));
