// Motion for the public landing page (/welcome). Plain JavaScript, no build
// step. Everything here is decoration: the page is complete without it.
import Lenis from "./vendor/lenis.js";

const root = document.documentElement;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hoverable = matchMedia("(hover: hover) and (min-width: 769px)").matches;

// Above 1920px wide, scale the rem grid up gently instead of capping it.
function adaptiveGrid() {
  const width = window.innerWidth;
  const size = 16 - (16 * (((1920 - width) / 1920) * 100 * 0.6666)) / 100;
  if (size > 16) root.style.fontSize = `${size}px`;
  else root.style.removeProperty("font-size");
}
adaptiveGrid();
addEventListener("resize", adaptiveGrid);

// Smooth scroll.
let lenis = null;
if (!reduce) {
  lenis = new Lenis({ smoothWheel: true });
  const raf = (time) => {
    lenis.raf(time);
    requestAnimationFrame(raf);
  };
  requestAnimationFrame(raf);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const later = (el, ms) => setTimeout(() => el.classList.add("in"), ms);

// Hero name: one span per letter.
const letterLines = [...document.querySelectorAll("[data-letters]")];
for (const line of letterLines) {
  const text = line.textContent;
  line.textContent = "";
  Array.from(text).forEach((letter, index) => {
    const char = document.createElement("span");
    char.className = "char";
    char.textContent = letter;
    char.style.transitionDelay = `${index * 52}ms`;
    line.append(char);
  });
}

// Headings: words grouped into the lines the browser actually wrapped them
// into, so each visual line can rise on its own. Restored to plain text once
// shown, so later resizes wrap normally.
function splitLines(el) {
  const text = el.textContent.trim();
  el.textContent = "";
  const words = text.split(/\s+/).map((word) => {
    const span = document.createElement("span");
    span.textContent = `${word} `;
    el.append(span);
    return span;
  });
  const lines = [];
  for (const word of words) {
    const top = word.offsetTop;
    const last = lines.at(-1);
    if (last && Math.abs(last.top - top) < 4) last.words.push(word.textContent);
    else lines.push({ top, words: [word.textContent] });
  }
  el.textContent = "";
  lines.forEach((line, index) => {
    const outer = document.createElement("span");
    outer.className = "line";
    const inner = document.createElement("span");
    inner.className = "line-unit";
    inner.textContent = line.words.join("").trimEnd();
    inner.style.transitionDelay = `${index * 90}ms`;
    outer.append(inner);
    el.append(outer);
  });
  el.dataset.text = text;
}

function splitWords(el) {
  const text = el.dataset.text ?? el.textContent.trim();
  el.dataset.text = text;
  el.textContent = "";
  text.split(/\s+/).forEach((word, index) => {
    const span = document.createElement("span");
    span.className = "word";
    span.textContent = word;
    span.style.transitionDelay = `${index * 22}ms`;
    el.append(span, " ");
  });
}

const headings = [...document.querySelectorAll("[data-lines]")];
if (!reduce) {
  for (const heading of headings) heading.setAttribute("aria-label", heading.textContent.trim());
  await document.fonts?.ready;
  headings.forEach(splitLines);
}

// Scroll-triggered reveals, once.
const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      observer.unobserve(el);
      later(el, Number(el.dataset.delay ?? 0));
      if (el.matches("[data-lines]")) {
        setTimeout(() => {
          el.textContent = el.dataset.text ?? el.textContent;
        }, 1600);
      }
    }
  },
  { threshold: 0 },
);
for (const el of document.querySelectorAll("[data-reveal], [data-lines]")) {
  observer.observe(el);
}

// Preloader, once per visit.
async function preload() {
  const loader = document.querySelector(".preloader");
  if (!loader) return;
  if (reduce || sessionStorage.getItem("seo-pilot-loaded")) {
    loader.classList.add("done");
    return;
  }
  sessionStorage.setItem("seo-pilot-loaded", "1");
  lenis?.stop();
  scrollTo(0, 0);
  const count = loader.querySelector("[data-count]");
  const start = performance.now();
  await new Promise((resolve) => {
    const tick = (now) => {
      const progress = Math.min((now - start) / 2000, 1);
      count.textContent = String(Math.round(progress * 100));
      if (progress < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  loader.classList.add("fade");
  await wait(500);
  loader.classList.add("wipe");
  await wait(650);
  loader.classList.add("done");
  lenis?.start();
}

// Hero entrance, after the preloader.
function heroIn() {
  const nameLines = document.querySelectorAll(".hero-name [data-letters]");
  nameLines.forEach((line, index) => later(line, index * 240));
  document.querySelectorAll("[data-hero-role]").forEach((role, index) => {
    role.style.transitionDelay = `${200 + index * 80}ms`;
    role.classList.add("in");
  });
  later(document.querySelector("[data-hero-desc]"), 400);
  later(document.querySelector("[data-hero-cue]"), 900);
}

void preload().then(heroIn);

// Anchor links scroll smoothly and close the menu.
const burger = document.querySelector("[data-burger]");
const menu = document.querySelector("[data-menu]");
function setMenu(open) {
  burger.setAttribute("aria-expanded", String(open));
  burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  if (open) {
    menu.hidden = false;
    menu.querySelectorAll("a").forEach((link, index) => {
      link.style.transitionDelay = `${120 + index * 60}ms`;
    });
    requestAnimationFrame(() => menu.classList.add("open"));
    lenis?.stop();
  } else {
    menu.classList.remove("open");
    setTimeout(() => {
      if (!menu.classList.contains("open")) menu.hidden = true;
    }, 450);
    lenis?.start();
  }
}
burger?.addEventListener("click", () =>
  setMenu(burger.getAttribute("aria-expanded") !== "true"),
);
addEventListener("keydown", (event) => {
  if (event.key === "Escape" && burger?.getAttribute("aria-expanded") === "true") setMenu(false);
});

for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    const target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    event.preventDefault();
    if (burger?.getAttribute("aria-expanded") === "true") setMenu(false);
    if (lenis) lenis.scrollTo(target, { offset: -40 });
    else target.scrollIntoView({ behavior: reduce ? "auto" : "smooth" });
  });
}

// Install picker: hover or click selects; the text replays word by word.
const options = [...document.querySelectorAll("[data-install-option]")];
const panels = [...document.querySelectorAll("[data-install-panel]")];
function selectOption(index) {
  options.forEach((option, i) => {
    option.classList.toggle("active", i === index);
    option.setAttribute("aria-pressed", String(i === index));
  });
  panels.forEach((panel, i) => {
    panel.hidden = i !== index;
    if (i !== index || reduce) return;
    const text = panel.querySelector("[data-words]");
    splitWords(text);
    text.classList.remove("in");
    requestAnimationFrame(() => requestAnimationFrame(() => text.classList.add("in")));
  });
}
options.forEach((option, index) => {
  option.addEventListener("click", () => selectOption(index));
  if (hoverable) option.addEventListener("mouseenter", () => selectOption(index));
  option.addEventListener("focus", () => selectOption(index));
});
panels.forEach((panel, index) => {
  panel.hidden = index !== 0;
});

// Liquid hover: a loose spring on the displacement filter (desktop only).
const turbulence = document.querySelector("#liquid feTurbulence");
const displacement = document.querySelector("#liquid feDisplacementMap");
if (turbulence && displacement && hoverable && !reduce) {
  let value = 0;
  let velocity = 0;
  let target = 0;
  let running = false;
  let current = null;
  const step = () => {
    // tension 140, friction 13: watery wobble
    const force = 140 * (target - value) - 13 * velocity;
    velocity += force / 60 / 1;
    value += velocity / 60;
    displacement.setAttribute("scale", String(1 + value * 27));
    turbulence.setAttribute("baseFrequency", String(0.009 + value * 0.013));
    if (Math.abs(target - value) > 0.001 || Math.abs(velocity) > 0.001) {
      requestAnimationFrame(step);
    } else {
      running = false;
      if (target === 0) current?.classList.remove("liquid-on");
    }
  };
  const go = (to) => {
    target = to;
    if (!running) {
      running = true;
      requestAnimationFrame(step);
    }
  };
  for (const figure of document.querySelectorAll("[data-liquid]")) {
    figure.addEventListener("mouseenter", () => {
      if (current && current !== figure) current.classList.remove("liquid-on");
      current = figure;
      figure.classList.add("liquid-on");
      go(1);
    });
    figure.addEventListener("mouseleave", () => go(0));
  }
}
