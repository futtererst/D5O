const emailPattern = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

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
