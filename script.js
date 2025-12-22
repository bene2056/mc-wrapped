(() => {
  "use strict";

  // ===== Config =====
  const TOTAL_SLIDES = 12;
  const SUMMARY_SLIDES = new Set([5, 10, 11]);

  const IMAGE_DURATION_MS = 15_000; // 15 seconds
  const LONG_PRESS_MS = 250;

  const MOVE_CANCEL_LONG_PRESS_PX = 12;
  const SWIPE_THRESHOLD_PX = 50;
  const SWIPE_MAX_VERTICAL_PX = 90;

  const STORAGE_KEY_MUTED = "mcWrappedMuted";

  const reducedMotion =
    !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ===== DOM =====
  const $ = (sel) => document.querySelector(sel);

  const storyEl = $("#story");
  const mediaHost = $("#mediaHost");
  const placeholderEl = $("#placeholder");
  const missingPathEl = $("#missingPath");

  const muteBtn = $("#muteBtn");
  const pauseBtn = $("#pauseBtn");

  const downloadWrap = $("#downloadWrap");
  const downloadBtn = $("#downloadBtn");

  const replayOverlay = $("#replayOverlay");
  const replayBtn = $("#replayBtn");

  const toastEl = $("#toast");

  const audioHintEl = $("#audioHint");
  const enableAudioBtn = $("#enableAudioBtn");

  const progressFills = Array.from(document.querySelectorAll(".progress-fill"));

  if (!storyEl || progressFills.length !== TOTAL_SLIDES) {
    // Fail loudly but safely.
    console.error("Wrapped viewer: missing required DOM elements.");
    return;
  }

  // ===== Icons =====
  const ICONS = {
    soundOn: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 10v4a1 1 0 0 0 1 1h3l4 3a1 1 0 0 0 1.6-.8V6.8a1 1 0 0 0-1.6-.8l-4 3H4a1 1 0 0 0-1 1zm13.5 2a3.5 3.5 0 0 0-2.1-3.2 1 1 0 1 0-.8 1.8 1.5 1.5 0 0 1 0 2.8 1 1 0 0 0 .8 1.8A3.5 3.5 0 0 0 16.5 12zm2.8 0a6.3 6.3 0 0 0-3.8-5.8 1 1 0 1 0-.8 1.8A4.3 4.3 0 0 1 18.3 12a4.3 4.3 0 0 1-2.6 4 1 1 0 0 0 .8 1.8 6.3 6.3 0 0 0 3.8-5.8z"/>
      </svg>`,
    soundOff: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 10v4a1 1 0 0 0 1 1h3l4 3a1 1 0 0 0 1.6-.8V6.8a1 1 0 0 0-1.6-.8l-4 3H4a1 1 0 0 0-1 1zm13.3-.3a1 1 0 0 0-1.4 1.4L16.6 12l-1.7 1.7a1 1 0 1 0 1.4 1.4L18 13.4l1.7 1.7a1 1 0 0 0 1.4-1.4L19.4 12l1.7-1.7a1 1 0 0 0-1.4-1.4L18 10.6l-1.7-1.7z"/>
      </svg>`,
    pause: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M7 5a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1zm10 0a1 1 0 0 1 1 1v12a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1z"/>
      </svg>`,
    play: `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M8 5.5a1 1 0 0 1 1.5-.9l10 6.5a1 1 0 0 1 0 1.7l-10 6.5A1 1 0 0 1 8 18.5v-13z"/>
      </svg>`,
  };

  // ===== Utility =====
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const pad2 = (n) => String(n).padStart(2, "0");

  const isFormField = (el) => {
    if (!el) return false;
    const tag = el.tagName;
    return (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      el.isContentEditable === true
    );
  };

  const isInUI = (el) => {
    if (!el || !(el instanceof Element)) return false;
    return !!el.closest(".ui-controls, .download-wrap, .replay-overlay, .audio-hint");
  };

  // ===== Toast =====
  let toastTimer = 0;
  function showToast(message, durationMs = 2500) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.classList.remove("show");
    }, durationMs);
  }

  // ===== Placeholder =====
  function showPlaceholder(text) {
    if (!placeholderEl || !missingPathEl) return;
    missingPathEl.textContent = text || "this slide";
    placeholderEl.hidden = false;
  }

  function hidePlaceholder() {
    if (!placeholderEl || !missingPathEl) return;
    placeholderEl.hidden = true;
    missingPathEl.textContent = "";
  }

  // ===== Progress =====
  function setSegmentFill(slideIndex, progress01) {
    const fill = progressFills[slideIndex - 1];
    if (!fill) return;
    fill.style.transform = `scaleX(${clamp(progress01, 0, 1)})`;
  }

  function resetProgressForSlide(activeSlide) {
    for (let i = 1; i <= TOTAL_SLIDES; i++) {
      if (i < activeSlide) setSegmentFill(i, 1);
      else if (i > activeSlide) setSegmentFill(i, 0);
      else setSegmentFill(i, 0);
    }
  }

  function fillAllProgress() {
    for (let i = 1; i <= TOTAL_SLIDES; i++) setSegmentFill(i, 1);
  }

  // ===== Slide meta detection =====
  /** @type {Array<null | {index:number,type:'image'|'video'|'missing',url:string,attempted:string[],downloadUrl:string|null}>} */
  const slideMetaCache = Array(TOTAL_SLIDES + 1).fill(null);
  const slideMetaPromises = Array(TOTAL_SLIDES + 1).fill(null);

  async function fileExists(url) {
    // GitHub Pages supports HEAD for static assets.
    // If HEAD is blocked, we try a tiny GET via Range.
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.ok) return true;
      if (res.status === 405 || res.status === 403) {
        const res2 = await fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: { Range: "bytes=0-0" },
        });
        return res2.ok;
      }
      return false;
    } catch {
      try {
        const res2 = await fetch(url, {
          method: "GET",
          cache: "no-store",
          headers: { Range: "bytes=0-0" },
        });
        return res2.ok;
      } catch {
        return false;
      }
    }
  }

  async function resolveSlideMeta(index) {
    const id = pad2(index);

    const videoUrl = `slides/${id}.mp4`;
    const imageUrl = `slides/${id}.jpg`;
    const attempted = [videoUrl, imageUrl];

    let type = "missing";
    let url = "";

    if (await fileExists(videoUrl)) {
      type = "video";
      url = videoUrl;
    } else if (await fileExists(imageUrl)) {
      type = "image";
      url = imageUrl;
    }

    let downloadUrl = null;
    if (SUMMARY_SLIDES.has(index)) {
      const dlPng = `downloads/${id}.png`;
      const dlJpg = `downloads/${id}.jpg`;

      if (await fileExists(dlPng)) downloadUrl = dlPng;
      else if (await fileExists(dlJpg)) downloadUrl = dlJpg;
      else if (type === "image" && url) downloadUrl = url;
    }

    return { index, type, url, attempted, downloadUrl };
  }

  function getSlideMeta(index) {
    if (index < 1 || index > TOTAL_SLIDES) {
      return Promise.resolve({
        index,
        type: "missing",
        url: "",
        attempted: [],
        downloadUrl: null,
      });
    }
    if (slideMetaCache[index]) return Promise.resolve(slideMetaCache[index]);
    if (slideMetaPromises[index]) return slideMetaPromises[index];

    slideMetaPromises[index] = resolveSlideMeta(index)
      .then((meta) => {
        slideMetaCache[index] = meta;
        return meta;
      })
      .catch((err) => {
        console.warn(`Wrapped viewer: failed to resolve slide ${index}`, err);
        const id = pad2(index);
        const meta = {
          index,
          type: "missing",
          url: "",
          attempted: [`slides/${id}.mp4`, `slides/${id}.jpg`],
          downloadUrl: null,
        };
        slideMetaCache[index] = meta;
        return meta;
      });

    return slideMetaPromises[index];
  }

  // ===== Preloading =====
  const preloadCache = new Map();

  function preloadSlide(index) {
    if (index < 1 || index > TOTAL_SLIDES) return;
    getSlideMeta(index).then((meta) => {
      if (!meta.url) return;
      if (preloadCache.has(meta.url)) return;

      if (meta.type === "image") {
        const img = new Image();
        img.src = meta.url;
        preloadCache.set(meta.url, img);
      } else if (meta.type === "video") {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.src = meta.url;
        v.muted = true;
        v.playsInline = true;
        v.setAttribute("playsinline", "");
        v.setAttribute("webkit-playsinline", "");
        try {
          v.load();
        } catch {
          // ignore
        }
        preloadCache.set(meta.url, v);
      }
    });
  }

  function preloadNeighbors(index) {
    preloadSlide(index + 1);
    preloadSlide(index - 1);
  }

  // ===== Music =====
  function looksLikeAutoplayBlocked(err) {
    if (!err) return true;
    const name = String(err.name || "");
    const msg = String(err.message || "").toLowerCase();
    return (
      name === "NotAllowedError" ||
      msg.includes("gesture") ||
      msg.includes("play() failed") ||
      msg.includes("not allowed")
    );
  }

  function showAudioHint(err) {
    if (!audioHintEl) return;
    if (!looksLikeAutoplayBlocked(err)) {
      showToast("Could not play music (missing/unsupported file).");
      return;
    }
    audioHintEl.hidden = false;
  }

  function hideAudioHint() {
    if (!audioHintEl) return;
    audioHintEl.hidden = true;
  }

  function createMusicManager() {
    const sources = {
      1: "music/track1.mp3",
      2: "music/track2.mp3",
      3: "music/track3.mp3",
    };

    /** @type {Record<number, HTMLAudioElement>} */
    const audios = {};

    for (const [k, src] of Object.entries(sources)) {
      const a = new Audio(src);
      a.preload = "auto";
      a.loop = true;
      a.volume = 1;
      audios[Number(k)] = a;
    }

    let muted = false;
    try {
      muted = localStorage.getItem(STORAGE_KEY_MUTED) === "1";
    } catch {
      muted = false;
    }

    let storyPaused = false;
    let desired = 0;
    let active = 0;
    let fadeRaf = 0;

    function stopFade() {
      if (fadeRaf) {
        cancelAnimationFrame(fadeRaf);
        fadeRaf = 0;
      }
    }

    function safePlay(audio) {
      try {
        const p = audio.play();
        if (p && typeof p.catch === "function") {
          p.then(() => hideAudioHint()).catch((err) => {
            if (!muted && !storyPaused && desired > 0) showAudioHint(err);
          });
        }
      } catch (err) {
        if (!muted && !storyPaused && desired > 0) showAudioHint(err);
      }
    }

    function stopAll({ resetTime = false } = {}) {
      stopFade();
      for (const a of Object.values(audios)) {
        a.pause();
        if (resetTime) {
          try {
            a.currentTime = 0;
          } catch {
            // ignore
          }
        }
        a.volume = 1;
      }
      desired = 0;
      active = 0;
    }

    function setMuted(nextMuted) {
      muted = !!nextMuted;
      try {
        localStorage.setItem(STORAGE_KEY_MUTED, muted ? "1" : "0");
      } catch {
        // ignore
      }

      if (muted) {
        stopFade();
        for (const a of Object.values(audios)) a.pause();
        hideAudioHint();
      } else {
        syncPlayback();
      }
    }

    function isMuted() {
      return muted;
    }

    function setStoryPaused(paused) {
      storyPaused = !!paused;
      if (storyPaused) {
        stopFade();
        for (const a of Object.values(audios)) a.pause();
      } else {
        syncPlayback();
      }
    }

    function transitionTo(trackNumber) {
      const next = audios[trackNumber];
      if (!next) return;

      if (active === trackNumber) {
        syncPlayback();
        return;
      }

      stopFade();

      const previous = active;
      const prevAudio = previous ? audios[previous] : null;
      active = trackNumber;

      // Stop unrelated tracks
      for (const [k, a] of Object.entries(audios)) {
        const key = Number(k);
        if (key !== previous && key !== trackNumber) {
          a.pause();
          try {
            a.currentTime = 0;
          } catch {
            // ignore
          }
          a.volume = 1;
        }
      }

      // Prepare next audio
      try {
        next.pause();
      } catch {}
      try {
        next.currentTime = 0;
      } catch {}

      if (muted || storyPaused) return;

      if (!reducedMotion && prevAudio) {
        next.volume = 0;
        safePlay(next);

        const fadeDuration = 800;
        const start = performance.now();
        const prevStartVol = clamp(prevAudio.volume, 0, 1);

        const step = (now) => {
          if (muted || storyPaused) {
            stopFade();
            return;
          }

          const t = clamp((now - start) / fadeDuration, 0, 1);
          prevAudio.volume = prevStartVol * (1 - t);
          next.volume = t;

          if (t < 1) {
            fadeRaf = requestAnimationFrame(step);
          } else {
            prevAudio.pause();
            try {
              prevAudio.currentTime = 0;
            } catch {}
            prevAudio.volume = 1;
            next.volume = 1;
            fadeRaf = 0;
          }
        };

        fadeRaf = requestAnimationFrame(step);
      } else {
        if (prevAudio) {
          prevAudio.pause();
          try {
            prevAudio.currentTime = 0;
          } catch {}
          prevAudio.volume = 1;
        }
        next.volume = 1;
        safePlay(next);
      }
    }

    function setDesiredTrack(trackNumber) {
      desired = trackNumber;

      if (desired === 0) {
        stopAll({ resetTime: false });
        return;
      }

      if (muted || storyPaused) return;
      transitionTo(desired);
    }

    function syncPlayback() {
      if (desired === 0 || muted || storyPaused) return;

      if (active !== desired) {
        transitionTo(desired);
        return;
      }

      const a = audios[active];
      if (!a) return;
      safePlay(a);
    }

    function tryEnableFromHint() {
      if (muted) return;
      syncPlayback();
    }

    return {
      setMuted,
      isMuted,
      setStoryPaused,
      setDesiredTrack,
      stopAll,
      tryEnableFromHint,
    };
  }

  const music = createMusicManager();

  // ===== Viewer state =====
  let currentSlide = 1;
  let navToken = 0;

  let started = false;
  let ended = false;

  let userPaused = false;
  let holdPaused = false;
  let systemPaused = false;

  /** @type {null | {duration:number, elapsed:number, startedAt:number|null}} */
  let timer = null;

  /** @type {number} */
  let rafId = 0;

  /** @type {'none'|'image'|'video'|'missing'} */
  let currentMediaType = "none";

  /** @type {HTMLVideoElement | null} */
  let currentVideoEl = null;

  let pendingAutoAdvance = false;
  let autoAdvanceInProgress = false;

  function isPaused() {
    return ended || userPaused || holdPaused || systemPaused;
  }

  function desiredTrackForSlide(slideIndex) {
    if (!started) return 0;
    if (slideIndex >= 11) return 3;
    if (slideIndex >= 6) return 2;
    return 1;
  }

  // ===== UI updates =====
  function updateMuteUI() {
    const muted = music.isMuted();
    muteBtn.innerHTML = muted ? ICONS.soundOff : ICONS.soundOn;
    muteBtn.setAttribute("aria-pressed", String(muted));
    muteBtn.setAttribute("aria-label", muted ? "Unmute music" : "Mute music");
  }

  function updatePauseUI() {
    pauseBtn.disabled = ended;
    const paused = isPaused();
    pauseBtn.innerHTML = paused ? ICONS.play : ICONS.pause;
    pauseBtn.setAttribute("aria-pressed", String(paused));
    pauseBtn.setAttribute("aria-label", paused ? "Resume" : "Pause");
  }

  function updateDownloadVisibilityForSlide(slideIndex, metaOrNull) {
    if (!downloadWrap || !downloadBtn) return;

    if (!SUMMARY_SLIDES.has(slideIndex)) {
      downloadWrap.hidden = true;
      downloadBtn.dataset.url = "";
      downloadBtn.classList.remove("is-disabled");
      downloadBtn.setAttribute("aria-disabled", "true");
      return;
    }

    downloadWrap.hidden = false;

    const url = metaOrNull && metaOrNull.downloadUrl ? metaOrNull.downloadUrl : "";
    downloadBtn.dataset.url = url;

    const available = !!url;
    downloadBtn.classList.toggle("is-disabled", !available);
    downloadBtn.setAttribute("aria-disabled", String(!available));
  }

  // ===== Timing helpers =====
  function startImageTimer(durationMs) {
    timer = { duration: durationMs, elapsed: 0, startedAt: null };
    if (!isPaused()) timer.startedAt = performance.now();
  }

  function pauseTimer() {
    if (!timer || timer.startedAt === null) return;
    timer.elapsed += performance.now() - timer.startedAt;
    timer.startedAt = null;
  }

  function resumeTimer() {
    if (!timer || timer.startedAt !== null) return;
    timer.startedAt = performance.now();
  }

  function getTimerProgress01() {
    if (!timer) return 0;
    const now = performance.now();
    const elapsed = timer.elapsed + (timer.startedAt ? now - timer.startedAt : 0);
    return clamp(elapsed / timer.duration, 0, 1);
  }

  function safePlayVideo(video) {
    try {
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
  }

  function applyPlaybackState() {
    const paused = isPaused();

    if (timer) {
      if (paused) pauseTimer();
      else resumeTimer();
    }

    if (currentVideoEl) {
      if (paused) currentVideoEl.pause();
      else {
        // Slide 1 should not autoplay until the story has started.
        if (currentSlide !== 1 || started) safePlayVideo(currentVideoEl);
      }
    }

    music.setStoryPaused(paused);
    updatePauseUI();

    if (!paused && pendingAutoAdvance) {
      pendingAutoAdvance = false;
      autoAdvance();
    }
  }

  // ===== Rendering =====
  function cleanupMedia() {
    pendingAutoAdvance = false;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    timer = null;

    if (currentVideoEl) {
      try {
        currentVideoEl.pause();
      } catch {}
      currentVideoEl.onended = null;
      currentVideoEl.onerror = null;
      currentVideoEl.onloadeddata = null;

      try {
        currentVideoEl.removeAttribute("src");
        currentVideoEl.load();
      } catch {}
      currentVideoEl = null;
    }

    currentMediaType = "none";
    mediaHost.innerHTML = "";
    hidePlaceholder();
  }

  function slideAllowsAutoplay(slideIndex) {
    return slideIndex !== 1;
  }

  function startProgressLoop(token) {
    if (rafId) cancelAnimationFrame(rafId);

    const loop = () => {
      if (token !== navToken) return;
      if (ended) return;

      const idx = currentSlide;
      let progress = 0;

      if (idx === 1 && !started) {
        progress = 0;
      } else if (currentMediaType === "video" && currentVideoEl && currentVideoEl.duration > 0) {
        progress = clamp(currentVideoEl.currentTime / currentVideoEl.duration, 0, 1);
      } else if ((currentMediaType === "image" || currentMediaType === "missing") && timer) {
        progress = getTimerProgress01();
      }

      setSegmentFill(idx, progress);

      if (!isPaused() && slideAllowsAutoplay(idx)) {
        if ((currentMediaType === "image" || currentMediaType === "missing") && timer && progress >= 1) {
          autoAdvance();
          return;
        }

        if (
          currentMediaType === "video" &&
          currentVideoEl &&
          currentVideoEl.duration > 0 &&
          currentVideoEl.currentTime >= currentVideoEl.duration - 0.05
        ) {
          autoAdvance();
          return;
        }
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
  }

  function mountImageOrMissing(meta, token) {
    currentMediaType = meta.type === "image" ? "image" : "missing";

    if (meta.type === "image" && meta.url) {
      const img = document.createElement("img");
      img.alt = `Slide ${meta.index}`;
      img.src = meta.url;
      img.decoding = "async";
      img.draggable = false;

      img.addEventListener(
        "load",
        () => {
          if (token !== navToken) return;
          hidePlaceholder();
        },
        { once: true }
      );

      img.addEventListener(
        "error",
        () => {
          if (token !== navToken) return;
          showPlaceholder(meta.attempted.join(" or "));
        },
        { once: true }
      );

      mediaHost.appendChild(img);
    } else {
      showPlaceholder(meta.attempted.join(" or "));
    }

    timer = null;
    if (slideAllowsAutoplay(meta.index)) startImageTimer(IMAGE_DURATION_MS);

    applyPlaybackState();
    startProgressLoop(token);
  }

  function mountVideo(meta, token) {
    currentMediaType = "video";

    const video = document.createElement("video");
    video.src = meta.url;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.controls = false;

    video.onloadeddata = () => {
      if (token !== navToken) return;
      hidePlaceholder();
    };

    video.onerror = () => {
      if (token !== navToken) return;

      showPlaceholder(meta.attempted.join(" or "));
      currentMediaType = "missing";
      currentVideoEl = null;

      timer = null;
      if (slideAllowsAutoplay(meta.index)) startImageTimer(IMAGE_DURATION_MS);

      applyPlaybackState();
      startProgressLoop(token);
    };

    video.onended = () => {
      if (token !== navToken) return;
      if (!slideAllowsAutoplay(meta.index)) return;
      if (isPaused()) {
        pendingAutoAdvance = true;
        return;
      }
      autoAdvance();
    };

    mediaHost.appendChild(video);
    currentVideoEl = video;

    timer = null;
    applyPlaybackState();
    startProgressLoop(token);
  }

  async function loadAndRenderSlide(slideIndex, token) {
    const meta = await getSlideMeta(slideIndex);
    if (token !== navToken) return;

    updateDownloadVisibilityForSlide(slideIndex, meta);

    if (meta.type === "video" && meta.url) mountVideo(meta, token);
    else mountImageOrMissing(meta, token);

    preloadNeighbors(slideIndex);
  }

  // ===== Navigation =====
  function goToSlide(targetSlide, { fromUser = false } = {}) {
    if (ended) return;

    autoAdvanceInProgress = false;

    const nextSlide = clamp(targetSlide, 1, TOTAL_SLIDES);
    const prevSlide = currentSlide;

    currentSlide = nextSlide;
    navToken += 1;
    const token = navToken;

    if (!started && prevSlide === 1 && nextSlide >= 2 && fromUser) {
      started = true;
    }

    resetProgressForSlide(currentSlide);

    if (replayOverlay) replayOverlay.hidden = true;

    updateDownloadVisibilityForSlide(currentSlide, null);

    cleanupMedia();

    music.setDesiredTrack(desiredTrackForSlide(currentSlide));
    updateMuteUI();

    loadAndRenderSlide(currentSlide, token).catch((err) => {
      console.warn("Wrapped viewer: failed to load slide", err);
      showPlaceholder("this slide");
      currentMediaType = "missing";
      timer = null;
      if (slideAllowsAutoplay(currentSlide)) startImageTimer(IMAGE_DURATION_MS);
      applyPlaybackState();
      startProgressLoop(token);
    });
  }

  function goNext({ fromUser = false } = {}) {
    if (ended) return;

    if (currentSlide >= TOTAL_SLIDES) {
      finishStory();
      return;
    }
    goToSlide(currentSlide + 1, { fromUser });
  }

  function goPrev({ fromUser = false } = {}) {
    if (ended) return;
    if (currentSlide <= 1) return;
    goToSlide(currentSlide - 1, { fromUser });
  }

  function autoAdvance() {
    if (autoAdvanceInProgress || ended) return;
    autoAdvanceInProgress = true;

    if (currentSlide >= TOTAL_SLIDES) {
      finishStory();
      return;
    }
    goToSlide(currentSlide + 1, { fromUser: false });
  }

  // ===== End / Replay =====
  function finishStory() {
    if (ended) return;

    ended = true;
    pendingAutoAdvance = false;

    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }

    if (timer) pauseTimer();
    if (currentVideoEl) currentVideoEl.pause();

    fillAllProgress();

    music.stopAll({ resetTime: true });
    hideAudioHint();

    if (downloadWrap) downloadWrap.hidden = true;

    updatePauseUI();

    if (replayOverlay) replayOverlay.hidden = false;

    try {
      replayBtn && replayBtn.focus({ preventScroll: true });
    } catch {}
  }

  function replayStory() {
    music.stopAll({ resetTime: true });
    hideAudioHint();

    ended = false;
    started = false;

    userPaused = false;
    holdPaused = false;
    systemPaused = false;

    pendingAutoAdvance = false;
    autoAdvanceInProgress = false;

    for (let i = 1; i <= TOTAL_SLIDES; i++) setSegmentFill(i, 0);

    if (replayOverlay) replayOverlay.hidden = true;

    updatePauseUI();
    updateMuteUI();

    goToSlide(1, { fromUser: true });
  }

  // ===== Download =====
  function triggerDownload(url, slideIndex) {
    const extMatch = url.match(/\.(png|jpe?g)$/i);
    const ext = extMatch ? extMatch[0].toLowerCase() : "";
    const filename = `wrapped-slide-${pad2(slideIndex)}${ext}`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ===== Buttons =====
  updateMuteUI();
  updatePauseUI();
  updateDownloadVisibilityForSlide(1, null);

  muteBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    const nextMuted = !music.isMuted();
    music.setMuted(nextMuted);
    updateMuteUI();
  });

  pauseBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (ended) return;
    userPaused = !userPaused;
    applyPlaybackState();
  });

  if (downloadBtn) {
    downloadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const url = downloadBtn.dataset.url || "";
      if (!url) {
        showToast("Download not available for this slide.");
        return;
      }
      triggerDownload(url, currentSlide);
    });
  }

  if (replayBtn) {
    replayBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      replayStory();
    });
  }

  if (enableAudioBtn) {
    enableAudioBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      music.tryEnableFromHint();
    });
  }

  // ===== Keyboard =====
  window.addEventListener("keydown", (e) => {
    if (ended) return;
    if (isFormField(e.target)) return;

    if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext({ fromUser: true });
      return;
    }

    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev({ fromUser: true });
      return;
    }

    if (e.code === "Space" || e.key === " ") {
      if (e.target instanceof Element && e.target.closest("button, a")) return;
      e.preventDefault();
      userPaused = !userPaused;
      applyPlaybackState();
    }
  });

  // ===== Tap / Swipe / Long press =====
  let pointerState = null;

  function onPointerDown(e) {
    if (ended) return;
    if (isInUI(e.target)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;

    try {
      storyEl.setPointerCapture(e.pointerId);
    } catch {}

    pointerState = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      longPressFired: false,
      longPressTimer: 0,
      pointerType: e.pointerType,
    };

    pointerState.longPressTimer = window.setTimeout(() => {
      if (!pointerState) return;
      pointerState.longPressFired = true;
      holdPaused = true;
      applyPlaybackState();
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e) {
    if (!pointerState || e.pointerId !== pointerState.id) return;

    const dx = e.clientX - pointerState.startX;
    const dy = e.clientY - pointerState.startY;

    if (!pointerState.moved && Math.hypot(dx, dy) > MOVE_CANCEL_LONG_PRESS_PX) {
      pointerState.moved = true;
      window.clearTimeout(pointerState.longPressTimer);
      pointerState.longPressTimer = 0;
    }
  }

  function onPointerUp(e) {
    if (!pointerState || e.pointerId !== pointerState.id) return;

    window.clearTimeout(pointerState.longPressTimer);
    pointerState.longPressTimer = 0;

    const dx = e.clientX - pointerState.startX;
    const dy = e.clientY - pointerState.startY;

    const longPressFired = pointerState.longPressFired;
    pointerState = null;

    if (longPressFired) {
      holdPaused = false;
      applyPlaybackState();
      return;
    }

    const isSwipe =
      Math.abs(dx) > SWIPE_THRESHOLD_PX &&
      Math.abs(dx) > Math.abs(dy) &&
      Math.abs(dy) < SWIPE_MAX_VERTICAL_PX;

    if (isSwipe) {
      if (dx < 0) goNext({ fromUser: true });
      else goPrev({ fromUser: true });
      return;
    }

    const rect = storyEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < rect.width / 2) goPrev({ fromUser: true });
    else goNext({ fromUser: true });
  }

  function onPointerCancel(e) {
    if (!pointerState || e.pointerId !== pointerState.id) return;

    window.clearTimeout(pointerState.longPressTimer);
    pointerState.longPressTimer = 0;

    const longPressFired = pointerState.longPressFired;
    pointerState = null;

    if (longPressFired) {
      holdPaused = false;
      applyPlaybackState();
    }
  }

  if (window.PointerEvent) {
    storyEl.addEventListener("pointerdown", onPointerDown, { capture: true });
    storyEl.addEventListener("pointermove", onPointerMove, { capture: true });
    storyEl.addEventListener("pointerup", onPointerUp, { capture: true });
    storyEl.addEventListener("pointercancel", onPointerCancel, { capture: true });
  } else {
    storyEl.addEventListener(
      "click",
      (e) => {
        if (ended) return;
        if (isInUI(e.target)) return;
        const rect = storyEl.getBoundingClientRect();
        const x = (e.clientX || 0) - rect.left;
        if (x < rect.width / 2) goPrev({ fromUser: true });
        else goNext({ fromUser: true });
      },
      { capture: true }
    );
  }

  storyEl.addEventListener("contextmenu", (e) => e.preventDefault());
  storyEl.addEventListener("dragstart", (e) => e.preventDefault());

  // Pause when hidden (prevents advancing in background)
  document.addEventListener("visibilitychange", () => {
    systemPaused = document.hidden;
    applyPlaybackState();
  });

  // ===== Boot =====
  resetProgressForSlide(1);
  goToSlide(1, { fromUser: false });

  // Warm up detection (non-blocking)
  window.setTimeout(() => {
    for (let i = 1; i <= TOTAL_SLIDES; i++) getSlideMeta(i);
  }, 0);
})();