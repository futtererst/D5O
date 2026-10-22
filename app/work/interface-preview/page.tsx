import { notFound } from "next/navigation";
import { D5OPlatform } from "@/components/d5o/platform/D5OPlatform";
import "../enterprise.css";
import "../settings/notification-settings.css";

export const metadata = { title: "D5O interface preview" };
export const dynamic = "force-dynamic";

export default function InterfacePreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <D5OPlatform initialWorkspace="rybex" actorLabel="Local interface reviewer · sample workspace"
    configurationInventory={{ workspaceId: "rybex", status: "no_mapping", tenantId: null, activeVersionId: null, versions: [], canAdminister: false }}
    sourceVersion="local-interface-preview" />;
}
