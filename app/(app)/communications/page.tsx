import type { Metadata } from "next";
import { CommsPage } from "@/components/comms/comms-page";

export const metadata: Metadata = { title: "All messages" };

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  return <CommsPage title="All messages" basePath="/communications" searchParams={searchParams} />;
}
