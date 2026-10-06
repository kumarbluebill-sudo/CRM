import type { Metadata } from "next";
import { CommsPage } from "@/components/comms/comms-page";

export const metadata: Metadata = { title: "Email" };

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  return (
    <CommsPage
      channel="EMAIL"
      title="Email"
      basePath="/communications/email"
      searchParams={searchParams}
    />
  );
}
