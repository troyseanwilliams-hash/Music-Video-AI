---
name: Script approval gate
description: Submission rule requiring users to approve the exact script and planned scene prompts before a paid video job starts.
---

Video generation requires an explicit user approval of the current script and every planned scene prompt. The approval must reset whenever the script, plan inputs, or generated prompts change, and the server must reject a missing or false approval before reserving credits.

**Why:** Per-scene review alone does not clearly confirm that the user approves the complete submitted script, and a client-only checkbox can be bypassed.

**How to apply:** Show the checkbox in the final confirmation step after the complete storyboard preview. Send a required boolean in the job contract and validate it before any reservation or provider work.