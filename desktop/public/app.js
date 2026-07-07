// app.js — frontend: media intake, an in-browser preview that plays the whole
// cut (videos + timed photos + music), and a draggable timeline.
// To embed in aibeatsync.com, set window.SPLICER_BASE to the API mount path.
const BASE = window.SPLICER_BASE || "";
const PX_PER_SEC = 26;   // timeline horizontal scale
const MIN_BLOCK = 48;    // px
// At/above this clip count, a transition re-encodes the whole timeline in
// batches and export gets substantially slower — so we warn the user.
const TRANSITION_WARN_CLIPS = 12;

// Global diagnostics — surface any uncaught error in the console.
window.addEventListener("error", (e) => console.error("[splicer] uncaught:", e.message, e.error));
window.addEventListener("unhandledrejection", (e) => console.error("[splicer] promise rejected:", e.reason));

// Check the backend found its ffmpeg/ffprobe binaries; warn early if not.
(async function checkHealth() {
  try {
    const h = await (await fetch(`${window.SPLICER_BASE || ""}/api/health`)).json();
    console.log("[splicer] ffmpeg health:", h);
    if (!h.ffmpegExists || !h.ffprobeExists) {
      console.error("[splicer] FFmpeg binary NOT found — export will fail. Resolved:", h.ffmpeg);
    }
  } catch (e) {
    console.error("[splicer] health check failed:", e);
  }
})();

// Log codec support at startup so preview failures are easy to diagnose.
(function logCodecs() {
  const v = document.createElement("video");
  console.log("[splicer] preview codec support:", {
    h264: v.canPlayType('video/mp4; codecs="avc1.42E01E"') || "NO",
    hevc: v.canPlayType('video/mp4; codecs="hvc1"') || "NO",
    mp4: v.canPlayType("video/mp4") || "NO",
    webm: v.canPlayType("video/webm") || "NO",
  });
})();

const state = {
  segments: [], // { id, file, type:'video'|'photo', name, duration, url }
  music: null,  // { file, name, url }
  selected: null,
};

// ---- elements ----
const $ = (id) => document.getElementById(id);
const player = $("player");
const photoView = $("photoView");
const photoBg = $("photoBg");
const stageEmpty = $("stageEmpty");
const transport = $("transport");
const tlWrap = $("tlWrap");
const tlTrack = $("tlTrack");
const tlPlayhead = $("tlPlayhead");
const renderBtn = $("renderBtn");
const errorEl = $("error");
const musicAudio = new Audio();

function uid() { return Math.random().toString(36).slice(2); }
function fmt(t) {
  t = Math.max(0, Math.round(t));
  return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
}
// Human-friendly "time left" for the export ETA (e.g. "45s", "2m 10s").
function fmtEta(sec) {
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

// ---- intake ----
function probeDuration(url) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => resolve(v.duration || 0);
    v.onerror = () => resolve(0);
    v.src = url;
  });
}

async function addFiles(fileList) {
  let added = 0, audioSkipped = 0, otherSkipped = 0;
  for (const file of fileList) {
    const isVideo = file.type.startsWith("video/");
    const isImage = file.type.startsWith("image/");
    // Detect audio files (by MIME or extension) so we can guide the user.
    const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(file.name);
    if (!isVideo && !isImage) {
      if (isAudio) audioSkipped++; else otherSkipped++;
      console.warn("[splicer] skipped (not video/image):", file.name, file.type || "unknown type");
      continue;
    }
    added++;
    const url = URL.createObjectURL(file);
    const seg = {
      id: uid(), file, url,
      previewUrl: null,            // only set if we have to transcode a fallback
      thumb: isImage ? url : null, // a photo is its own thumbnail
      processing: false,
      type: isVideo ? "video" : "photo",
      name: file.name,
      duration: isImage ? 3 : 0,
    };
    state.segments.push(seg);
    if (isVideo) {
      // Most clips (H.264) play directly — just read the duration and grab one
      // still frame for the timeline. No transcoding up front.
      probeDuration(url).then((d) => { seg.duration = d || 3; updateTotals(); renderTimeline(); });
      enqueueThumb(seg);
    }
  }
  syncUI();
  renderTimeline();
  // Load the first segment's frame so the preview shows something immediately.
  if (curIndex < 0 && state.segments.length) { seek(0); }
  // If the user picked only audio (common with music files), guide them.
  if (added === 0 && audioSkipped > 0) {
    showStageMessage('Those are audio files. For songs, use “Choose track” under Music below — “Add media” is only for videos and photos.');
  } else if (added === 0 && otherSkipped > 0) {
    showStageMessage("Those files aren't video or images, so nothing was added.");
  }
}

// Source for in-app playback: the transcoded proxy if we made one, else the original.
function previewSrc(seg) { return seg.previewUrl || seg.url; }

// --- Timeline thumbnails: capture ONE still frame per video, a few at a time.
// This avoids keeping hundreds of live <video> decoders alive (Chromium caps
// them, which is what was making clips error out).
const MAX_THUMB_CONCURRENCY = 3;
const thumbQueue = [];
let activeThumbs = 0;
function enqueueThumb(seg) { thumbQueue.push(seg); pumpThumbs(); }
function pumpThumbs() {
  while (activeThumbs < MAX_THUMB_CONCURRENCY && thumbQueue.length) {
    const seg = thumbQueue.shift();
    activeThumbs++;
    captureThumb(seg).finally(() => { activeThumbs--; pumpThumbs(); });
  }
}
function captureThumb(seg) {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.muted = true; v.preload = "auto";
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      v.removeAttribute("src"); try { v.load(); } catch {}
      renderTimeline(); resolve();
    };
    v.onloadeddata = () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { finish(); } };
    v.onseeked = () => {
      try {
        const w = 160, h = Math.max(1, Math.round(w * (v.videoHeight / v.videoWidth)) || 90);
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d").drawImage(v, 0, 0, w, h);
        seg.thumb = c.toDataURL("image/jpeg", 0.6);
      } catch (e) { console.warn("[splicer] thumb failed:", seg.name, e); seg.thumbErr = true; }
      finish();
    };
    v.onerror = () => { seg.thumbErr = true; finish(); };
    v.src = seg.url;
  });
}

// --- Fallback transcode: only when an original video genuinely won't play in
// the browser (e.g. a real HEVC file). One at a time.
const proxyQueue = [];
let activeProxy = 0;
function requestProxy(seg) {
  if (seg.previewUrl || seg.proxyPending || seg.proxyFailed) return;
  seg.proxyPending = true; seg.processing = true; renderTimeline();
  proxyQueue.push(seg); pumpProxy();
}
function pumpProxy() {
  while (activeProxy < 1 && proxyQueue.length) {
    const seg = proxyQueue.shift();
    activeProxy++;
    buildPreview(seg).finally(() => { activeProxy--; pumpProxy(); });
  }
}
async function buildPreview(seg) {
  try {
    const form = new FormData();
    form.append("file", seg.file);
    const res = await fetch(`${BASE}/api/preview`, { method: "POST", body: form });
    if (!res.ok) throw new Error("preview transcode failed (" + res.status + ")");
    const blob = await res.blob();
    seg.previewUrl = URL.createObjectURL(blob);
    seg.duration = (await probeDuration(seg.previewUrl)) || seg.duration || 3;
    console.log("[splicer] proxy ready:", seg.name);
  } catch (err) {
    console.error("[splicer] proxy build failed for", seg.name, err);
    seg.proxyFailed = true;
  } finally {
    seg.proxyPending = false; seg.processing = false;
    renderTimeline();
    if (state.segments[curIndex] && state.segments[curIndex].id === seg.id) {
      player.dataset.id = "";
      showSegment(curIndex, 0);
    }
  }
}

// ---- timeline rendering ----
function totalDuration() { return state.segments.reduce((s, x) => s + (x.duration || 0), 0); }

function renderTimeline() {
  [...tlTrack.querySelectorAll(".tl-block")].forEach((b) => b.remove());
  const curId = state.segments[curIndex] ? state.segments[curIndex].id : null;
  state.segments.forEach((seg) => {
    const block = document.createElement("div");
    block.className = "tl-block"
      + (state.selected === seg.id ? " sel" : "")
      + (seg.id === curId ? " playing" : "");
    block.draggable = true;
    block.dataset.id = seg.id;
    // Static thumbnail (captured still for videos, the image itself for photos).
    const media = seg.thumb
      ? `<img src="${seg.thumb}" alt="" />`
      : `<span class="thumb-ph">${seg.type === "video" ? "▦" : "▣"}</span>`;
    // Photos get an editable duration; videos show their length as a badge.
    const dur = seg.type === "photo"
      ? `<input class="dur-input" type="number" min="0.5" step="0.5" value="${seg.duration}" data-id="${seg.id}" />`
      : `<span class="dur-badge">${(seg.duration || 0).toFixed(1)}s</span>`;
    block.innerHTML = `
      ${media}
      <span class="btype">${seg.type === "video" ? "▦" : "▣"}</span>
      <span class="brm" data-id="${seg.id}">×</span>
      ${dur}
      ${seg.processing ? `<span class="proc">preparing…</span>` : ""}
    `;
    tlTrack.appendChild(block);
  });
  attachBlockEvents();
}

// Highlight the clip that's currently showing/playing (replaces the playhead).
function updatePlayingHighlight() {
  const curId = state.segments[curIndex] ? state.segments[curIndex].id : null;
  tlTrack.querySelectorAll(".tl-block").forEach((b) =>
    b.classList.toggle("playing", b.dataset.id === curId)
  );
}

function attachBlockEvents() {
  // remove
  tlTrack.querySelectorAll(".brm").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      state.segments = state.segments.filter((s) => s.id !== b.dataset.id);
      syncUI(); renderTimeline();
    })
  );

  // click to select + seek to this block's start
  tlTrack.querySelectorAll(".tl-block").forEach((block) => {
    block.addEventListener("click", (e) => {
      if (e.target.classList.contains("dur-input")) return; // don't seek when editing duration
      state.selected = block.dataset.id;
      seek(blockStart(block.dataset.id));
      renderTimeline();
    });
  });

  // drag-to-reorder
  let dragId = null;
  tlTrack.querySelectorAll(".tl-block").forEach((block) => {
    block.addEventListener("dragstart", () => { dragId = block.dataset.id; block.classList.add("dragging"); });
    block.addEventListener("dragend", () => block.classList.remove("dragging"));
    block.addEventListener("dragover", (e) => {
      e.preventDefault();
      const overId = block.dataset.id;
      if (!dragId || dragId === overId) return;
      const from = state.segments.findIndex((s) => s.id === dragId);
      const to = state.segments.findIndex((s) => s.id === overId);
      if (from < 0 || to < 0) return;
      const [moved] = state.segments.splice(from, 1);
      state.segments.splice(to, 0, moved);
      renderTimeline();
    });
  });

  // photo duration input
  tlTrack.querySelectorAll(".dur-input").forEach((inp) => {
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("change", () => {
      const seg = state.segments.find((s) => s.id === inp.dataset.id);
      if (seg) { seg.duration = Math.max(0.5, Number(inp.value) || 3); updateTotals(); }
    });
  });
}

function blockStart(id) {
  let t = 0;
  for (const s of state.segments) { if (s.id === id) break; t += s.duration || 0; }
  return t;
}

// ---- preview engine ----
let playing = false;
let curIndex = -1;
let rafId = null;
let photoStart = 0;     // performance.now when current photo began
let photoElapsed0 = 0;  // offset already elapsed into the photo

function segAtTime(t) {
  let acc = 0;
  for (let i = 0; i < state.segments.length; i++) {
    const d = state.segments[i].duration || 0;
    if (t < acc + d || i === state.segments.length - 1) return { i, offset: t - acc };
    acc += d;
  }
  return { i: 0, offset: 0 };
}

// Show an overlay message on the stage (reuses the empty-state element).
function showStageMessage(msg) {
  stageEmpty.querySelector("p").textContent = msg;
  stageEmpty.hidden = false;
}
function clearStageMessage() {
  if (state.segments.length) stageEmpty.hidden = true;
}

function showSegment(i, offset) {
  const seg = state.segments[i];
  if (!seg) return;
  curIndex = i;
  if (seg.type === "video") {
    photoBg.hidden = true;
    photoView.hidden = true; player.hidden = false; player.style.display = "block";
    if (player.dataset.id !== seg.id) { player.src = previewSrc(seg); player.dataset.id = seg.id; }
    player.muted = state.music && $("musicMode").value === "replace";
    const apply = () => { try { player.currentTime = offset; } catch {} };
    if (player.readyState >= 1) apply(); else player.onloadedmetadata = apply;
    if (playing) player.play().catch((e) => console.warn("[splicer] play blocked:", e));
  } else {
    player.pause(); player.hidden = true; player.style.display = "none";
    photoView.hidden = false; photoView.src = seg.url;
    // Full-size photo filling the frame: blurred, zoomed copy behind it (matches export).
    photoBg.style.backgroundImage = `url("${seg.url}")`; photoBg.hidden = false;
    clearStageMessage();
    photoStart = performance.now(); photoElapsed0 = offset;
  }
}

// Surface preview decode failures (e.g. HEVC/H.265 clips Chromium can't play).
player.addEventListener("loadeddata", clearStageMessage);
player.addEventListener("error", () => {
  const seg = state.segments[curIndex];
  if (!seg) return;
  console.warn("[splicer] original didn't play:", seg.name, player.error && player.error.code);
  if (!seg.previewUrl && !seg.proxyFailed) {
    // The original can't decode here — transcode a fallback copy just for this clip.
    showStageMessage(`Preparing “${seg.name}” for preview…`);
    requestProxy(seg);
  } else {
    showStageMessage(`Can't preview “${seg.name}” here, but it will still export to MP4 correctly.`);
  }
});

function currentGlobalTime() {
  const seg = state.segments[curIndex];
  if (!seg) return 0;
  const base = blockStart(seg.id);
  if (seg.type === "video") return base + (player.currentTime || 0);
  return base + photoElapsed0 + (playing ? (performance.now() - photoStart) / 1000 : 0);
}

function tick() {
  if (!playing) return;
  const seg = state.segments[curIndex];
  if (seg && seg.type === "photo") {
    const elapsed = photoElapsed0 + (performance.now() - photoStart) / 1000;
    if (elapsed >= (seg.duration || 0)) { advance(); }
  }
  updatePlayhead(currentGlobalTime());
  rafId = requestAnimationFrame(tick);
}

const transPrev = $("transPrev");
let transTimer = null;

// Map each transition (dropdown value) to a preview animation family. The
// export is exact (ffmpeg xfade in render.js); these are visual approximations
// for the in-app preview. Several transitions share an animation family.
const PREVIEW_ANIM = {
  crossfade: "fade",
};
// Every preview animation CSS class — used to clear a transition cleanly.
const TR_CLASSES = [
  "tr-fade",
];
function clearTransitionClasses() {
  player.classList.remove(...TR_CLASSES);
  photoView.classList.remove(...TR_CLASSES);
}
// Snapshot whatever is on screen now, so the incoming clip can animate over it.
function captureTransPrev() {
  try {
    const src = player.hidden ? photoView : player;
    const w = src.videoWidth || src.naturalWidth || 640;
    const h = src.videoHeight || src.naturalHeight || 360;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    c.getContext("2d").drawImage(src, 0, 0, w, h);
    transPrev.src = c.toDataURL("image/jpeg", 0.7);
    return true;
  } catch { return false; }
}
// Animate the incoming clip with the chosen transition.
function runTransition(type, td) {
  const el = player.hidden ? photoView : player;
  $("stage").style.setProperty("--td", td + "s");
  const anim = PREVIEW_ANIM[type] || "fade";
  const cls = "tr-" + anim;
  clearTransitionClasses(); void el.offsetWidth; el.classList.add(cls);
  transPrev.hidden = false;
  clearTimeout(transTimer);
  transTimer = setTimeout(() => { el.classList.remove(cls); transPrev.hidden = true; }, td * 1000 + 60);
}

function advance() {
  if (curIndex + 1 < state.segments.length) {
    const tSel = $("transition"), tDur = $("transitionDuration");
    const type = tSel ? tSel.value : "none";
    const td = Math.max(0.2, (tDur ? Number(tDur.value) : 0.5) || 0.5);
    const useTrans = playing && type !== "none";
    const haveFrame = useTrans && captureTransPrev();
    showSegment(curIndex + 1, 0);
    if (useTrans) {
      if (haveFrame) runTransition(type, td);
    }
  } else {
    pause(); seek(0);
  }
}

function play() {
  if (state.segments.length === 0) return;
  playing = true;
  $("playBtn").textContent = "⏸";
  if (curIndex < 0) showSegment(0, 0);
  else {
    const seg = state.segments[curIndex];
    if (seg.type === "video") player.play().catch(() => {});
    else photoStart = performance.now();
  }
  if (state.music) {
    musicAudio.volume = Number($("musicVolume").value);
    musicAudio.currentTime = Math.min(currentGlobalTime(), musicAudio.duration || 0) || 0;
    musicAudio.play().catch(() => {});
  }
  cancelAnimationFrame(rafId); rafId = requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  $("playBtn").textContent = "▶";
  player.pause(); musicAudio.pause();
  cancelAnimationFrame(rafId);
  // freeze photo elapsed
  const seg = state.segments[curIndex];
  if (seg && seg.type === "photo") photoElapsed0 += (performance.now() - photoStart) / 1000;
}

function seek(t) {
  // Cancel any in-progress transition overlay (manual navigation).
  clearTimeout(transTimer);
  transPrev.hidden = true;
  clearTransitionClasses();
  const total = totalDuration();
  t = Math.max(0, Math.min(t, total));
  const { i, offset } = segAtTime(t);
  showSegment(i, offset);
  if (state.music && musicAudio.duration) musicAudio.currentTime = Math.min(t, musicAudio.duration);
  updatePlayhead(t);
}

// On a real video ending, jump to next segment.
player.addEventListener("ended", () => { if (playing) advance(); });

let lastPlayingId = null;
function updatePlayhead(t) {
  const total = totalDuration() || 1;
  $("curTime").textContent = fmt(t);
  $("totTime").textContent = fmt(total);
  $("scrubFill").style.width = (t / total) * 100 + "%";
  // Move the "playing" highlight only when the current clip changes (cheap).
  const curId = state.segments[curIndex] ? state.segments[curIndex].id : null;
  if (curId !== lastPlayingId) { lastPlayingId = curId; updatePlayingHighlight(); }
}

// Reset the preview to the empty state (used when the timeline is emptied).
function clearPreview() {
  if (playing) pause();
  curIndex = -1;
  lastPlayingId = null;
  player.pause();
  player.removeAttribute("src"); player.load();
  player.hidden = true; player.style.display = "none";
  player.dataset.id = "";
  photoView.hidden = true; photoView.removeAttribute("src");
  photoBg.hidden = true; photoBg.style.backgroundImage = "";
  transPrev.hidden = true; clearTimeout(transTimer);
  musicAudio.pause();
  const p = stageEmpty.querySelector("p"); if (p) p.textContent = "";
  $("scrubFill").style.width = "0%";
  $("curTime").textContent = "0:00";
  $("playBtn").textContent = "▶";
}

// ---- UI sync ----
function syncUI() {
  const has = state.segments.length > 0;
  stageEmpty.hidden = has;
  transport.hidden = !has;
  tlWrap.hidden = !has;
  renderBtn.disabled = !has;
  if (!has) clearPreview();   // cleared the last clip — reset the player
  updateTotals();
  updateTransWarn();
}
function updateTotals() {
  $("totTime").textContent = fmt(totalDuration());
  updatePlayhead(currentGlobalTime());
}

// ---- wiring ----
$("mediaInput").addEventListener("change", (e) => addFiles(e.target.files));
$("mediaInput2").addEventListener("change", (e) => addFiles(e.target.files));
$("playBtn").addEventListener("click", () => (playing ? pause() : play()));
$("scrub").addEventListener("click", (e) => {
  const r = $("scrub").getBoundingClientRect();
  seek(((e.clientX - r.left) / r.width) * totalDuration());
});

// Fullscreen preview.
const viewer = $("viewer");
function toggleFullscreen() {
  const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
  if (fsEl) {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } else {
    (viewer.requestFullscreen || viewer.webkitRequestFullscreen).call(viewer);
  }
}
$("fsBtn").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  const on = !!document.fullscreenElement;
  $("fsBtn").textContent = on ? "🡶" : "⛶";
  $("fsBtn").title = on ? "Exit full screen" : "Full screen";
});
// Double-click the video to toggle, and Esc is handled natively by the browser.
$("stage").addEventListener("dblclick", toggleFullscreen);

// ---- toast (brief transient message) ----
let toastTimer = null;
function showToast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => { t.hidden = true; }, 250);
  }, 2600);
}

// ---- save the current slideshow image to the library ----
function captureFrameBlob(video) {
  return new Promise((resolve) => {
    try {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) return resolve(null);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(video, 0, 0, w, h);
      c.toBlob((b) => resolve(b), "image/png");
    } catch { resolve(null); }
  });
}

async function saveCurrentImage() {
  const seg = state.segments[curIndex];
  if (!seg) { showToast("Nothing to save yet."); return; }
  const btn = $("saveImgBtn");
  btn.disabled = true;
  try {
    let blob, filename, title;
    if (seg.type === "photo") {
      blob = seg.file;                       // original full-resolution bytes
      filename = seg.name || "image.jpg";
      title = (seg.name || "Saved image").replace(/\.[^.]+$/, "");
    } else {
      blob = await captureFrameBlob(player);  // grab the current video frame
      if (!blob) throw new Error("Couldn't capture this frame — try again while it's playing.");
      filename = "frame.png";
      title = (seg.name ? seg.name.replace(/\.[^.]+$/, "") : "Clip") + " frame";
    }
    const form = new FormData();
    form.append("file", blob, filename);
    form.append("title", title);
    form.append("source", "From slideshow");
    const r = await fetch(`${BASE}/api/library/upload`, { method: "POST", body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Save failed (${r.status})`);
    showToast("Saved to your library ✓");
    if (typeof loadLibrary === "function") loadLibrary(); // refresh if Images tab is open
  } catch (e) {
    showToast("Couldn't save: " + (e.message || e));
    console.warn("[splicer] save image failed:", e);
  } finally {
    btn.disabled = false;
  }
}
$("saveImgBtn").addEventListener("click", saveCurrentImage);

const musicInput = $("musicInput");
musicInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.music = { file, name: file.name, url: URL.createObjectURL(file) };
  musicAudio.src = state.music.url;
  $("musicName").textContent = file.name;
  $("musicName").classList.remove("muted");
  $("musicControls").hidden = false;
});
$("musicVolume").addEventListener("input", () => { musicAudio.volume = Number($("musicVolume").value); });

// Warn when a transition is chosen on a project with many clips — that path
// re-encodes the whole timeline (in batches) and can take substantially longer.
function updateTransWarn() {
  const on = $("transition").value !== "none" && state.segments.length >= TRANSITION_WARN_CLIPS;
  $("transWarn").hidden = !on;
}

// Transitions: show the length slider only when a transition is selected.
$("transition").addEventListener("change", () => {
  $("transDurWrap").hidden = $("transition").value === "none";
  updateTransWarn();
});
$("transitionDuration").addEventListener("input", () => {
  $("transDurVal").textContent = Number($("transitionDuration").value).toFixed(1) + "s";
});

// ---- export ----
async function fetchLog(id) {
  try { return await (await fetch(`${BASE}/api/log/${id}`)).text(); }
  catch { return ""; }
}

renderBtn.addEventListener("click", async () => {
  errorEl.hidden = true; renderBtn.disabled = true;
  const progress = $("progress"), fill = $("progressFill"), ptext = $("progressText"), dl = $("downloadLink");
  dl.hidden = true; progress.hidden = false; fill.style.width = "5%";
  let jobId = null;
  console.log("[splicer] export started:", state.segments.length, "segments,",
    state.music ? "with music" : "no music");
  try {
    const form = new FormData();
    const manifest = []; let i = 0;
    for (const seg of state.segments) {
      form.append("files", seg.file);
      manifest.push({ fileIndex: i++, role: seg.type, duration: seg.duration });
    }
    if (state.music) {
      form.append("files", state.music.file);
      manifest.push({ fileIndex: i++, role: "music" });
      form.append("musicMode", $("musicMode").value);
      form.append("musicVolume", $("musicVolume").value);
    }
    form.append("manifest", JSON.stringify(manifest));
    form.append("transition", $("transition").value);
    form.append("transitionDuration", $("transitionDuration").value);
    const res = await fetch(`${BASE}/api/render`, { method: "POST", body: form });
    const { id, error } = await res.json();
    if (error) throw new Error(error);
    jobId = id;
    console.log("[splicer] job id:", id);
    let skipped = [];
    await new Promise((resolve, reject) => {
      const t = setInterval(async () => {
        const s = await (await fetch(`${BASE}/api/status/${id}`)).json();
        fill.style.width = Math.max(5, s.progress) + "%";
        // Live status: which clip we're on + estimated time remaining.
        if (s.phase === "finalizing") {
          ptext.textContent = "Finalizing video…";
        } else if (s.filesTotal) {
          const current = Math.min((s.filesDone || 0) + 1, s.filesTotal);
          const eta = s.etaSeconds != null ? ` · about ${fmtEta(s.etaSeconds)} left` : "";
          ptext.textContent = `Processing clip ${current} of ${s.filesTotal}${eta}`;
        } else {
          ptext.textContent = "Rendering…";
        }
        if (s.state === "done") { skipped = s.skipped || []; clearInterval(t); resolve(); }
        else if (s.state === "error") { clearInterval(t); reject(new Error(s.error)); }
      }, 800);
    });
    fill.style.width = "100%";
    // Automatically download the finished MP4 — one button does both.
    dl.href = `${BASE}/api/download/${id}`;
    dl.download = "splicer-export.mp4";
    dl.click();
    ptext.textContent = skipped.length
      ? `Done & downloading — skipped ${skipped.length} file(s) that couldn't be processed: ${skipped.map((s) => s.name).join(", ")}`
      : "Done — downloading your MP4…";
    if (skipped.length) console.warn("[splicer] skipped files:", skipped);
    console.log("[splicer] export done + download triggered:", id);
  } catch (err) {
    const msg = String(err.message || err);
    console.error("[splicer] export failed:", msg);
    // Pull the full server-side render log and dump it to the console.
    const serverLog = jobId ? await fetchLog(jobId) : "";
    if (serverLog) console.error("[splicer] render log:\n" + serverLog);
    errorEl.innerHTML = "";
    errorEl.append("Export failed: " + msg);
    if (jobId) {
      const a = document.createElement("a");
      a.href = `${BASE}/api/log/${jobId}`;
      a.target = "_blank";
      a.textContent = "  View full log";
      a.style.marginLeft = "8px";
      errorEl.append(a);
    }
    errorEl.append(" (full details in the developer console)");
    errorEl.hidden = false;
  } finally {
    renderBtn.disabled = false;
  }
});

// ---- tabs ----
function switchTab(view) {
  document.querySelectorAll(".view").forEach((v) => { v.hidden = v.id !== view; });
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === view));
  if (view === "viewImages") loadLibrary();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.view)));

// Generic: download images from same-origin fetch URLs and add them as photo
// segments (used by both search results, the saved library, and URL grabs).
async function addPhotosFromFetchUrls(fetchUrls, perDur) {
  let added = 0, failed = 0;
  for (const fu of fetchUrls) {
    try {
      const resp = await fetch(fu);
      if (!resp.ok) throw new Error("fetch " + resp.status);
      const blob = await resp.blob();
      if (!blob.type.startsWith("image/")) throw new Error("not an image");
      const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("svg+xml", "svg");
      const file = new File([blob], `web-image-${uid()}.${ext}`, { type: blob.type });
      const objUrl = URL.createObjectURL(blob);
      state.segments.push({
        id: uid(), file, url: objUrl,
        previewUrl: null, thumb: objUrl, processing: false,
        type: "photo", name: file.name,
        duration: Math.max(0.5, Number(perDur) || 3),
      });
      added++;
    } catch (e) {
      failed++;
      console.warn("[splicer] could not add image:", fu, e);
    }
  }
  if (added) {
    syncUI();
    renderTimeline();
    if (curIndex < 0 && state.segments.length) seek(0);
  }
  return { added, failed };
}

// Save images to the user's computer (Downloads folder). Each is fetched (via a
// same-origin URL so there are no CORS issues), then triggered as a browser
// download; main.js routes downloads to the Downloads folder without prompting.
async function saveImagesToDisk(entries) {
  let ok = 0;
  for (const e of entries) {
    if (!e.fetchUrl) continue;
    try {
      const resp = await fetch(e.fetchUrl);
      if (!resp.ok) throw new Error("fetch " + resp.status);
      const blob = await resp.blob();
      const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("svg+xml", "svg");
      const clean = String(e.name || "image")
        .replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.\- ]+/g, "_").trim().slice(0, 80) || "image";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${clean}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      ok++;
      await new Promise((r) => setTimeout(r, 250)); // small stagger for multiple files
    } catch (err) {
      console.warn("[splicer] save to disk failed:", e.fetchUrl, err);
    }
  }
  return ok;
}

// ---- download location setting (desktop only) ----
let dlFolder = null; // saved folder, or null = "ask every time"

function savedMsg(n) {
  if (!n) return "Couldn't save images";
  const where = dlFolder ? ` to ${dlFolder.split(/[\\/]/).pop()}` : "";
  return `Saved ${n} image${n === 1 ? "" : "s"}${where}`;
}

function applyDownloadSetting(folder) {
  dlFolder = folder || null;
  $("dlFolderLabel").textContent = dlFolder || "Ask every time";
  $("dlAskBtn").hidden = !dlFolder;
}

async function loadDownloadSetting() {
  try {
    const r = await fetch(`${BASE}/api/download-settings`);
    if (!r.ok) return; // not available (e.g. browser dev server) — keep the bar hidden
    const d = await r.json();
    applyDownloadSetting(d.folder);
    $("dlSetting").hidden = false;
  } catch { /* keep hidden */ }
}

$("dlChooseBtn").addEventListener("click", async () => {
  try {
    const r = await fetch(`${BASE}/api/choose-folder`, { method: "POST" });
    const d = await r.json();
    if (!d.canceled) { applyDownloadSetting(d.folder); showToast(d.folder ? "Images will save here from now on" : ""); }
  } catch (e) { console.warn("[splicer] choose folder failed:", e); }
});

$("dlAskBtn").addEventListener("click", async () => {
  try {
    const r = await fetch(`${BASE}/api/download-settings`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ folder: null }),
    });
    const d = await r.json();
    applyDownloadSetting(d.folder);
    showToast("You'll be asked where to save each time");
  } catch (e) { console.warn("[splicer] reset folder failed:", e); }
});

loadDownloadSetting();

// ---- search engine setting ----
async function loadSearchSetting() {
  try {
    const r = await fetch(`${BASE}/api/search-settings`);
    if (!r.ok) return;
    const d = await r.json();
    $("searchEngine").value = d.engine || "wikimedia";
    $("googleCx").value = d.googleCx || "";
    $("googleKey").placeholder = d.hasGoogleKey ? "API key saved — leave blank to keep" : "API key";
    $("googleFields").hidden = d.engine !== "google";
    $("searchSetting").hidden = false;
  } catch { /* keep hidden (e.g. dev server) */ }
}

$("searchEngine").addEventListener("change", async () => {
  const engine = $("searchEngine").value;
  $("googleFields").hidden = engine !== "google";
  if (engine === "wikimedia") {
    try {
      await fetch(`${BASE}/api/search-settings`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ engine }),
      });
      showToast("Searching Wikimedia Commons (free)");
    } catch (e) { console.warn("[splicer] search settings failed:", e); }
  }
});

$("googleSaveBtn").addEventListener("click", async () => {
  const cx = $("googleCx").value.trim();
  const key = $("googleKey").value.trim();
  const keyAlreadySaved = $("googleKey").placeholder.includes("saved");
  if (!cx || (!key && !keyAlreadySaved)) { showToast("Enter your Search engine ID and API key"); return; }
  try {
    const r = await fetch(`${BASE}/api/search-settings`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: "google", googleCx: cx, googleKey: key }),
    });
    const d = await r.json();
    $("googleKey").value = "";
    $("googleKey").placeholder = d.hasGoogleKey ? "API key saved — leave blank to keep" : "API key";
    showToast(d.hasGoogleKey ? "Google search enabled" : "Enter an API key to enable Google");
  } catch (e) {
    showToast("Couldn't save search settings");
    console.warn("[splicer] search settings save failed:", e);
  }
});

loadSearchSetting();

// ---- web image search ----
// Selection is a Map(url -> item) so it PERSISTS across pages: you can select
// images on page 1, browse to page 3, select more, and act on them all at once.
const imgSel = new Map();
let imgResults = [];      // current page's results
let imgQueryStr = "";     // active query
let imgPage = 1;          // current page (1-based)
let imgPageCount = null;  // total pages, if known
let imgHasMore = false;   // whether a next page exists
let imgMode = "search";   // "search" (paginated) | "grab" (single page of a URL's images)

function updateImgSelCount() {
  const n = imgSel.size;
  $("imgSelCount").textContent = `${n} selected`;
  $("imgAddBtn").disabled = n === 0;
  $("imgSaveBtn").disabled = n === 0;
  $("imgDownloadBtn").disabled = n === 0;
}

function updatePager() {
  $("imgPageInfo").textContent = imgPageCount ? `Page ${imgPage} of ${imgPageCount}` : `Page ${imgPage}`;
  $("imgPrev").disabled = imgPage <= 1;
  const hasMore = imgPageCount ? imgPage < imgPageCount : imgHasMore;
  $("imgNext").disabled = !hasMore;
}

function renderImageResults() {
  const grid = $("imgGrid");
  grid.innerHTML = "";
  imgResults.forEach((it, i) => {
    const tile = document.createElement("div");
    tile.className = "img-tile" + (imgSel.has(it.url) ? " sel" : "");
    tile.dataset.url = it.url;
    tile.title = [it.title, it.creator ? "by " + it.creator : "", it.license].filter(Boolean).join(" · ");

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = it.title || "";
    // Grabbed images are pre-downloaded and served locally (it.preview); search
    // results use their remote thumbnail.
    img.src = it.preview ? `${BASE}${it.preview}` : it.thumb;
    img.onerror = () => tile.classList.add("broken");

    const check = document.createElement("span");
    check.className = "img-check";
    check.textContent = "✓";

    const cap = document.createElement("span");
    cap.className = "img-cap";
    cap.textContent = it.license || it.source || "image";

    const zoom = document.createElement("button");
    zoom.className = "img-zoom"; zoom.type = "button"; zoom.title = "Preview"; zoom.textContent = "⤢";
    zoom.addEventListener("click", (e) => { e.stopPropagation(); openLightbox("search", i); });

    tile.append(img, check, cap, zoom);
    tile.addEventListener("click", () => {
      if (imgSel.has(it.url)) { imgSel.delete(it.url); tile.classList.remove("sel"); }
      else { imgSel.set(it.url, it); tile.classList.add("sel"); }
      updateImgSelCount();
    });
    grid.appendChild(tile);
  });
}

// Fetch the current query + page and render it. Selection is preserved.
async function fetchImagePage() {
  const status = $("imgStatus"), grid = $("imgGrid"), actions = $("imgActions"),
        bar = $("imgResultsBar"), btn = $("imgSearchBtn");
  status.hidden = false; status.textContent = "Searching…";
  btn.disabled = true;
  $("imgPrev").disabled = true; $("imgNext").disabled = true;
  try {
    const r = await fetch(`${BASE}/api/image-search?q=${encodeURIComponent(imgQueryStr)}&page=${imgPage}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Search failed (${r.status})`);
    imgResults = data.results || [];
    imgPageCount = data.pageCount || null;
    imgHasMore = data.hasMore ?? (imgResults.length >= 24);
    if (imgResults.length === 0) {
      if (imgPage > 1) { imgPage -= 1; updatePager(); } // stepped past the last page
      status.textContent = imgPage > 1 ? "No more results." : "No images found. Try different keywords.";
      return;
    }
    renderImageResults();
    updatePager();
    updateImgSelCount();
    status.hidden = true;
    grid.hidden = false; actions.hidden = false; bar.hidden = false;
    grid.scrollTop = 0;
  } catch (err) {
    status.hidden = false;
    status.textContent = String(err.message || err);
    console.error("[splicer] image search failed:", err);
  } finally {
    btn.disabled = false;
    if (!$("imgResultsBar").hidden) updatePager();
  }
}

// A brand-new query resets to page 1 and clears the previous selection.
function runImageSearch() {
  const q = $("imgQuery").value.trim();
  if (!q) return;
  imgMode = "search";
  imgQueryStr = q;
  imgPage = 1;
  imgSel.clear();
  updateImgSelCount();
  $("imgPager").hidden = false; // pagination applies to searches
  $("imgGrid").hidden = true;
  $("imgActions").hidden = true;
  $("imgResultsBar").hidden = true;
  fetchImagePage();
}

// Pull every image off a given web page and show them in the same grid. These
// results reuse the exact selection / Add-to-video / Save-to-library flow.
async function runImageGrab() {
  const raw = $("imgUrl").value.trim();
  if (!raw) return;
  imgMode = "grab";
  imgSel.clear();
  updateImgSelCount();
  const status = $("imgStatus"), grid = $("imgGrid"), actions = $("imgActions"),
        bar = $("imgResultsBar"), btn = $("imgGrabBtn");
  grid.hidden = true; actions.hidden = true; bar.hidden = true;
  status.hidden = false; status.textContent = "Finding full-size images (following links)…";
  btn.disabled = true;
  try {
    const r = await fetch(`${BASE}/api/image-grab?url=${encodeURIComponent(raw)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Couldn't grab images (${r.status})`);
    imgResults = d.results || [];
    if (imgResults.length === 0) {
      status.textContent = "No images found on that page.";
      return;
    }
    renderImageResults();
    status.hidden = true;
    grid.hidden = false; actions.hidden = false; bar.hidden = false;
    $("imgPager").hidden = true; // a grabbed page isn't paginated
    grid.scrollTop = 0;
    updateImgSelCount();
  } catch (err) {
    status.hidden = false;
    status.textContent = String(err.message || err);
    console.error("[splicer] image grab failed:", err);
  } finally {
    btn.disabled = false;
  }
}

// Add a single image by its direct address (the escape hatch for JS-only sites).
async function runImageOne() {
  const raw = $("imgOneUrl").value.trim();
  if (!raw) return;
  const btn = $("imgOneBtn"), status = $("imgStatus");
  btn.disabled = true;
  status.hidden = false; status.textContent = "Adding image…";
  try {
    const r = await fetch(`${BASE}/api/grab-one?url=${encodeURIComponent(raw)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.result) throw new Error(d.error || `Couldn't add image (${r.status})`);
    // Show it in the results grid alongside anything already there.
    imgMode = "grab";
    imgResults = [d.result, ...imgResults];
    renderImageResults();
    status.hidden = true;
    $("imgGrid").hidden = false; $("imgActions").hidden = false; $("imgResultsBar").hidden = false;
    $("imgPager").hidden = true;
    $("imgOneUrl").value = "";
    updateImgSelCount();
  } catch (err) {
    status.hidden = false;
    status.textContent = String(err.message || err);
    console.error("[splicer] add image by URL failed:", err);
  } finally {
    btn.disabled = false;
  }
}

function clearImgSelection() {
  imgSel.clear();
  $("imgGrid").querySelectorAll(".img-tile.sel").forEach((t) => t.classList.remove("sel"));
  updateImgSelCount();
}

// Clear ALL images out of the results grid (not just the selection).
function clearImgResults() {
  imgResults = [];
  imgSel.clear();
  $("imgGrid").innerHTML = "";
  $("imgGrid").hidden = true;
  $("imgActions").hidden = true;
  $("imgResultsBar").hidden = true;
  $("imgStatus").hidden = true;
  updateImgSelCount();
}

$("imgSearchBtn").addEventListener("click", runImageSearch);
$("imgQuery").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runImageSearch(); } });
$("imgGrabBtn").addEventListener("click", runImageGrab);
$("imgUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runImageGrab(); } });
$("imgOneBtn").addEventListener("click", runImageOne);
$("imgOneUrl").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runImageOne(); } });

// Pagination.
$("imgPrev").addEventListener("click", () => { if (imgPage > 1) { imgPage -= 1; fetchImagePage(); } });
$("imgNext").addEventListener("click", () => { imgPage += 1; fetchImagePage(); });

// Select all (current page) / Clear (everything, across pages).
$("imgSelectAll").addEventListener("click", () => {
  imgResults.forEach((it) => imgSel.set(it.url, it));
  $("imgGrid").querySelectorAll(".img-tile").forEach((t) => t.classList.add("sel"));
  updateImgSelCount();
});
$("imgClear").addEventListener("click", clearImgResults);

// Add selected search results straight into the current video (photo segments).
$("imgAddBtn").addEventListener("click", async () => {
  const btn = $("imgAddBtn"), status = $("imgStatus");
  const items = [...imgSel.values()];
  if (items.length === 0) return;
  const dur = Number($("imgDur").value) || 3;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Adding…";
  // Grabbed images are already downloaded locally; search results go via the proxy.
  const fetchUrls = items.map((it) =>
    it.preview ? `${BASE}${it.preview}` : `${BASE}/api/image-proxy?url=${encodeURIComponent(it.url)}`);
  const { added, failed } = await addPhotosFromFetchUrls(fetchUrls, dur);
  btn.textContent = orig;
  clearImgSelection();
  status.hidden = false;
  status.textContent =
    `Added ${added} image${added === 1 ? "" : "s"} to your video` +
    (failed ? ` (${failed} couldn't be downloaded)` : "") + ".";
  setTimeout(() => { if (status.textContent.startsWith("Added")) status.hidden = true; }, 6000);
});

// Save selected search/grab results to the user's computer (Downloads).
$("imgDownloadBtn").addEventListener("click", async () => {
  const btn = $("imgDownloadBtn");
  const items = [...imgSel.values()];
  if (items.length === 0) return;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  const entries = items.map((it) => ({
    fetchUrl: it.preview ? `${BASE}${it.preview}` : `${BASE}/api/image-proxy?url=${encodeURIComponent(it.url)}`,
    name: it.title || "image",
  }));
  const n = await saveImagesToDisk(entries);
  btn.textContent = orig; btn.disabled = false;
  showToast(savedMsg(n));
});

// A same-origin fetch URL for a result item (local for grabbed, proxy for search).
function itemFetchUrl(it) {
  return it.preview ? `${BASE}${it.preview}` : `${BASE}/api/image-proxy?url=${encodeURIComponent(it.url)}`;
}

// Download EVERY result (not just selected) to the user's computer.
$("imgDownloadAllBtn").addEventListener("click", async () => {
  if (imgResults.length === 0) return;
  const btn = $("imgDownloadAllBtn"); const orig = btn.textContent;
  btn.disabled = true; btn.textContent = `Saving ${imgResults.length}…`;
  const entries = imgResults.map((it) => ({ fetchUrl: itemFetchUrl(it), name: it.title || "image" }));
  const n = await saveImagesToDisk(entries);
  btn.textContent = orig; btn.disabled = false;
  showToast(savedMsg(n));
});

// Add EVERY result to the slideshow as photo segments.
$("imgAddAllBtn").addEventListener("click", async () => {
  if (imgResults.length === 0) return;
  const btn = $("imgAddAllBtn"); const orig = btn.textContent;
  btn.disabled = true; btn.textContent = `Adding ${imgResults.length}…`;
  const dur = Number($("imgDur").value) || 3;
  const { added, failed } = await addPhotosFromFetchUrls(imgResults.map(itemFetchUrl), dur);
  btn.textContent = orig; btn.disabled = false;
  showToast(`Added ${added} image${added === 1 ? "" : "s"} to your slideshow${failed ? ` (${failed} failed)` : ""}`);
});

// Save selected search results into the persistent library.
$("imgSaveBtn").addEventListener("click", async () => {
  const btn = $("imgSaveBtn"), status = $("imgStatus");
  const items = [...imgSel.values()].map((it) => ({ url: it.url, title: it.title, license: it.license, source: it.source }));
  if (items.length === 0) return;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    const r = await fetch(`${BASE}/api/library/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Save failed (${r.status})`);
    status.hidden = false;
    status.textContent =
      `Saved ${d.saved} to your library` +
      (d.skipped ? ` (${d.skipped} already saved)` : "") +
      (d.failed ? `, ${d.failed} failed` : "") + ".";
    clearImgSelection();
    await loadLibrary();
    setTimeout(() => { if (status.textContent.startsWith("Saved")) status.hidden = true; }, 6000);
  } catch (e) {
    status.hidden = false;
    status.textContent = "Couldn't save: " + (e.message || e);
  } finally {
    btn.textContent = orig;
  }
});

// ---- saved library ----
const libSel = new Set(); // selected library ids
let libItems = [];

function updateLibSelCount() {
  const n = libSel.size;
  $("libSelCount").textContent = `${n} selected`;
  $("libAddBtn").disabled = n === 0;
  $("libRemoveBtn").disabled = n === 0;
  $("libDownloadBtn").disabled = n === 0;
}

function renderLibrary() {
  const grid = $("libGrid"), empty = $("libEmpty"), actions = $("libActions"), count = $("libCount");
  // Drop selection entries for images that no longer exist.
  for (const id of [...libSel]) if (!libItems.some((it) => it.id === id)) libSel.delete(id);
  count.textContent = libItems.length ? `${libItems.length} saved` : "";
  if (libItems.length === 0) {
    grid.hidden = true; actions.hidden = true; empty.hidden = false;
    updateLibSelCount();
    return;
  }
  empty.hidden = true; grid.hidden = false; actions.hidden = false;
  grid.innerHTML = "";
  libItems.forEach((it, i) => {
    const tile = document.createElement("div");
    tile.className = "img-tile" + (libSel.has(it.id) ? " sel" : "");
    tile.dataset.id = it.id;
    tile.title = [it.title, it.license, it.source].filter(Boolean).join(" · ");

    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = it.title || "";
    img.src = `${BASE}${it.src}`;
    img.onerror = () => tile.classList.add("broken");

    const check = document.createElement("span");
    check.className = "img-check";
    check.textContent = "✓";

    const cap = document.createElement("span");
    cap.className = "img-cap";
    cap.textContent = it.license || it.source || "image";

    const zoom = document.createElement("button");
    zoom.className = "img-zoom"; zoom.type = "button"; zoom.title = "Preview"; zoom.textContent = "⤢";
    zoom.addEventListener("click", (e) => { e.stopPropagation(); openLightbox("library", i); });

    tile.append(img, check, cap, zoom);
    tile.addEventListener("click", () => {
      if (libSel.has(it.id)) { libSel.delete(it.id); tile.classList.remove("sel"); }
      else { libSel.add(it.id); tile.classList.add("sel"); }
      updateLibSelCount();
    });
    grid.appendChild(tile);
  });
  updateLibSelCount();
}

async function loadLibrary() {
  try {
    const r = await fetch(`${BASE}/api/library`);
    const d = await r.json();
    libItems = d.items || [];
  } catch {
    libItems = [];
  }
  renderLibrary();
}

$("libAddBtn").addEventListener("click", async () => {
  const btn = $("libAddBtn");
  const ids = [...libSel];
  if (ids.length === 0) return;
  const dur = Number($("libDur").value) || 3;
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Adding…";
  const fetchUrls = ids.map((id) => `${BASE}/api/library/file/${id}`);
  const { added } = await addPhotosFromFetchUrls(fetchUrls, dur);
  btn.textContent = orig;
  updateLibSelCount();
  if (added) switchTab("viewSplicer"); // show them in the editor
});

$("libDownloadBtn").addEventListener("click", async () => {
  const btn = $("libDownloadBtn");
  const ids = [...libSel];
  if (ids.length === 0) return;
  const byId = new Map(libItems.map((it) => [it.id, it]));
  const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Saving…";
  const entries = ids.map((id) => ({
    fetchUrl: `${BASE}/api/library/file/${id}`,
    name: (byId.get(id) || {}).title || "image",
  }));
  const n = await saveImagesToDisk(entries);
  btn.textContent = orig; updateLibSelCount();
  showToast(savedMsg(n));
});

$("libRemoveBtn").addEventListener("click", async () => {
  const ids = [...libSel];
  if (ids.length === 0) return;
  if (!confirm(`Remove ${ids.length} saved image${ids.length === 1 ? "" : "s"} from your library?`)) return;
  for (const id of ids) {
    try { await fetch(`${BASE}/api/library/${id}`, { method: "DELETE" }); }
    catch (e) { console.warn("[splicer] library delete failed:", id, e); }
  }
  libSel.clear();
  await loadLibrary();
});

// ---- image preview lightbox (with full-screen) ----
let lbKind = "search"; // "search" | "library"
let lbIndex = 0;

function lbCount() { return lbKind === "library" ? libItems.length : imgResults.length; }
function lbItemAt(i) {
  if (lbKind === "library") {
    const it = libItems[i];
    return it && { key: it.id, src: `${BASE}${it.src}`, title: it.title, license: it.license, source: it.source, selected: libSel.has(it.id) };
  }
  const it = imgResults[i];
  return it && { key: it.url, src: it.preview ? `${BASE}${it.preview}` : it.url, title: it.title, license: it.license, source: it.source, selected: imgSel.has(it.url) };
}

function renderLightbox() {
  const it = lbItemAt(lbIndex);
  if (!it) return;
  $("lbImg").src = it.src;
  $("lbImg").alt = it.title || "";
  const cap = [it.title, it.license, it.source].filter(Boolean).join(" · ") || "Image";
  $("lbCap").textContent = cap;
  $("lbPrev").disabled = lbIndex <= 0;
  $("lbNext").disabled = lbIndex >= lbCount() - 1;
  const sel = $("lbSelect");
  sel.textContent = it.selected ? "✓ Selected" : "Select";
  sel.classList.toggle("primary", !it.selected);
}

function openLightbox(kind, index) {
  lbKind = kind;
  lbIndex = index;
  $("imgLightbox").hidden = false;
  renderLightbox();
  document.addEventListener("keydown", lbKeyHandler);
}

function closeLightbox() {
  $("imgLightbox").hidden = true;
  document.removeEventListener("keydown", lbKeyHandler);
  if (document.fullscreenElement) { try { document.exitFullscreen(); } catch {} }
}

function lbGo(delta) {
  const next = lbIndex + delta;
  if (next < 0 || next >= lbCount()) return;
  lbIndex = next;
  renderLightbox();
}

function lbToggleSelect() {
  const it = lbItemAt(lbIndex);
  if (!it) return;
  if (lbKind === "library") {
    if (libSel.has(it.key)) libSel.delete(it.key); else libSel.add(it.key);
    const tile = $("libGrid").querySelector(`.img-tile[data-id="${CSS.escape(it.key)}"]`);
    if (tile) tile.classList.toggle("sel", libSel.has(it.key));
    updateLibSelCount();
  } else {
    if (imgSel.has(it.key)) imgSel.delete(it.key); else imgSel.set(it.key, imgResults[lbIndex]);
    const tile = $("imgGrid").querySelector(`.img-tile[data-url="${CSS.escape(it.key)}"]`);
    if (tile) tile.classList.toggle("sel", imgSel.has(it.key));
    updateImgSelCount();
  }
  renderLightbox();
}

function lbToggleFull() {
  const el = $("imgLightbox");
  if (document.fullscreenElement) {
    try { document.exitFullscreen(); } catch {}
  } else {
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { try { req.call(el); } catch {} }
  }
}

function lbKeyHandler(e) {
  if (e.key === "Escape") { if (!document.fullscreenElement) closeLightbox(); }
  else if (e.key === "ArrowLeft") lbGo(-1);
  else if (e.key === "ArrowRight") lbGo(1);
}

// A same-origin fetch URL for the current lightbox image (avoids CORS on remote).
function lbFetchUrl() {
  if (lbKind === "library") {
    const it = libItems[lbIndex];
    return it ? `${BASE}/api/library/file/${it.id}` : null;
  }
  const it = imgResults[lbIndex];
  if (!it) return null;
  return it.preview ? `${BASE}${it.preview}` : `${BASE}/api/image-proxy?url=${encodeURIComponent(it.url)}`;
}

$("lbClose").addEventListener("click", closeLightbox);
$("lbPrev").addEventListener("click", () => lbGo(-1));
$("lbNext").addEventListener("click", () => lbGo(1));
$("lbSelect").addEventListener("click", lbToggleSelect);
$("lbFull").addEventListener("click", lbToggleFull);
$("lbDownload").addEventListener("click", async () => {
  const it = lbItemAt(lbIndex);
  const n = await saveImagesToDisk([{ fetchUrl: lbFetchUrl(), name: (it && it.title) || "image" }]);
  showToast(savedMsg(n));
});
// Click the dark backdrop (but not the image or controls) to close.
$("imgLightbox").addEventListener("click", (e) => { if (e.target === $("imgLightbox")) closeLightbox(); });
document.addEventListener("fullscreenchange", () => {
  $("lbFull").textContent = document.fullscreenElement ? "⤢ Exit full screen" : "⛶ Full screen";
});
