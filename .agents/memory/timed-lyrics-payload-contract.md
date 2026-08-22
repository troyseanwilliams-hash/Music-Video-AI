---
name: Timed-lyrics payload contract
description: Why timed lyric limits must account for generated enhanced-LRC output and remain consistent across every render path.
---

Auto-sync output is programmatic and can exceed an HTML textarea's `maxLength`. Enhanced LRC also adds timestamp tags before individual words, making its payload much larger than the visible lyric text.

**Why:** A generated transcript could look valid in the UI but fail only when the video request reached server validation, exposing a raw validation error after the user had already paid for Auto-sync.

**How to apply:** Use one intentional lyric-size policy across create, remix, editor, social-export, and alignment paths. Validate programmatically populated state before submission, return a friendly error, and keep the API and worker timing parsers behaviorally identical.