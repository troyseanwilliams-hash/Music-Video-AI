---
name: Pixazo model slug validation
description: How to verify a Pixazo gateway model slug is live without an API key
---
Probe `POST https://gateway.pixazo.ai/<slug>/v1/<slug>-request` keyless: **401 = route exists** (valid slug), **404 = dead slug**.
**Why:** slugs are typed into secrets by hand; a wrong slug fails only at render time. Confirmed live: `kling-video-o3-4k-text-to-video` (4K), `kling-video-v3-turbo-pro-text-to-video`. Dead: `kling-video-v3-text-to-video`, `kling-video-v3-4k-text-to-video`.
Runway models use the same gateway route convention as other model slugs: `/<model>/v1/<model>-request`. A nested provider/version route such as `/v1/gen-4.5/text-to-video` returns 404 before a request is accepted.
**Why:** gateway model routes are model-addressed; a Runway-specific path was not a valid submission route.
**How to apply:** whenever PIXAZO_KLING_MODEL / PIXAZO_KLING_4K_MODEL / PIXAZO_MODEL values change or gateway jobs 404, probe first. Keep both videoApis copies (api-server + worker) in lockstep and test the generated submission URL.
