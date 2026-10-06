import type { Metadata } from "next";
import { CommsPage } from "@/components/comms/comms-page";

export const metadata: Metadata = { title: "WhatsApp" };

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  return (
    <CommsPage
      channel="WHATSAPP"
      title="WhatsApp"
      basePath="/communications/whatsapp"
      searchParams={searchParams}
    />
  );
}
