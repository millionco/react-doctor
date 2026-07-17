import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnthrottledScrollMutation } from "./no-unthrottled-scroll-mutation.js";

const run = (code: string) => runRule(noUnthrottledScrollMutation, code, { filename: "scroll.ts" });

describe("no-unthrottled-scroll-mutation", () => {
  it("flags direct style mutation in a document scroll listener", () => {
    const result = run(
      'const hero = document.querySelector(".hero"); document.addEventListener("scroll", () => { hero.style.transform = "translateY(" + window.scrollY + "px)"; });',
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores a small class toggle whose visual effect is unknown", () => {
    const result = run(
      `const header = document.querySelector("header"); const sync = () => header.classList.toggle("compact", scrollY > 20); window.addEventListener("scroll", sync);`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a new Web Animation on every scroll event", () => {
    const result = run(
      `const hero = document.getElementById("hero"); window.addEventListener("scroll", () => hero.animate({ transform: "translateY(10px)" }, 100));`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts timer-throttled DOM work", () => {
    const result = run(
      `const hero = document.querySelector(".hero"); document.addEventListener("scroll", () => { setTimeout(() => { hero.style.opacity = "0"; }, 20); });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags animation work deferred only with requestAnimationFrame", () => {
    const result = run(
      `const hero = document.querySelector(".hero"); document.addEventListener("scroll", () => { requestAnimationFrame(() => { hero.style.transform = "translateY(10px)"; }); });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores a shadowed animation frame helper", () => {
    const result = run(
      `const requestAnimationFrame = (callback) => setTimeout(callback, 20); const hero = document.querySelector(".hero"); document.addEventListener("scroll", () => { requestAnimationFrame(() => { hero.style.transform = "translateY(10px)"; }); });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a pending-frame guard that coalesces scroll events", () => {
    const result = run(
      `let framePending = false; const hero = document.querySelector(".hero"); document.addEventListener("scroll", () => { if (!framePending) { framePending = true; requestAnimationFrame(() => { hero.style.transform = "translateY(10px)"; framePending = false; }); } });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not let an unrelated timer hide a direct animation write", () => {
    const result = run(
      `const hero = document.querySelector(".hero"); document.addEventListener("scroll", () => { setTimeout(trackScroll, 20); hero.style.transform = "translateY(10px)"; });`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts read-only scroll handlers", () => {
    const result = run(
      `document.addEventListener("scroll", () => analytics.track(window.scrollY));`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores non-animation style updates", () => {
    const result = run(
      `const button = document.querySelector("button"); window.addEventListener("scroll", () => { button.style.display = "block"; });`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores custom event emitters and unproven style-shaped objects", () => {
    const result = run(`emitter.addEventListener("scroll", () => { model.style.color = "red"; });`);
    expect(result.diagnostics).toEqual([]);
  });
});
