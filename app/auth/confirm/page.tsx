import type { Metadata } from "next";
import { safeInternalRedirectPath } from "@/lib/d5o/auth/redirects";
import { ConfirmAccount } from "./confirm-account";

export const metadata: Metadata = { title: "Confirm account | D5O" };

export default async function ConfirmAccountPage({ searchParams }: {
  searchParams?: Promise<{ next?: string }>;
}) {
  const params = (await searchParams) ?? {};
  return <ConfirmAccount next={safeInternalRedirectPath(params.next)} />;
}
