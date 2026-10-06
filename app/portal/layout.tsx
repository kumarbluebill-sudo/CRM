import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your trip",
  robots: { index: false, follow: false, nocache: true },
};

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-muted/30 min-h-screen">{children}</div>;
}
