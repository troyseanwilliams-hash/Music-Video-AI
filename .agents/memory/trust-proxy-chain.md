---
name: Trust proxy and signup IP limits
description: How the API must derive the visitor IP behind Replit's proxy chain; affects per-IP signup/login caps and CSRF origin rules.
---
Express "trust proxy" must trust private-network hops ("loopback, linklocal, uniquelocal"), never `true` and never a fixed hop count of 1.

**Why:** In development the app sees socket 127.0.0.1 plus two private X-Forwarded-For entries (measured 2026-11-25). A hop count of 1 returns an internal proxy address for every visitor, so the 5-accounts-per-IP-per-7-days signup cap would block everyone. `true` lets a client forge the leftmost address. Production signup IPs recorded under the old setting were all public.

**How to apply:** Any change to proxy trust or per-IP limits must keep distinct visitors distinct; re-measure the chain before switching to hop counts. The user set the signup cap to 5 per address.
