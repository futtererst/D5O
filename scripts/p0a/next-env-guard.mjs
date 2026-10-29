import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Next dev rewrites this tracked generated file. Restore only its own rewrite,
// and preserve any unrelated edit made while the verifier is running.
export function captureNextEnv(root) {
  const path = resolve(root, "next-env.d.ts");
  const before = readFileSync(path, "utf8");
  return () => {
    const current = readFileSync(path, "utf8");
    const expected = before.replaceAll("./.next/types/", "./.next/dev/types/");
    if (current === expected && current !== before) writeFileSync(path, before);
  };
}
