/**
 * Survival Wrapped – Story Template
 * (Fix-Version inkl. makeBadges)
 */

const STORY = [
  {
    type: "stat",
    kicker: "SURVIVAL WRAPPED",
    title: "Survival 5",
    sub: "Unser Serverjahr in Zahlen – klick dich durch.",
    big: "2025",
    badges: ["mc.benexlo.de", "Java + Bedrock"],
  },
  {
    type: "image",
    src: "assets/slides/01.jpg",
    title: "Willkommen zurück.",
    sub: "Das war unser Jahr – Builds, Chaos und Lore.",
  },
  {
    type: "image",
    src: "assets/slides/02.jpg",
    title: "Highlights",
    sub: "Das ist ein Testbild aus assets/slides/02.jpg",
  },
  {
    type: "end",
    kicker: "GG",
    title: "Das war’s.",
    sub: "Link im Discord teilen – nächstes Jahr wird’s wilder.",
    badges: ["Danke fürs Spielen ❤️"],
    ctaPrimary: { label: "Nochmal", action: "restart" },
    ctaSecondary: { label: "Link kopieren", action: "share" },
  }
];

const stage = document.getElementById("stage");
const progress = document.getElementById("progress");
const zonePrev = document.getElementById("zonePrev");
const zoneNext = document.getElementById("zoneNext");
const btnShare = document.getElementById("btnShare");
const btnInfo = document.getElementById("btnInfo");

const modal = document.getElementById("modal");
const btnClose = document.getElementById("btnClose");
const toast = document.getElementById("toast");

let idx = clamp(getIndexFromHash(), 0, STORY.length - 1);

buildProgress();
preloadImages();
render();

zonePrev.addEventListener("click", prev);
zoneNext.addEventListener("click", next);
btnShare.addEventListener("click", share);
btnInfo.addEventListener("click", () => openModal(true));
btnClose.addEventListener("click", () => openModal(false));
modal.addEventListener("click", (e) => { if (e.target === modal) openModal(false); });

window.addEventListener("keydown", (e) => {
  if (modal.getAttribute("aria-hidden") === "false") {
    if (e.key === "Escape") openModal(false);
    return;
  }
  if (e.key === "ArrowLeft") prev();
  if (e.key === "ArrowRight" || e.key === " " || e.key === "Enter") next();
  if (e.key.toLowerCase() === "i") openModal(true);
});

setupSwipe();
window.addEventListener("hashchange", () => {
  idx = clamp(getIndexFromHash(), 0, STORY.length - 1);
  render();
});

function render() {
  stage.innerHTML = "";
  history.replaceState(null, "", `#${idx + 1}`);
  updateProgress();

  const slide = STORY[idx];
  const card = document.createElement("article");
  card.className = "card";

  if (slide.type === "image") {
    card.appendChild(renderImage(slide));
  } else {
    card.appendChild(renderCard(slide));
  }

  stage.appendChild(card);
}

function renderCard(slide) {
  const wrap = document.createElement("div");
  wrap.className = "content";

  const top = document.createElement("div");
  top.innerHTML = `
    <div class="kicker">${escapeHtml(slide.kicker ?? "")}</div>
    <div class="title">${escapeHtml(slide.title ?? "")}</div>
    ${slide.sub ? `<div class="sub">${escapeHtml(slide.sub)}</div>` : ""}
  `;
  wrap.appendChild(top);

  const mid = document.createElement("div");

  if (slide.type === "stat") {
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = slide.big ?? "";
    mid.appendChild(big);

    if (slide.badges?.length) mid.appendChild(makeBadges(slide.badges));
  }

  if (slide.type === "end") {
    const big = document.createElement("div");
    big.className = "big";
    big.textContent = "🎉";
    mid.appendChild(big);

    if (slide.badges?.length) mid.appendChild(makeBadges(slide.badges));

    const row = document.createElement("div");
    row.className = "ctaRow";
    if (slide.ctaPrimary) row.appendChild(makeCtaButton(slide.ctaPrimary, false));
    if (slide.ctaSecondary) row.appendChild(makeCtaButton(slide.ctaSecondary, true));
    mid.appendChild(document.createElement("div")).className = "hr";
    mid.appendChild(row);
  }

  wrap.appendChild(mid);

  const bottom = document.createElement("div");
  bottom.className = "sub";
  bottom.innerHTML = `<span style="opacity:.75">Slide ${idx + 1} / ${STORY.length}</span>`;
  wrap.appendChild(bottom);

  return wrap;
}

function renderImage(slide) {
  const frag = document.createDocumentFragment();

  const imgWrap = document.createElement("div");
  imgWrap.className = "imageWrap";
  const img = document.createElement("img");
  img.src = slide.src;
  img.alt = slide.title ?? `Slide ${idx + 1}`;
  img.loading = "eager";
  imgWrap.appendChild(img);

  const overlay = document.createElement("div");
  overlay.className = "imageOverlay";

  const cap = document.createElement("div");
  cap.className = "imageCaption";
  cap.innerHTML = `
    <div class="kicker">${escapeHtml(slide.kicker ?? "MOMENT")}</div>
    <div class="title">${escapeHtml(slide.title ?? "")}</div>
    ${slide.sub ? `<div class="sub">${escapeHtml(slide.sub)}</div>` : ""}
  `;

  frag.appendChild(imgWrap);
  frag.appendChild(overlay);
  frag.appendChild(cap);
  return frag;
}

function buildProgress() {
  progress.innerHTML = "";
  for (let i = 0; i < STORY.length; i++) {
    const seg = document.createElement("div");
    seg.className = "seg";
    const fill = document.createElement("i");
    seg.appendChild(fill);
    progress.appendChild(seg);
  }
}

function updateProgress() {
  const fills = [...progress.querySelectorAll(".seg > i")];
  fills.forEach((f, i) => {
    f.style.width = i <= idx ? "100%" : "0%";
  });
}

function prev() {
  idx = clamp(idx - 1, 0, STORY.length - 1);
  render();
}
function next() {
  idx = clamp(idx + 1, 0, STORY.length - 1);
  render();
}
function restart() {
  idx = 0;
  render();
}

async function share() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link kopiert ✅");
  } catch {
    window.prompt("Kopiere den Link:", url);
  }
}

function makeCtaButton(cta, secondary) {
  const btn = document.createElement("button");
  btn.className = secondary ? "btn secondary" : "btn";
  btn.textContent = cta.label;

  btn.addEventListener("click", () => {
    if (cta.action === "restart") restart();
    if (cta.action === "share") share();
    if (cta.action === "next") next();
  });

  return btn;
}

/** ✅ DAS war bei dir fehlend */
function makeBadges(badges) {
  const row = document.createElement("div");
  row.className = "badges";
  (badges || []).forEach((b) => {
    const span = document.createElement("span");
    span.className = "badge";
    span.textContent = String(b);
    row.appendChild(span);
  });
  return row;
}

function openModal(open) {
  modal.setAttribute("aria-hidden", open ? "false" : "true");
}

let toastTimer = null;
function showToast(msg) {
  toast.textContent = msg;
  toast.setAttribute("aria-hidden", "false");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.setAttribute("aria-hidden", "true"), 1800);
}

function setupSwipe() {
  let startX = 0, startY = 0, active = false;

  window.addEventListener("touchstart", (e) => {
    if (!e.touches || e.touches.length !== 1) return;
    active = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  window.addEventListener("touchend", (e) => {
    if (!active) return;
    active = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
      return;
    }
    next(); // tap
  }, { passive: true });
}

function preloadImages() {
  STORY.forEach(s => {
    if (s.type === "image" && s.src) {
      const img = new Image();
      img.src = s.src;
    }
  });
}

function getIndexFromHash() {
  const h = window.location.hash.replace("#", "").trim();
  const n = Number(h);
  if (!Number.isFinite(n) || n < 1) return 0;
  return n - 1;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function escapeHtml(str) {
  const map = { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" };
  return String(str).replace(/[&<>"']/g, (m) => map[m]);
}
