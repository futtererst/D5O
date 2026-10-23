import { d5oCommandRuntime } from "@/lib/d5o/auth/hosted-target";

/** Keep the production pilot allowlist. The independent tenant is enabled only by the disposable local runtime. */
export function customerAdminWorkspaceAllowed(workspace: string): boolean {
  return workspace === "rybex" || (workspace === "enterprise_test" && d5oCommandRuntime() === "pilot");
}
