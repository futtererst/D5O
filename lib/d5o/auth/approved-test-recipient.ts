import { d5oCommandRuntime } from "./hosted-target";

const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** External invitation mail is opt-in for the verified production runtime only. */
export function invitationDeliveryPolicy(): "administrator_approved" | "approved_test_recipients" {
  return d5oCommandRuntime() === "production"
    && process.env.D5O_INVITATION_DELIVERY_POLICY === "administrator_approved"
    ? "administrator_approved" : "approved_test_recipients";
}

/** Server-only exact recipients. The legacy single address remains eligible. */
export function approvedTestRecipients(): ReadonlySet<string> {
  const configured = [
    process.env.D5O_APPROVED_TEST_EMAIL_ADDRESS ?? "",
    process.env.D5O_APPROVED_TEST_EMAIL_ADDRESSES ?? "",
  ];
  return new Set(configured.flatMap((value) => value.split(/[,;\r\n]+/))
    .map((value) => value.trim().toLowerCase()).filter((value) => emailPattern.test(value)));
}

export function isApprovedTestRecipient(email: string): boolean {
  return approvedTestRecipients().has(email.trim().toLowerCase());
}
