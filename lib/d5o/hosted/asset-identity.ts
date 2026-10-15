import type { WorkRecord } from "@/components/d5o/platform/work-types";

/** Presentation-only duplicate detection; typed database commands remain authoritative. */
export function externalAssetIdentityCounts(records: WorkRecord[], workspace: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.workspace !== workspace) continue;
    for (const asset of record.operate?.assets ?? []) {
      const identity = asset.externalId?.trim().toLowerCase();
      if (identity) counts.set(identity, (counts.get(identity) ?? 0) + 1);
    }
  }
  return counts;
}
