---
title: Payments, invoices and receipts
summary: Record money received, issue GST invoices and credit notes, and give customers receipts.
category: Finance
keywords: [payment, invoice, gst, receipt, credit note, refund, tax, razorpay, due, overdue]
requires: payments.view
version: 1.3.0
updated: 2026-10-13
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

## What a GST tax invoice must contain

A tax invoice from a GST-registered agency normally needs these, and the software handles them as follows:

- **Your GSTIN and the customer's GSTIN.** Your GSTIN comes from Settings > Invoicing and is checked for a valid format and state. For the customer, enter the GSTIN on the customer record once and it is offered on every new invoice. If a customer has no GSTIN you are warned, but you can still issue; the invoice then says "Unregistered / not provided". For a GST-registered business customer, always add their GSTIN so they can claim input tax credit.
- **A unique, sequential number and the issue date.** Numbers are assigned only when you issue, never repeat, and restart each financial year (April to March) in Indian time. A number can be at most 16 characters, so use a short prefix; if a number would be longer, issuing stops with a message instead of producing an invalid number.
- **The tax split.** Supply within your state shows CGST and SGST; supply to another state shows IGST. Exempt, nil-rated and zero-rated lines are named as such. The invoice states that tax is not payable on reverse charge.
- **A SAC code on every line.** Each tax code needs a SAC before it can be verified, and an invoice cannot be issued with a line whose tax code has none.

Reverse charge, supplies to SEZ units, exports and e-invoice numbers (IRN and QR code) are not supported. Ask your accountant whether any of these apply to you.

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
