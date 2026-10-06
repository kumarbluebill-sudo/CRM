import { NextResponse, type NextRequest } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { getSessionContext } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { audit } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/utils/logger";
import { uuid } from "@/lib/crm/schemas";
import { getBranding } from "@/lib/quotation/queries";
import { VoucherPdf, type VoucherProps } from "@/lib/pdf/voucher-pdf";

export const runtime = "nodejs";
export const maxDuration = 60;
const json = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await ctx.params;
  if (!uuid.safeParse(id).success || !uuid.safeParse(itemId).success)
    return json(404, "Not found.");

  const session = await getSessionContext();
  if (!session) return json(401, "Please sign in.");
  if (
    !session.organization ||
    !session.permissions.has("bookings.view") ||
    !session.permissions.has("suppliers.view")
  ) {
    return json(403, "Forbidden.");
  }
  if (!(await rateLimit(`voucher:${session.userId}`, 30, 60_000)).allowed)
    return json(429, "Too many requests.");

  try {
    const supabase = await createClient();
    const [{ data: booking }, { data: item }] = await Promise.all([
      supabase
        .from("bookings")
        .select("booking_number, title, travel_start, travel_end, status")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("booking_items")
        .select(
          "type, description, quantity, service_date, confirmation_status, confirmation_reference, notes, supplier_id",
        )
        .eq("id", itemId)
        .eq("booking_id", id)
        .maybeSingle(),
    ]);
    if (!booking || !item) return json(404, "Not found."); // missing or other organization (RLS)
    if (booking.status === "CANCELLED") return json(409, "This booking is cancelled.");
    if (item.confirmation_status !== "CONFIRMED" || !item.supplier_id) {
      return json(409, "Vouchers can only be issued for confirmed services that have a supplier.");
    }
    const [{ data: supplier }, { data: pax }, branding] = await Promise.all([
      supabase
        .from("suppliers")
        .select("company_name, phone, email, destination")
        .eq("id", item.supplier_id as string)
        .maybeSingle(),
      supabase
        .from("booking_passengers")
        .select("full_name")
        .eq("booking_id", id)
        .order("is_lead", { ascending: false })
        .order("created_at"),
      getBranding(),
    ]);
    if (!supplier) return json(404, "Not found.");

    const props: VoucherProps = {
      bookingNumber: booking.booking_number as string,
      title: booking.title as string,
      serviceType: item.type as string,
      description: item.description as string,
      serviceDate: item.service_date as string | null,
      confirmationReference: item.confirmation_reference as string | null,
      quantity: Number(item.quantity),
      notes: item.notes as string | null,
      supplier: {
        name: supplier.company_name as string,
        phone: supplier.phone as string | null,
        email: supplier.email as string | null,
        destination: supplier.destination as string | null,
      },
      passengers: (pax ?? []).map((p) => p.full_name as string),
      travel: {
        start: booking.travel_start as string | null,
        end: booking.travel_end as string | null,
      },
      branding: {
        orgName: session.organization.name,
        logo: branding?.logo_data,
        primary: branding?.primary_color,
        phone: branding?.phone,
        email: branding?.email,
        address: branding?.address,
        footer: branding?.footer_text,
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdf = await renderToBuffer(createElement(VoucherPdf, props) as any);
    await audit(supabase, "DOWNLOAD", "voucher", itemId, { booking: booking.booking_number });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="voucher-${String(booking.booking_number).replace(/[^A-Za-z0-9-]/g, "_")}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    logger.error("voucher pdf failed", { error });
    return json(500, "Could not generate the voucher.");
  }
}
