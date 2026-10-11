---
title: Security and two-step verification
summary: Protect your account, understand sign-out rules and see what has happened on your agency.
category: Security and data
keywords:
  [
    two-step,
    mfa,
    authenticator,
    password,
    session,
    security,
    sign in,
    audit,
    lockout,
    re-authenticate,
  ]
requires:
version: 1.3.0
updated: 2026-10-11
status: published
related: [staff-roles-and-access, backups-and-restore, troubleshooting]
author: Smart Travel CRM team
---

# Security and two-step verification

![Security settings: 1 failed sign-ins, 2 rate-limit blocks, 3 permission denials, 4 exports](/guide-img/security.png)

## Your account

Open **Profile > Security** to turn on **two-step verification** with an authenticator app. After you sign in with your password you also enter a six-digit code. Keep your recovery details safe: if you lose your authenticator, an administrator may need to help you.

You can also sign out of every device from the same page.

## When you are asked for your password again

Sensitive actions (changing roles, issuing credit notes, exporting data, downloading a backup, changing plan) ask you to confirm your password if you signed in more than 15 minutes ago. This protects you if a screen is left unlocked.

## Sign-out and limits

You are signed out after a long period of inactivity (8 hours by default). Too many wrong passwords in a short time temporarily blocks further tries.

:::admin

## For administrators

**Settings > Security** shows the last 7 days: failed sign-ins, blocked attempts, permission denials, exports and which owners and admins have not enabled two-step verification. You can require two-step verification for administrators; they are then asked to set it up before using the system. **Settings > Audit log** records who did what and when.
:::

> Never share your password or authenticator codes. Nobody from support will ask for them.
