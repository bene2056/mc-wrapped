/* Story Wrapped Viewer
 * - 12 slides (01..12), auto-detect .mp4 or .jpg
 * - Slide 1 does NOT auto-advance
 * - Images: 15s then next
 * - Videos: play (muted), next on ended
 * - Swipe/tap/arrow navigation
 * - Hold-to-pause + Space toggle + top pause button
 * - Music tracks: 01 (slides 2-5), 02 (slides 6-10), 03 (slides 11-12)
 * - Summary slides 5/10/11: download button
 */

const SLIDE_COUNT = 12;
const IMAGE_DURATION_MS = 15000;

// Summary slides that need download button
const SUMMARY_SLIDES = new Set([5, 10, 11]);

// Music mapping by slide number (1-based)
function trackForSlide(slideNum) {
  if (slideNum >= 11) return 3;
  if (slideNum >= 6) return 2;
  return 1;
}

// Elements
const storyEl = document.getElementById("story");
const stageEl = document.getElementById("stage");
const progressEl = document.getElementById("progress");
const slideLabelEl = document.getElementById("slideLabel");
const loadingEl = document.getElementById("loading");
const placeholderEl = document.getElementById("placeholder");
const toastEl = document.getElementById("toast");
const downloadRowEl = document.getElementById("downloadRow");
const downloadBtnEl = document.getElementById("downloadBtn");
const endcardEl = document.getElementById("endcard");
const replayBtn = document.getElementById("replayBtn");

const muteBtn = document.getElementById("muteBtn");
const pauseBtn = document.getElementById("pauseBtn");
const muteIcon = document.getElementById("muteIcon");
const pauseIcon = document.getElementById("pauseIcon");

const tapLeft = document.getElementById("tapLeft");
const tapRight = document.getElementById("tapRight");

// State
let currentIndex = 0; // 0..11
let started = false;  // becomes true when user leaves slide 1 for the first time
let ended = false;    // wrap complete endcard shown

let pausedToggle = false;
let pausedHold = false;

let rafId = null;

// Image timing
let imageStartTs = 0;
let imageElapsedMs = 0; // accumulates across pauses

// Current media element
let currentMedia = null; // <img> or <video> or null

// End timer (stop music after final visible for 15s)
let endMusicStopTimer = null;

// Swipe tracking
let touchStartX = null;
let touchStartY = null;

// Hold-to-pause
let holdTimer = null;

// Progress segments
const segments = [];
for (let i = 0; i < SLIDE_COUNT; i++) {
  const seg = document.createElement("div");
  seg.className = "seg";
  const fill = document.createElement("div");
  fill.className = "fill";
  seg.appendChild(fill);
  progressEl.appendChild(seg);
  segments.push(fill);
}

// Audio
const audio = new Audio();
audio.preload = "auto";
audio.loop = true;
audio.volume = 0.9;

let muted = false;
let currentTrack = 1;

// Resolved slides cache
// resolvedSlides[i] = { type: 'video'|'image'|'missing', url: string|null, downloadUrl: string|null }
const resolvedSlides = Array.from({ length: SLIDE_COUNT }, () => ({
  type: "missing",
  url: null,
  downloadUrl: null,
  resolved: false,
}));

function pad2(n) { return String(n).padStart(2, "0"); }

function showToast(msg, ms = 2200) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  window.clearTimeout(showToast._t);
  showToast._t = window.setTimeout(() => {
    toastEl.hidden = true;
  }, ms);
}

async function exists(url) {
  // Try HEAD first (fast on GitHub Pages), fallback to GET if needed.
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-cache" });
    if (r.ok) return true;
    // Some servers may not allow HEAD; fallback
  } catch (_) {}
  try {
    const r2 = await fetch(url, { method: "GET", cache: "no-cache" });
    return r2.ok;
  } catch (_) {
    return false;
  }
}

async function resolveSlide(i) {
  if (resolvedSlides[i].resolved) return resolvedSlides[i];
  const slideNum = i + 1;
  const base = pad2(slideNum);
  const mp4 = `slides/${base}.mp4`;
  const jpg = `slides/${base}.jpg`;

  // Try mp4 first, then jpg
  const hasMp4 = await exists(mp4);
  if (hasMp4) {
    resolvedSlides[i] = {
      type: "video",
      url: mp4,
      downloadUrl: null, // download from slide not required for videos
      resolved: true,
    };
  } else {
    const hasJpg = await exists(jpg);
    if (hasJpg) {
      resolvedSlides[i] = {
        type: "image",
        url: jpg,
        downloadUrl: jpg,
        resolved: true,
      };
    } else {
      resolvedSlides[i] = {
        type: "missing",
        url: null,
        downloadUrl: null,
        resolved: true,
      };
    }
  }

  // Download resolution for summary slides
  if (SUMMARY_SLIDES.has(slideNum)) {
    const dlPng = `downloads/${base}.png`;
    const dlJpg = `downloads/${base}.jpg`;

    const hasPng = await exists(dlPng);
    if (hasPng) {
      resolvedSlides[i].downloadUrl = dlPng;
    } else {
      const hasDlJpg = await exists(dlJpg);
      if (hasDlJpg) resolvedSlides[i].downloadUrl = dlJpg;
      // else keep whatever is set (e.g. slide jpg if it is image)
    }
  }

  return resolvedSlides[i];
}

async function preResolveAll() {
  loadingEl.hidden = false;
  // Resolve slide 1 first quickly for initial render
  await resolveSlide(0);

  // Resolve rest in background (still awaited, but we already can render slide 1 immediately)
  const tasks = [];
  for (let i = 1; i < SLIDE_COUNT; i++) tasks.push(resolveSlide(i));
  await Promise.all(tasks);

  loadingEl.hidden = true;
}

function effectivePaused() {
  return pausedToggle || pausedHold || ended;
}

function setMuted(next) {
  muted = !!next;
  audio.muted = muted;
  muteIcon.textContent = muted ? "🔇" : "🔊";
}

function setPausedToggle(next) {
  pausedToggle = !!next;
  pauseIcon.textContent = effectivePaused() ? "▶" : "⏸";
  applyPauseState();
}

function setPausedHold(next) {
  pausedHold = !!next;
  pauseIcon.textContent = effectivePaused() ? "▶" : "⏸";
  applyPauseState();
}

function applyPauseState() {
  const p = effectivePaused();
  if (currentMedia && currentMedia.tagName === "VIDEO") {
    if (p) currentMedia.pause();
    else {
      currentMedia.play().catch(() => {
        // if blocked, it will still progress only when user interacts
      });
    }
  }
}

function resetEndMusicStopTimer() {
  if (endMusicStopTimer) {
    clearTimeout(endMusicStopTimer);
    endMusicStopTimer = null;
  }
}

function stopMusic() {
  audio.pause();
  audio.currentTime = 0;
}

function audioSrcForTrack(trackNum) {
  return `music/${pad2(trackNum)}.mp3`;
}

function ensureMusicForSlide(slideNum, userGesture = false) {
  if (!started) return; // don't play anything before story start

  const wanted = trackForSlide(slideNum);
  if (wanted !== currentTrack) {
    // switch track cleanly with a tiny fade
    switchTrack(wanted, userGesture);
  } else {
    // ensure playing if should be
    if (!muted && audio.paused && !effectivePaused()) {
      audio.play().catch(() => {
        if (userGesture) showToast("Audio konnte nicht gestartet werden (Browser Restriktion).");
      });
    }
  }
}

function switchTrack(nextTrack, userGesture = false) {
  currentTrack = nextTrack;
  const nextSrc = audioSrcForTrack(nextTrack);

  // fade out then switch
  const startVol = audio.volume;
  const steps = 6;
  let s = 0;

  const fadeOut = setInterval(() => {
    s++;
    audio.volume = Math.max(0, startVol * (1 - s / steps));
    if (s >= steps) {
      clearInterval(fadeOut);
      audio.pause();
      audio.src = nextSrc;
      audio.load();
      audio.volume = 0;

      if (!muted && !effectivePaused()) {
        audio.play().then(() => {
          // fade in
          let t = 0;
          const fadeIn = setInterval(() => {
            t++;
            audio.volume = Math.min(startVol, startVol * (t / steps));
            if (t >= steps) clearInterval(fadeIn);
          }, 40);
        }).catch(() => {
          if (userGesture) showToast("Audio blocked – tippe einmal, um Musik zu aktivieren.");
          audio.volume = startVol;
        });
      } else {
        audio.volume = startVol;
      }
    }
  }, 40);
}

function clearStage() {
  placeholderEl.hidden = true;
  // remove old media
  if (currentMedia) {
    currentMedia.pause?.();
    currentMedia.remove();
    currentMedia = null;
  }
}

function setProgressForAll(doneIndexExclusive) {
  // set past slides to 100
  for (let i = 0; i < SLIDE_COUNT; i++) {
    if (i < doneIndexExclusive) segments[i].style.width = "100%";
    if (i > currentIndex) segments[i].style.width = "0%";
  }
}

function setCurrentProgress(pct) {
  const clamped = Math.max(0, Math.min(1, pct));
  segments[currentIndex].style.width = `${clamped * 100}%`;
}

function updateSlideLabel() {
  slideLabelEl.textContent = `Slide ${currentIndex + 1}/${SLIDE_COUNT}`;
}

function updateDownloadUI(resolved) {
  const slideNum = currentIndex + 1;
  if (SUMMARY_SLIDES.has(slideNum) && resolved?.downloadUrl) {
    downloadRowEl.hidden = false;
    downloadBtnEl.href = resolved.downloadUrl;
    downloadBtnEl.setAttribute("download", `Survival5_Wrapped_2025_Slide_${pad2(slideNum)}`);
  } else {
    downloadRowEl.hidden = true;
    downloadBtnEl.href = "#";
  }
}

function showEndcard(show) {
  endcardEl.hidden = !show;
  ended = !!show;
  pauseIcon.textContent = effectivePaused() ? "▶" : "⏸";
}

async function renderSlide(index, userGesture = false) {
  resetEndMusicStopTimer();
  showEndcard(false);

  currentIndex = Math.max(0, Math.min(SLIDE_COUNT - 1, index));
  updateSlideLabel();

  // progress baseline
  for (let i = 0; i < SLIDE_COUNT; i++) {
    if (i < currentIndex) segments[i].style.width = "100%";
    if (i > currentIndex) segments[i].style.width = "0%";
  }
  segments[currentIndex].style.width = "0%";

  clearStage();

  const resolved = await resolveSlide(currentIndex);
  updateDownloadUI(resolved);

  if (resolved.type === "missing") {
    placeholderEl.hidden = false;

    // treat missing as image timing (except slide 1)
    imageStartTs = performance.now();
    imageElapsedMs = 0;

    // music selection
    if (started) ensureMusicForSlide(currentIndex + 1, userGesture);
    return;
  }

  if (resolved.type === "image") {
    const img = document.createElement("img");
    img.alt = `Slide ${currentIndex + 1}`;
    img.src = resolved.url;
    currentMedia = img;
    stageEl.appendChild(img);

    imageStartTs = performance.now();
    imageElapsedMs = 0;

    if (started) ensureMusicForSlide(currentIndex + 1, userGesture);
    return;
  }

  if (resolved.type === "video") {
    const v = document.createElement("video");
    v.src = resolved.url;
    v.playsInline = true;
    v.preload = "auto";
    v.muted = true;       // IMPORTANT: avoid mixing; background music is separate
    v.controls = false;

    // For smoother playback on mobile:
    v.setAttribute("playsinline", "true");

    currentMedia = v;
    stageEl.appendChild(v);

    v.addEventListener("ended", () => {
      if (!effectivePaused()) nextSlide(false);
    });

    // Attempt play
    if (!effectivePaused()) {
      v.play().catch(() => {
        // If blocked, it will start after user gesture; okay.
      });
    }

    if (started) ensureMusicForSlide(currentIndex + 1, userGesture);
    return;
  }
}

function shouldAutoAdvance() {
  // slide 1 never auto-advances
  if (currentIndex === 0) return false;
  return true;
}

function nextSlide(userGesture = false) {
  if (ended) return;

  const next = currentIndex + 1;
  if (next >= SLIDE_COUNT) {
    completeWrapped();
    return;
  }

  // Starting point: leaving slide 1 triggers start
  if (!started && currentIndex === 0) {
    started = true;
    // Start track 1 here (slides 2-5), immediately after moving to slide 2
    currentTrack = 1;
    audio.src = audioSrcForTrack(1);
    audio.load();
  }

  renderSlide(next, userGesture);

  // On start: attempt to play audio on the same user gesture
  if (userGesture && started && !muted && !effectivePaused()) {
    audio.play().catch(() => {
      showToast("Audio blocked – tippe nochmal (Browser Restriktion).");
    });
  }
}

function prevSlide(userGesture = false) {
  if (ended) {
    showEndcard(false);
  }
  const prev = Math.max(0, currentIndex - 1);
  renderSlide(prev, userGesture);

  // If user goes back to slide 1, we keep started=true (story already started)
  // but we do NOT autoplay from slide 1 anyway.
}

function completeWrapped() {
  // show end overlay on top of last slide
  showEndcard(true);

  // stop music after 15 seconds visible on final state
  resetEndMusicStopTimer();
  endMusicStopTimer = setTimeout(() => {
    stopMusic();
  }, 15000);
}

function replay() {
  // Reset everything
  resetEndMusicStopTimer();
  stopMusic();

  started = false;
  ended = false;
  pausedToggle = false;
  pausedHold = false;
  pauseIcon.textContent = "⏸";

  // reset progress
  for (let i = 0; i < SLIDE_COUNT; i++) segments[i].style.width = "0%";

  renderSlide(0, true);
}

function tick() {
  // Update progress for current slide
  const resolved = resolvedSlides[currentIndex];

  if (!effectivePaused() && shouldAutoAdvance()) {
    if (resolved?.type === "image" || resolved?.type === "missing") {
      const now = performance.now();
      // add delta only while not paused
      const delta = now - imageStartTs;
      imageStartTs = now;
      imageElapsedMs += delta;

      const pct = Math.min(1, imageElapsedMs / IMAGE_DURATION_MS);
      setCurrentProgress(pct);

      if (imageElapsedMs >= IMAGE_DURATION_MS) {
        nextSlide(false);
      }
    } else if (resolved?.type === "video" && currentMedia && currentMedia.tagName === "VIDEO") {
      const v = currentMedia;
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      if (dur) {
        setCurrentProgress(v.currentTime / dur);
      } else {
        // if duration unknown, animate slowly to avoid 0% stuck
        // (won't be used for auto-advance, ended event still handles)
        setCurrentProgress(Math.min(0.95, (performance.now() % 5000) / 5000));
      }
    }
  } else {
    // paused: keep progress stable, but for video update fill if time changes (rare)
    if (resolved?.type === "video" && currentMedia && currentMedia.tagName === "VIDEO") {
      const v = currentMedia;
      const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : null;
      if (dur) setCurrentProgress(v.currentTime / dur);
    }
  }

  // Keep track consistent with current slide (if user jumps around)
  if (started && !muted && !effectivePaused()) {
    ensureMusicForSlide(currentIndex + 1, false);
  }

  rafId = requestAnimationFrame(tick);
}

// Interaction handlers
function isInteractiveTarget(target) {
  return !!target.closest("button, a");
}

// Tap navigation
tapLeft.addEventListener("click", (e) => {
  if (isInteractiveTarget(e.target)) return;
  prevSlide(true);
});
tapRight.addEventListener("click", (e) => {
  if (isInteractiveTarget(e.target)) return;
  nextSlide(true);
});

// Keyboard
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;

  if (e.key === "ArrowRight") {
    nextSlide(true);
  } else if (e.key === "ArrowLeft") {
    prevSlide(true);
  } else if (e.key === " ") {
    // Space toggles pause/resume
    e.preventDefault();
    setPausedToggle(!pausedToggle);
    // Try to start audio if unpaused and started
    if (!effectivePaused() && started && !muted) {
      audio.play().catch(() => {});
    }
  } else if (e.key.toLowerCase() === "m") {
    setMuted(!muted);
    if (!muted && started && !effectivePaused()) audio.play().catch(() => {});
  }
});

// Swipe
storyEl.addEventListener("touchstart", (e) => {
  if (isInteractiveTarget(e.target)) return;
  const t = e.touches[0];
  touchStartX = t.clientX;
  touchStartY = t.clientY;
}, { passive: true });

storyEl.addEventListener("touchend", (e) => {
  if (touchStartX == null || touchStartY == null) return;

  const t = e.changedTouches[0];
  const dx = t.clientX - touchStartX;
  const dy = t.clientY - touchStartY;

  touchStartX = null;
  touchStartY = null;

  // Threshold
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 40 || absX < absY) return;

  if (dx < 0) nextSlide(true);
  else prevSlide(true);
}, { passive: true });

// Hold-to-pause (press and hold)
function startHold(e) {
  if (isInteractiveTarget(e.target)) return;
  clearTimeout(holdTimer);
  holdTimer = setTimeout(() => {
    setPausedHold(true);
  }, 220);
}
function endHold() {
  clearTimeout(holdTimer);
  holdTimer = null;
  setPausedHold(false);
}

storyEl.addEventListener("pointerdown", startHold);
storyEl.addEventListener("pointerup", endHold);
storyEl.addEventListener("pointercancel", endHold);
storyEl.addEventListener("pointerleave", endHold);

// Top controls
muteBtn.addEventListener("click", () => {
  setMuted(!muted);
  if (!muted && started && !effectivePaused()) {
    audio.play().catch(() => {
      showToast("Audio blocked – tippe nochmal (Browser Restriktion).");
    });
  }
});

pauseBtn.addEventListener("click", () => {
  setPausedToggle(!pausedToggle);
  if (!effectivePaused() && started && !muted) audio.play().catch(() => {});
});

downloadBtnEl.addEventListener("click", () => {
  // keep story running; user wanted it not to break timing
  // This just triggers download. (No extra logic required.)
});

replayBtn.addEventListener("click", () => {
  replay();
});

// If tab is hidden, pause (nice UX)
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPausedToggle(true);
});

// Init
(async function init() {
  setMuted(false);
  setPausedToggle(false);

  // Resolve slides in background
  preResolveAll().catch(() => {});

  // Render slide 1 immediately (after it resolves)
  await renderSlide(0, false);

  // Focus for keyboard
  storyEl.focus({ preventScroll: true });

  // Start animation loop
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);

  // Initial hint
  showToast("Tippe rechts / wische, um zu starten.", 1800);
})();
