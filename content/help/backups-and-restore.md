---
title: Backups and restore
summary: How your agency's records are backed up, how to check a backup, and how a restore is planned.
category: Security and data
keywords: [backup, restore, encrypted, retention, recovery, download, verify, schedule, safety copy]
requires: backup.manage
version: 1.3.0
updated: 2026-10-11
status: published
related: [security-and-two-step-verification, faq, troubleshooting]
author: Smart Travel CRM team
---

# Backups and restore

![Backups: 1 back up now, 2 schedule and retention, 3 history, with Verify, Download and Restore plan on each backup](/guide-img/backups.png)

## What is backed up

An encrypted copy of your agency's records: customers, leads, quotations, bookings, invoices, tasks, settings and so on. It does **not** include files stored in document storage, payment-gateway credentials or platform billing records.

## Automatic and manual backups

Under **Settings > Backups** switch on **Take backups automatically**, pick daily or weekly, and choose how long to keep them. **Back up now** takes one immediately. A backup is marked _Completed_ only after the saved copy has been read back and checked, so a completed backup has been proven readable.

If a backup fails, people with backup access get a notification and the system retries later.

## Checking and downloading

**Verify** reads the stored copy again and re-runs every check. **Download** gives you the encrypted file (this needs a recent password check). The file cannot be opened without the backup key held by your system administrator.

## Restore

The **Restore plan** button never changes your data. It asks you to type RESTORE, takes a fresh safety copy of today's data, checks it, and records a plan. The restore itself is then carried out by your administrator, under supervision, following the runbook, and checked against the recorded counts.

> Recovery targets are goals, not guarantees, until a restore drill has been run and recorded.

:::admin
Administrators: the destination, encryption key and schedule are configured in the deployment environment (see the deployment guide and runbook). Run one restore check with `scripts/restore-check.mjs` before relying on backups.
:::
