---
name: Vocal music provider contract
description: Durable provider guidance for lyric-based vocal soundtrack generation.
---

Use Eleven Music v2 for lyric-based vocal soundtrack generation. The API accepts one prompt, so combine the style brief and original lyrics within the documented prompt limit, request a bounded product-supported duration, and store the returned MP3. Keep the older gateway Music 3 contract only as an intentional fallback when Eleven Music is unavailable.

**Why:** The previous vocal provider repeatedly timed out upstream. Eleven Music provides the required vocal/instrumental capability with a direct API, documented v2 model, and commercial-use terms; its request must still be bounded so the app does not wait indefinitely.

**How to apply:** Keep vocal routing separate from the existing instrumental route, use `music_v2`, original lyrics only, MP3 output, and a customer-safe timeout. Never blindly retry an accepted music request because a provider timeout may still have produced a charge.