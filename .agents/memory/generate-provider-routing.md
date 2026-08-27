---
name: Generate provider routing
description: Standard Generate provider boundaries and the rule against account-role routing
---

Rule: Standard Generate jobs use direct Runway for the Runway engine and Pixazo only for Kling. Administrators and customers must follow the same engine routing.

**Why:** Gateway-backed Runway caused provider-specific reliability problems, while account-role overrides made production behavior inconsistent and hard to recover safely.

**How to apply:** Runway availability depends on its direct API credential and persists direct task URLs; Kling availability depends on the Pixazo credential. Never expose generic Pixazo as another Generate engine or route Runway through it.