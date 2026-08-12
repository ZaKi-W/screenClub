# Editor performance audit

This document records the editor performance risks that are present in the current code. It is
an evidence register, not a benchmark result: severity describes how much work the architecture
can create, while measurements are still required to attribute user-visible latency on each
platform.

The native export engine and its historical measurements are covered by
[rendering-performance.md](rendering-performance.md). This audit focuses on the live editor,
window startup, and costs retained by hidden or compatibility-only features.

## Implementation status (2026-08-11)

The first P0/P1 pass is now implemented:

- **Performance is the default preview.** It presents Chromium `<video>` pixels directly and does
  not mount the native decoder, RGBA readback, Electron frame IPC, `ImageData`, or canvas upload
  path. Power Saving uses the same architecture; Quality retains the exact native compositor.
- One display-rate visual clock reads the master video's logical time independently of VFR frame
  delivery. Zoom, Full Camera, annotations, webcam and cursor subscribe to it, while application
  state alone publishes at 30 fps in Performance and 15 fps in Power Saving.
- Continuous settings, zoom-focus, annotation and webcam gestures capture one undo snapshot per
  gesture instead of cloning the complete document on every pointer movement. Annotation updates
  are limited to one document patch per display frame, resize position/size travel in one patch,
  and Quality scene rebuilds keep only the newest document for each display frame.
- Clip/trim changes now build an immutable playback index. The display-rate loop resolves segment
  ownership, active raw clips and asset camera tracks from that index instead of rescanning
  segment x raw-clip combinations on every frame. Zoom legacy-region conversion is also prepared
  once when regions change.
- Waveforms mount only in the visible timeline range plus overscan, very narrow clips skip
  extraction, bar counts follow rendered pixel width, unknown-duration sources avoid whole-file
  decode, and the in-memory peaks cache is bounded. Timeline clip/pill children are memoized and
  pointer-driven state updates are coalesced to one per animation frame.
- Window components, the browser-only shim/schema, custom fonts, stale source cleanup, CLI
  commands, STT, AI chat/provider modules and caption translation are loaded on demand. Tiptap is
  no longer part of every renderer's React vendor chunk, and disposable overlay windows no longer
  retain hidden WebContents for the whole session.

This pass intentionally does not claim that Quality mode is fixed: exact-parity preview still uses
the raw RGBA transport and Chromium screen-video clock. Bitmap conversion now has end-to-end
backpressure, idle polling backs off, and the hidden DOM webcam no longer plays while native owns
its pixels, but a platform-specific shared GPU surface remains the next P0 experiment. Full
clip-card virtualization and delta-native scene updates also remain open.

## Current priority order

| ID | Risk | Status after first pass | Remaining impact |
|---|---|---|---|
| PERF-001 | Full-frame native RGBA readback and Electron IPC delivery | Removed from default/Power Saving; retained in Quality | Critical only while Quality plays |
| PERF-002 | Chromium and native decoders play the same screen/webcam sources | Hidden DOM webcam paused in Quality; screen clock remains duplicated | Medium/high only while Quality plays |
| PERF-003 | The 60 Hz playback clock passes through Zustand and React | Visual/store clocks split; playback index removes near-quadratic mapping | Region interval lookups can still be indexed further |
| PERF-004 | Gesture updates clone the document and rebuild the full native scene | One undo snapshot; annotation/scene work rAF-coalesced | Quality still sends a complete scene rather than deltas |
| PERF-005 | Multi-clip timeline and time mapping are not virtualized/indexed | Playback indexed; waveform/pills demand-driven; children memoized | All clip shells still mount |
| PERF-006 | Renderer windows share an eager, heavyweight entry bundle | Windows/media/Tiptap split; initial JS reduced | Locale JSON remains eager |
| PERF-007 | AI provider dependencies enter the eager Electron main bundle | Chat/config/providers/translation delayed | First AI action pays import cost |
| PERF-008 | Every important window disables Chromium background throttling | Limited to HUD and Editor; countdown destroyed after use | Hidden Editor/HUD policy remains state-independent |
| PERF-009 | Persisted custom fonts load in every renderer window | Limited to editor/export | Stored fonts still cost network/font memory there |
| PERF-010 | Development mode materially exaggerates production cost | Diagnostic rule recorded | Profile packaged builds |

## PERF-001 — full-frame preview transport

In Quality mode, the native compositor renders off-screen, reads the render target back into a CPU RGBA buffer,
and publishes `width * height * 4` bytes for each new generation. The renderer polls at a target
of 60 frames per second, receives the packet through Electron IPC, wraps it in `ImageData`, creates
an `ImageBitmap`, and paints it into a 2D canvas.

Evidence:

- [`live.rs`](../../crates/compositor/src/live.rs) performs the render-target readback and stores
  the latest CPU pixel buffer.
- [`compositor-view-napi/src/lib.rs`](../../crates/compositor-view-napi/src/lib.rs) describes the
  `O(width * height)` Rust/structured-clone/canvas delivery cost.
- [`useNativeCompositorView.ts`](../../src/native/hooks/useNativeCompositorView.ts) runs the 60 Hz
  pull loop and the `ImageData -> createImageBitmap -> drawImage` path.
- [`nativeBridge.ts`](../../electron/ipc/nativeBridge.ts) returns the frame through an
  `ipcMain.handle` structured-clone round trip.

A 1920 x 1080 RGBA frame is about 8.29 MB. At 60 fps, the raw payload alone is about 498 MB/s,
before GPU readback stalls, IPC serialization, bitmap creation, and GPU re-upload are counted.
Paused previews avoid the pixel transfer because generation-gated reads return `null`. Performance
and Power Saving never start this path.

## PERF-002 — duplicate media decode

In Quality mode, the native compositor owns screen and webcam decoders. The DOM screen `<video>`
remains playing but visually hidden so the renderer can use its clock, metadata, and interaction
geometry. The DOM webcam remains mounted for metadata/dimensions but is paused while native owns
its pixels.

Evidence:

- [`live.rs`](../../crates/compositor/src/live.rs) owns the native screen/webcam decoder pool.
- [`VirtualPreview.tsx`](../../src/components/ai-edition/VirtualPreview.tsx) keeps the screen video
  and shared display-rate visual clock alive.
- [`WebcamOverlay.tsx`](../../src/components/ai-edition/WebcamOverlay.tsx) only synchronizes and
  plays the DOM webcam in renderer preview modes.
- [`NewEditorShell.module.css`](../../src/components/ai-edition/NewEditorShell.module.css) hides
  their pixels with CSS rather than suspending decode.

Quality therefore retains the Chromium screen decoder alongside native screen/webcam decoders,
but no longer spends a second Chromium decoder on invisible webcam pixels. Performance and Power
Saving use Chromium alone and share one display-rate visual notification.

## PERF-003 — frame clock through application state

During playback, `VirtualPreview` advances visual effects at display rate and writes separately
budgeted `currentTimeSec` updates to the project store. Leaf subscriptions prevent the entire editor shell from
rerendering, but the preview subtree, playhead, and transport consumers still update at the policy
cadence; Quality also performs native position mapping and playback synchronization.

Evidence:

- [`VirtualPreview.tsx`](../../src/components/ai-edition/VirtualPreview.tsx) advances virtual time.
- [`projectStore.ts`](../../src/lib/ai-edition/store/projectStore.ts) stores each time update.
- [`Preview.tsx`](../../src/components/ai-edition/Preview.tsx) subscribes the preview subtree.
- [`NativeCompositorOverlay.tsx`](../../src/components/ai-edition/NativeCompositorOverlay.tsx) and
  [`useNativePlaybackSync.ts`](../../src/native/useNativePlaybackSync.ts) independently resolve
  native positions.
- [`timelineMap.ts`](../../src/lib/ai-edition/timeline/timelineMap.ts) maps and scans segments and
  raw clips for those resolutions.

Clip/trim ownership and the primary screen/webcam lookup now share an immutable playback index.
The remaining per-frame scale cost is primarily linear region matching (speed, Full Camera and
annotation visibility) and Quality's separate native synchronization subscriber.

## PERF-004 — whole-document work during gestures

Continuous editor gestures update the project document on pointer movement. `setDocumentLive`
captures one `structuredClone` at gesture start and commits that snapshot on pointer release.
The native overlay is not mounted in the default preview. Quality coalesces rapid revisions to one
build per animation frame, but that build still serializes and sends the complete scene description.

Evidence:

- [`useEditorSettings.ts`](../../src/lib/ai-edition/store/useEditorSettings.ts) sends live setting
  updates.
- [`useTimeline.ts`](../../src/lib/ai-edition/store/useTimeline.ts) updates zoom and annotation
  gestures.
- [`projectStore.ts`](../../src/lib/ai-edition/store/projectStore.ts) snapshots the previous
  document for undo.
- [`NativeCompositorOverlay.tsx`](../../src/components/ai-edition/NativeCompositorOverlay.tsx)
  rebuilds and serializes the scene after document changes.
- [`sceneDescription.ts`](../../src/native/sceneDescription.ts) reprojects clips, regions,
  captions, layouts, and annotation payloads.

Undo history is bounded and live pointer movements are now coalesced into one gesture transaction.

## PERF-005 — scale costs in multi-clip projects

The V4 timeline still mounts every clip shell so drag geometry and hit targets remain stable, but
clip/pill children are memoized and off-screen pills are omitted.
Waveform content now mounts only inside the navigation viewport plus overscan, skips clips below
12 rendered pixels, and caps bars to useful pixel density. Playback position resolution uses the
shared index; scene projection still scans clips and visible segments when documents change, and
Quality swaps native decoders at boundaries.

Evidence:

- [`V4Timeline.tsx`](../../src/components/ai-edition/v4/V4Timeline.tsx) maps all clips and waveform
  nodes into the DOM.
- [`useAudioPeaks.ts`](../../src/hooks/useAudioPeaks.ts) caches peaks, which
  prevents repeated extraction but does not remove the DOM cost.
- [`timelineMap.ts`](../../src/lib/ai-edition/timeline/timelineMap.ts) performs playback position
  mapping.
- [`NativeCompositorOverlay.tsx`](../../src/components/ai-edition/NativeCompositorOverlay.tsx)
  switches the active native clip at boundaries.

## Startup and background costs

### PERF-006 — shared renderer entry

HUD, source selection, notes, countdown, and editor windows share one renderer entry, but their
top-level components are now dynamically imported by [`App.tsx`](../../src/App.tsx). The media
libraries in [`vite.config.ts`](../../vite.config.ts) are split by workflow instead of forcing the
HUD's WebM finalizer to load Mediabunny and MP4Box. Locale JSON remains shared and eager.

Before this implementation the production renderer emitted a 1,179 KB common entry, a 458 KB
React vendor and a 341 KB combined video-processing chunk. The post-change build emits a 716 KB
initial entry and a 141 KB React vendor, while separating Launch, Notes/Tiptap, Source Selector,
editor, Mediabunny and WebM-duration chunks. The browser shim is a separate 10 KB chunk and its
schema graph is no longer preloaded by Electron windows. Locale JSON remains the largest obvious
shared startup payload; packaged cold-start and retained-memory measurements are still required.

### PERF-007 — eager AI provider chain

The main IPC surface retains stable channel registration but dynamically imports the chat service,
credential store, provider authentication and caption translation on first use. STT similarly
loads its manager/model-discovery graph on the first transcription or cancel request.

Evidence:

- [`handlers.ts`](../../electron/ipc/handlers.ts) imports the shared service graph.
- [`aiEditionService.ts`](../../electron/native-bridge/services/aiEditionService.ts) imports
  caption translation.
- [`caption-translate.ts`](../../electron/ai-edition/caption-translate.ts) imports the chat model
  factory.
- [`chat-service.ts`](../../electron/ai-edition/chat-service.ts) dynamically imports the complete
  deep-agent service only when needed.

The remaining cost moves to the first AI/transcription action rather than baseline playback. The
post-change Electron build emits chat service, provider authentication, credential store,
caption translation, agent service and the 1.76 MB model-provider graph as separate dynamic chunks.

### PERF-008 — background throttling disabled

Only Editor and HUD retain `backgroundThrottling: false` in
[`windows.ts`](../../electron/windows.ts), where active playback/recording needs stable cadence.
Area selection, Countdown and Notes use Chromium's default throttling, and Countdown destroys its
WebContents after use instead of keeping a hidden renderer alive.

### PERF-009 — orphaned custom fonts

[`App.tsx`](../../src/App.tsx) now imports and calls `loadAllCustomFonts()` only for editor and CLI
export renderers. When old font records exist, [`customFonts.ts`](../../src/lib/customFonts.ts)
still inserts Google Fonts imports and waits for each font in those consumers.

### PERF-010 — development comparison bias

[`main.tsx`](../../src/main.tsx) wraps the renderer in `React.StrictMode`. In development, React
intentionally repeats mount/effect work, while Vite also adds unoptimized module loading, source
maps, and HMR. A development OpenScreen build must not be compared directly with a packaged Screen
Studio release.

## Hidden and compatibility-only features

| Feature retained in code | Baseline cost when unused | Cost when data or runtime is active |
|---|---|---|
| Transcription / Whisper | Low: IPC registration and small stores only | High CPU/GPU, model memory, and disk when transcription is explicitly started |
| Captions / transcript editing | Low while the feature flag is false | Scene projection and text rendering for old projects with enabled captions |
| Trim | Small for a single untrimmed clip | More playback mapping work as trims and segments grow |
| Speed regions | Empty-array scans | Per-frame region lookup and retimed playback when regions exist |
| Full Camera regions | Empty-array scans | Per-frame region matching when regions exist |
| Annotations | Empty layer/filter work | DOM/native region processing; blur annotations add a full-frame copy and mipmap work |
| AI chat / agent | Low after lazy module registration | First-use import, network/model streaming and document changes during active use |
| CLI and cross-platform capture | Package/startup-code footprint only | No editor hot-path work when unused |

The hidden implementation inventory is therefore not the leading explanation for poor baseline
playback. Old project data can activate some of it, especially blur annotations and fragmented
trim regions. The former always-on preview transport and duplicate decode remain larger costs only
when Quality is selected.

## Measurement gaps

The existing export measurements do not measure the Electron live-preview delivery path. Validate
this implementation in packaged builds on macOS and Windows with at least:

- preview frame size, delivered fps, dropped generations, and readback/IPC/paint latency;
- Chromium and native decoder utilization with screen-only and screen-plus-webcam projects;
- renderer commit/render time caused by the playback clock;
- drag latency and scene rebuild time for settings, zoom, and annotations;
- one, ten, and one hundred clip timelines;
- foreground versus obscured windows and GPU versus software fallback;
- cold-start/module parsing in separate HUD and editor windows.

The comparison baseline must use packaged OpenScreen and packaged Screen Studio on the same
machine, source media, output size, and display scaling.

## Screen Studio comparison

The comparison below was recorded on 2026-08-11 against Screen Studio 3.7.5-4595. Screen Studio is
closed source, so evidence is separated into confirmed behavior, package observations, and
inference. Package inspection was read-only; no application code was modified and no protection
was bypassed.

### Confirmed product behavior

Screen Studio does not require one full-fidelity preview mode for every editing situation. Its
official [Performance Settings guide](https://screen.studio/guide/performance-settings) documents
three modes:

- **Quality** keeps preview and export appearance aligned, including motion blur.
- **Performance** disables expensive effects such as motion blur and permits pixelated images and
  shapes in exchange for higher preview fps.
- **Power Saving** reduces CPU/GPU use and accepts a lower preview frame rate.

The official [changelog](https://screen.studio/changelog) records a repeated pattern rather than a
single optimization:

- reduced preview quality as an explicit option (2.16.1);
- no rendering of invisible elements, better preview/export memory management, a rewritten
  animation engine, and delayed module loading (2.25.2 era);
- texture caching for cursor changes (2.22.16);
- lazy waveform work for huge projects, fewer waveform animations during cutting, and avoidance
  of duplicate playback synchronization (2.25.18 era);
- a rewritten waveform preview engine and timeline work specifically for larger projects (2.26.0);
- separate lower-memory and experimental multithreaded export choices rather than one policy for
  every machine.

These are directly transferable product principles: preview fidelity is budgeted, invisible work
is removed, large-project UI is demand-driven, and startup/heavy work is delayed.

### Confirmed package observations

The installed `/Applications/Screen Studio.app` and the official 3.7.5-4595 Apple Silicon package
show that Screen Studio is also an Electron application. The installed bundle is approximately
624 MB and its `app.asar` approximately 235 MB, so its responsiveness is not explained by being a
small native-only application.

The package contains:

- Electron 39.2.7 with React and PixiJS/WebGL renderer code;
- use of `requestVideoFrameCallback`, `OffscreenCanvas`, and a WebCodecs `VideoDecoder` path that
  requests hardware acceleration before falling back;
- a Swift `polyrecorder-prod` helper linked with ScreenCaptureKit, AVFoundation, CoreMedia,
  CoreVideo, CoreImage, Metal, and VideoToolbox;
- separate helpers for audio composition, mask tracking, face detection, transcription, noise
  filtering, FFmpeg, Whisper, and GIF processing;
- Chromium renderer switches including `--enable-zero-copy`,
  `--enable-gpu-memory-buffer-compositor-resources`, and four raster threads;
- file, asset, and thumbnail custom protocols registered for streaming delivery.

The native framework links confirm an Apple-native recording/media helper. They do **not** prove
that the editor preview is a native Metal view. No independent native editor/compositor addon was
found in the package.

### High-confidence interpretation

The available evidence best fits an Electron/React editing UI whose preview uses a
Chromium-resident WebCodecs and PixiJS/WebGL path, while recording and specialized media jobs use
native or task-specific helpers. This keeps decoded frames close to the browser GPU compositor and
avoids the exact OpenScreen path recorded in PERF-001:

```text
native GPU -> CPU RGBA -> N-API -> Electron IPC -> ImageData -> ImageBitmap -> canvas/GPU
```

This is still an inference because the application code is bundled and closed source. There is no
evidence to claim that Screen Studio preview uses IOSurface, CAMetalLayer, a native Metal editor,
proxy media, or an end-to-end shared Metal texture.

### What OpenScreen borrowed and what remains

| Priority | Screen Studio lesson | OpenScreen status |
|---|---|---|
| P0 | Keep the active frame inside one process presentation path | Done for the default renderer-resident preview; a shared native surface remains for Quality |
| P0 | Preview quality is an explicit budget | Quality, Performance and Power Saving shipped; the latter modes omit native-only expensive effects |
| P1 | Separate media delivery from visual presentation | One display-rate clock now drives zoom, camera and cursor from logical media time; React state is budgeted to 30/15 fps |
| P1 | Do not render invisible project UI | Visible-range waveform mounting shipped; full clip-shell virtualization remains |
| P1 | Cache stable visual/media work | Cache waveform tiles, cursor/text/annotation textures, and projected scene data by stable revision |
| P1 | Delay unrelated modules | Window, browser shim, media, CLI, fonts, STT and AI graphs now load on demand |
| P1 | Isolate specialized work | Keep recording, transcription, noise filtering, tracking, and audio composition behind on-demand helpers so the editor renderer remains a control plane |
| P2 | Stream assets instead of moving blobs through JS IPC | Introduce a range-capable custom media protocol for project assets and thumbnails where direct file URLs are insufficient |
| P2 | Let interaction temporarily reduce quality | During drag/scrub, use lower-resolution/no-blur preview and rebuild the full-quality scene once at gesture commit |

The first pass chose the renderer-resident route for Performance and Power Saving because it can
reuse Chromium's media presentation without a raw-frame bridge. Quality retains the other
requirement: a future native shared surface can preserve the existing compositor and parity, but
needs platform-specific integration (Metal/IOSurface on macOS, D3D/DXGI on Windows, and an
appropriate Linux path). Optimizing the raw-RGBA IPC loop itself is not the target architecture.

Do not copy Chromium switches or occlusion behavior by themselves. A switch named “zero-copy” does
not make an application pipeline zero-copy, and Screen Studio also disables some macOS occlusion
behavior; neither observation replaces a controlled packaged-build measurement.
