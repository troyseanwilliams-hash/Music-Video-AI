---
name: Lip Sync opt-in controls
description: Product rule for how users configure optional Lip Sync on generated videos.
---

Lip Sync must remain an optional add-on, disabled by default. A user must explicitly enable it before selecting a song segment or uploading a face image. The selected segment duration is user-configurable in whole seconds from 5 through 30, and pricing must continue to use the chosen duration.

**Why:** The user requested that regular and Full-track video generation never imply or activate Lip Sync, while still allowing a precise paid performance segment when desired.

**How to apply:** Keep the Full-track segment selector hidden until the opt-in is enabled, default the completed-video Lip Sync control to off, and preserve a selected duration as the starting value for the completed-video control when it is configured during Full-track generation.