# Montage Studio migration kit

This is a source migration kit for bringing the existing Montage Studio into a podcast application. It is **not a standalone installed app**. The destination app has not been inspected or modified. Source paths are preserved under `source/`; application-specific worker orchestration is under `reference/`.

## Included functionality

- Video and photo timeline, trimming, ordering, transitions, landscape/portrait, 720p/1080p exports.
- Multiple timed video overlays and static-image overlays, saved with the project.
- Reaction layouts, commentary framing, centered 16:9 foreground with blurred fill, thin white/gold/violet/cyan borders, custom colour/width, rounded corners.
- Multiple independent music slots with source trimming, start time, duration, volume, fade-in and fade-out.
- Underlying video, overlay audio, and background music muted while an audible music slot plays; restored after the last overlapping slot ends.
- Separate continuous Background music control.
- Text cards, saved projects, gallery/media pickers, lyric-overlay integration, preview and FFmpeg export.
- Current regression tests for overlay geometry, timing, saving payloads, audio playback and rendering.

Only implemented source is included. Do not assume proposed features, such as dragging/resizing music slots on the timeline, are implemented.

## Start here in the podcast project

Give the receiving agent this instruction:

> Port Montage Studio from this migration kit into this podcast project. First inspect this project's editor, auth, media storage, database, billing and job runner. Read README.md, INTEGRATION.md, DEPENDENCIES.json and FILES.json. Reuse the included editor and renderer instead of recreating them from screenshots. Preserve all implemented video/image overlays, independent timed music slots, fades, mute/restore behavior, saved manifests, text cards, border presets and centered 16:9 blurred framing. Adapt the explicit integration boundaries to this project's own accounts, media and billing. Do not replace the whole application, copy credentials, reuse another application's user IDs, create a second billing authority, or run source database migrations blindly. Review the plan before making destructive changes. Run the included regression tests and the acceptance checklist before declaring the port complete.

## Package layout

- `source/artifacts/beatvision/src/pages/editor.tsx`: integrated editor entry point.
- `source/artifacts/beatvision/src/components/montage/`: overlay and music controls, models, preview and tests.
- `source/artifacts/api-server/src/routes/studio.ts`: project CRUD, server validation and render enqueue reference.
- `source/artifacts/api-server/src/lib/editor*.ts`: renderer and layer schemas, with tests.
- `reference/artifacts/{api-server,worker}/src/lib/jobProcessor.ts`: complete original job orchestration for reference; **not a drop-in replacement** for the podcast worker.
- `source/lib/`: workspace dependencies and database declarations used by the selected source.
- `source/lib/api-spec/`: original API contract/codegen configuration; merge relevant endpoints rather than overwrite the destination contract.
- `source/artifacts/api-server/fonts/`: existing renderer font asset. No font licence file was present in that source directory; obtain its licence before redistributing it.
- `DEPENDENCIES.json`: imported packages, unresolved imports and source package manifests.
- `FILES.json`: SHA-256 hashes of every copied source/reference file.

The original package manifests use pnpm `catalog:` and `workspace:` dependencies. Catalog versions are included in `source/pnpm-workspace.yaml`; map these to the destination's package manager rather than installing the kit as its own application. Integration documentation and source comments may retain original provider names; customer-facing copy should stay provider-neutral.

No environment files, database dumps, uploaded customer media, node_modules, build outputs, or runtime credentials are intentionally included. Environment variable **names** in application source are required integration documentation, not secret values.

## Packaging verification

The selected source passed 33 frontend tests and 22 renderer/schema tests during packaging; one optional long-render test was skipped. Archive CRC and SHA-256 source checks passed. No app code was modified.

The dependency inventory reports five apparent missing imports in `cleanup-generated-indexes.mjs`. These are text examples inside its generated-barrel cleanup logic, not runtime module imports. Actual generated client source is included. The receiving app still needs integration testing; passing source tests does not certify the port.
