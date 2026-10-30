import type { WorkAcceptance } from "@/components/d5o/platform/deploy-model";

export function canLinkAcceptedHandoff(receipt: WorkAcceptance | undefined, role: string, actorId: string): boolean {
  return receipt?.receipt === "Accepted" &&
    role === (receipt.receivingRole ?? "operations_leader") &&
    receipt.receivedByActorId === actorId;
}
