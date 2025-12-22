/* Story Wrapped Viewer (12 slides)
 * Changes requested:
 * - Download button BELOW story (slides 5/10/11)
 * - Replay button BELOW story on last slide (no overlay)
 * - Last slide loops (video) / stays (image), no auto-advance beyond 12
 * - Remove hold-to-pause; center tap toggles pause (Instagram-like)
 * - Footer tips removed (handled in HTML)
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

const downloadBtnEl = document.getElementById("downloadBtn");
const replayBtn = document.getElementById("replayBtn");

const muteBtn = document.getElementById("muteBtn");
const pauseBtn = document.getElementById("pauseBtn");
const muteIcon = document.getElementById("muteIcon");
const pauseIcon = document.getElementById("pauseIcon");

const tapLeft = document.getElementById("tapLeft");
const tapCenter = document.getElementById("tapCenter");
const tapRight = document.getElementById("tapRight");

// State
let currentIndex = 0; // 0..11
let started = false;  // becomes true when user leaves slide 1 for the first time
let paused = false;

let rafId = null;

// Image timing
let imageStartTs = 0;
let imageElapsedMs = 0; // accumulates while running

// Current media element
let currentMedia = null; // <img> or <video> or null

// Optional: stop track3 after being on last slide for 15s (keeps original spirit)
let stopTrack3Timer = null;

// Resolved slides cache
// resolvedSlides[i] = { type: 'video'|'image'|'missing', url: string|null, downloadUrl: string|null }
const resolvedSlides = Array.from({ length: SLIDE_COUNT }, () => ({
  type: "missing",
  url: null,
  downloadUrl: null,
  resolved: false,
}));

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
  try {
    const r = await fetch(url, { method: "HEAD", cache: "no-cache" });
    if (r.ok) return true;
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
      downloadUrl: null,
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
      // else keep current (e.g. slide jpg if image)
    }
  }

  return resolvedSlides[i];
}

async function preResolveAll() {
  loadingEl.hidden = false;
  await resolveSlide(0);

  const tasks = [];
  for (let i = 1; i < SLIDE_COUNT; i++) tasks.push(resolveSlide(i));
  await Promise.all(tasks);

  loadingEl.hidden = true;
}

function setMuted(next) {
  muted = !!next;
  audio.muted = muted;
  muteIcon.textContent = muted ? "🔇" : "🔊";
}

function setPaused(next) {
  paused = !!next;
  pauseIcon.textContent = paused ? "▶" : "⏸";

  if (currentMedia && currentMedia.tagName === "VIDEO") {
    if (paused) currentMedia.pause();
    else currentMedia.play().catch(() => {});
  }

  // music pause/resume
  if (paused) {
    audio.pause();
  } else {
    if (started && !muted) audio.play().catch(() => {});
  }
}

function resetStopTrack3Timer() {
  if (stopTrack3Timer) {
    clearTimeout(stopTrack3Timer);
    stopTrack3Timer = null;
  }
}

function maybeStartStopTrack3Timer(slideNum) {
  resetStopTrack3Timer();
  if (slideNum === 12) {
    // Stop track 3 after 15s on last slide (optional behavior)
    stopTrack3Timer = setTimeout(() => {
      if (currentTrack === 3) {
        audio.pause();
      }
    }, 15000);
  }
}

function stopMusicHard() {
  resetStopTrack3Timer();
  audio.pause();
  audio.currentTime = 0;
}

function audioSrcForTrack(trackNum) {
  return `music/${pad2(trackNum)}.mp3`;
}

function ensureMusicForSlide(slideNum, userGesture = false) {
  if (!started) return;

  const wanted = trackForSlide(slideNum);
  if (wanted !== currentTrack) {
    switchTrack(wanted, userGesture);
  } else {
    if (!muted && audio.paused && !paused) {
      audio.play().catch(() => {
        if (userGesture) showToast("Audio konnte nicht gestartet werden (Browser Restriktion).");
      });
    }
  }

  maybeStartStopTrack3Timer(slideNum);
}

function switchTrack(nextTrack, userGesture = false) {
  currentTrack = nextTrack;
  const nextSrc = audioSrcForTrack(nextTrack);

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

      if (!muted && !paused) {
        audio.play().then(() => {
          let t = 0;
          const fadeIn = setInterval(() => {
            t++;
            audio.volume = Math.min(startVol, startVol * (t / steps));
            if (t >= steps) clearInterval(fadeIn);
          }, 40);
        }).catch(() => {
          if (userGesture) showToast("Audio blocked – tippe nochmal, um Musik zu aktivieren.");
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
  if (currentMedia) {
    currentMedia.pause?.();
    currentMedia.remove();
    currentMedia = null;
  }
}

function setCurrentProgress(pct) {
  const clamped = Math.max(0, Math.min(1, pct));
  segments[currentIndex].style.width = `${clamped * 100}%`;
}

function updateSlideLabel() {
  slideLabelEl.textContent = `${currentIndex + 1}/${SLIDE_COUNT}`;
}

function updateBelowButtons(resolved) {
  const slideNum = currentIndex + 1;

  // Download only on summary slides (if url known)
  if (SUMMARY_SLIDES.has(slideNum) && resolved?.downloadUrl) {
    downloadBtnEl.hidden = false;
    downloadBtnEl.href = resolved.downloadUrl;
    downloadBtnEl.setAttribute("download", `Survival5_Wrapped_2025_Slide_${pad2(slideNum)}`);
  } else {
    downloadBtnEl.hidden = true;
    downloadBtnEl.href = "#";
  }

  // Replay only on last slide
  replayBtn.hidden = slideNum !== 12;
}

function shouldAutoAdvance() {
  // Slide 1 never auto-advances, Slide 12 should not auto-advance (loop/stay)
  if (currentIndex === 0) return false;
  if (currentIndex === SLIDE_COUNT - 1) return false;
  return true;
}

async function renderSlide(index, userGesture = false) {
  resetStopTrack3Timer();

  currentIndex = Math.max(0, Math.min(SLIDE_COUNT - 1, index));
  updateSlideLabel();

  // progress: past slides full, next slides empty
  for (let i = 0; i < SLIDE_COUNT; i++) {
    if (i < currentIndex) segments[i].style.width = "100%";
    if (i > currentIndex) segments[i].style.width = "0%";
  }
  segments[currentIndex].style.width = "0%";

  clearStage();

  const resolved = await resolveSlide(currentIndex);
  updateBelowButtons(resolved);

  // Music selection (only after started)
  if (started) ensureMusicForSlide(currentIndex + 1, userGesture);

  if (resolved.type === "missing") {
    placeholderEl.hidden = false;
    imageStartTs = performance.now();
    imageElapsedMs = 0;

    // On last slide missing: just show placeholder and mark progress full
    if (currentIndex === SLIDE_COUNT - 1) setCurrentProgress(1);
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

    // If last slide is image: keep it on screen, progress full
    if (currentIndex === SLIDE_COUNT - 1) setCurrentProgress(1);
    return;
  }

  if (resolved.type === "video") {
    const v = document.createElement("video");
    v.src = resolved.url;
    v.playsInline = true;
    v.preload = "auto";
    v.muted = true;       // background music is separate
    v.controls = false;
    v.setAttribute("playsinline", "true");

    // Loop only on last slide
    v.loop = (currentIndex === SLIDE_COUNT - 1);

    currentMedia = v;
    stageEl.appendChild(v);

    v.addEventListener("ended", () => {
      // For last slide, it loops anyway; for others, next
      if (!paused && shouldAutoAdvance()) nextSlide(false);
    });

    if (!paused) {
      v.play().catch(() => {});
    }

    // If last slide: progress full (cleaner than looping progress)
    if (currentIndex === SLIDE_COUNT - 1) {
      setCurrentProgress(1);
    }

    return;
  }
}

function nextSlide(userGesture = false) {
  const next = currentIndex + 1;

  // Start story when leaving slide 1
  if (!started && currentIndex === 0) {
    started = true;
    currentTrack = 1;
    audio.src = audioSrcForTrack(1);
    audio.load();
  }

  // Do not advance beyond last slide
  if (next >= SLIDE_COUNT) return;

  renderSlide(next, userGesture);

  // Try to start audio on the same gesture
  if (userGesture && started && !muted && !paused) {
    audio.play().catch(() => {
      showToast("Audio blocked – tippe nochmal (Browser Restriktion).");
    });
  }
}

function prevSlide(userGesture = false) {
  const prev = Math.max(0, currentIndex - 1);
  renderSlide(prev, userGesture);

  if (userGesture && started && !muted && !paused) {
    audio.play().catch(() => {});
  }
}

function replay() {
  stopMusicHard();

  started = false;
  setPaused(false);

  // reset progress
  for (let i = 0; i < SLIDE_COUNT; i++) segments[i].style.width = "0%";

  renderSlide(0, true);
}

// Animation loop
function tick() {
  const resolved = resolvedSlides[currentIndex];

  if (!paused && shouldAutoAdvance()) {
    if (resolved?.type === "image" || resolved?.type === "missing") {
      const now = performance.now();
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
      if (dur) setCurrentProgress(v.currentTime / dur);
    }
  } else {
    // paused: keep progress stable
  }

  // keep music synced when running
  if (started && !muted && !paused) {
    ensureMusicForSlide(currentIndex + 1, false);
  }

  rafId = requestAnimationFrame(tick);
}

// Helpers
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

// Center tap toggles pause (Instagram-like)
tapCenter.addEventListener("click", (e) => {
  if (isInteractiveTarget(e.target)) return;
  setPaused(!paused);

  // If unpausing and audio should play, attempt start
  if (!paused && started && !muted) {
    audio.play().catch(() => {});
  }
});

// Keyboard
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;

  if (e.key === "ArrowRight") {
    nextSlide(true);
  } else if (e.key === "ArrowLeft") {
    prevSlide(true);
  } else if (e.key === " ") {
    e.preventDefault();
    setPaused(!paused);
    if (!paused && started && !muted) audio.play().catch(() => {});
  } else if (e.key.toLowerCase() === "m") {
    setMuted(!muted);
    if (!muted && started && !paused) audio.play().catch(() => {});
  }
});

// Swipe
let touchStartX = null;
let touchStartY = null;

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

  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  if (absX < 40 || absX < absY) return;

  if (dx < 0) nextSlide(true);
  else prevSlide(true);
}, { passive: true });

// Top controls
muteBtn.addEventListener("click", () => {
  setMuted(!muted);
  if (!muted && started && !paused) {
    audio.play().catch(() => {
      showToast("Audio blocked – tippe nochmal (Browser Restriktion).");
    });
  }
});

pauseBtn.addEventListener("click", () => {
  setPaused(!paused);
  if (!paused && started && !muted) audio.play().catch(() => {});
});

// Replay button below story
replayBtn.addEventListener("click", () => {
  replay();
});

// If tab hidden, pause (nice UX)
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPaused(true);
});

// Init
(async function init() {
  setMuted(false);
  setPaused(false);

  preResolveAll().catch(() => {});
  await renderSlide(0, false);

  storyEl.focus({ preventScroll: true });

  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);

  showToast("Wische / tippe rechts zum Start.", 1600);
})();
