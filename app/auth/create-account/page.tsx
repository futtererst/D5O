import type { Metadata } from "next";
import { safeInternalRedirectPath } from "@/lib/d5o/auth/redirects";
import { CreateAccountForm } from "./registration-form";

export const metadata: Metadata = { title: "Create account | D5O" };

export default async function CreateAccountPage({ searchParams }: {
  searchParams?: Promise<{ next?: string; resend?: string }>;
}) {
  const params = (await searchParams) ?? {};
  return <CreateAccountForm next={safeInternalRedirectPath(params.next)} initialResend={params.resend === "1"} />;
}
