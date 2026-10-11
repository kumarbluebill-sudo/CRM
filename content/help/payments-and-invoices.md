---
title: Payments, invoices and receipts
summary: Record money received, issue GST invoices and credit notes, and give customers receipts.
category: Finance
keywords: [payment, invoice, gst, receipt, credit note, refund, tax, razorpay, due, overdue]
requires: payments.view
version: 1.3.0
updated: 2026-10-11
status: published
related: [bookings, subscription-and-billing, faq]
author: Smart Travel CRM team
---

# Payments, invoices and receipts

![The invoices page: 1 invoicing and GST settings, 2 the list of invoices (empty until you create one)](/guide-img/invoices.png)

## Recording a payment

Open the booking or **Payments** and record the amount, method and date. Each payment can produce a **receipt** PDF for the customer. Overdue payments appear in notifications.

## GST invoices

:::requires invoicing.manage
Before issuing your first invoice, complete **Settings > Invoicing** (your legal name, GSTIN, address and numbering). Invoices follow the financial-year numbering you set.
:::

1. Create a **draft** invoice from the booking's Payments section, edit it and check every line.
2. **Issue** it. Tax is calculated in one place, and an issued invoice and its lines can no longer be changed.
3. If something was wrong, issue a **credit note** instead of editing. A credit note needs a recent password check.

## Invoice layouts

Four layouts are available: **Classic**, **Modern**, **Compact** and **Detailed** (which adds a tax summary by GST rate). A layout only changes how the PDF looks; every amount is identical.

:::requires invoicing.manage
Choose your agency's default under **Settings > Invoicing and GST**, where you can also open a sample of each layout using your own name, logo and colour. Changing the default does not alter invoices already issued; they simply print in the new look.
:::

On any invoice, the layout menu next to the PDF button lets you pick a different layout for that one download.

> This software helps you prepare tax documents. It does not file returns or generate e-invoice numbers, and your accountant should confirm your setup before real invoices go out.

## Online payments

:::requires settings.manage
Agencies can connect their own Razorpay account under **Settings > Payments**. Your keys are stored encrypted and are never shown again.
:::

Where it is enabled, a customer can pay online and the payment is recorded when Razorpay confirms it.
