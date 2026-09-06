---
name: PostgreSQL idle-client errors
description: Why every shared pg Pool needs an error listener in long-running render processes.
---

Every shared PostgreSQL pool must handle its `error` event and allow the pool to discard the failed idle client instead of letting Node terminate the process.

**Why:** A managed-database restart emitted PostgreSQL code `57P01` on an idle client. With no pool listener, Node treated it as an unhandled EventEmitter error, crashed the API process, and abandoned an active render after its paid scene request had completed.

**How to apply:** Keep the listener on the shared pool used by API and worker processes. Log only sanitized error metadata; do not exit. Let individual failed queries reject normally and rely on persisted request handles plus watchdog recovery for interrupted render work.