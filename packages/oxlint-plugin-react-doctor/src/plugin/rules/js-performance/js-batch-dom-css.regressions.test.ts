import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsBatchDomCss } from "./js-batch-dom-css.js";

describe("js-performance/js-batch-dom-css — regressions", () => {
  it.each(["$", "($)", "void ($)", "(0, $)"])(
    "flags layout-affecting writes through discarded wrapper %s",
    (wrapper) => {
      const heightWrite = wrapper.replaceAll("$", "row.style.height = `${height}px`");
      const widthWrite = wrapper.replaceAll("$", 'row.style.width = "100%"');
      const result = runRule(
        jsBatchDomCss,
        `function resizeRows(rows) {
          for (const row of rows) {
            const height = row.offsetHeight;
            ${heightWrite};
            ${widthWrite};
          }
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("stays silent when the styled element is created detached and appended after the writes", () => {
    const result = runRule(
      jsBatchDomCss,
      `
async function renderPages(doc, pages) {
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const cssWidth = pages.clientWidth;
    const canvas = document.createElement("canvas");
    canvas.style.width = "100%";
    canvas.style.height = "auto";
    canvas.style.display = "block";
    canvas.style.margin = "0 auto 8px";
    pages.appendChild(canvas);
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a detached canvas built inside a forEach and swapped in afterwards", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function snapshotImages(originalImages, clonedImages) {
  originalImages.forEach((orig, index) => {
    const clonedImg = clonedImages[index];
    const canvas = document.createElement("canvas");
    canvas.width = orig.offsetWidth;
    canvas.height = orig.offsetHeight;
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    canvas.style.display = "block";
    canvas.style.opacity = "1";
    clonedImg.parentNode?.replaceChild(canvas, clonedImg);
  });
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for write-only style resets in a loop with no layout reads", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function resetTrackHeaders(container) {
  const elements = container.querySelectorAll("[data-track-id]");
  for (const el of elements) {
    el.style.transform = "";
    el.style.zIndex = "";
    el.style.opacity = "";
    el.style.transition = "";
    el.style.boxShadow = "";
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for write-only style updates in a requestAnimationFrame loop", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function updateDragVisuals(container, draggedIds, offset) {
  const elements = container.querySelectorAll("[data-track-id]");
  for (const el of elements) {
    const trackId = el.getAttribute("data-track-id");
    if (trackId && draggedIds.has(trackId)) {
      el.style.transform = \`translateY(\${offset}px) scale(1.02)\`;
      el.style.zIndex = "100";
      el.style.opacity = "0.5";
    }
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for `.style` writes on plain layout-data records", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function getStyledEvents(styledEvents) {
  for (let i = 0; i < styledEvents.length; ++i) {
    const e = styledEvents[i];
    const padding = e.idx === 0 ? 0 : 3;
    e.style.width = \`calc(\${e.size}% - \${padding}px)\`;
    e.style.height = \`calc(\${e.style.height}% - 2px)\`;
    e.style.xOffset = \`calc(\${e.style.left}% + \${padding}px)\`;
  }
  return styledEvents;
}
`,
      { filename: "no-overlap.js" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a FLIP animation whose deliberate forced reflow sits between the writes", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function animateRows(rows, prevTops) {
  rows.forEach((el) => {
    const newTop = el.getBoundingClientRect().top;
    const prevTop = prevTops.get(el.id);
    const delta = prevTop - newTop;
    el.style.transform = \`translateY(\${delta}px)\`;
    el.style.transition = "none";
    el.getBoundingClientRect();
    el.style.transition = "transform 0.22s cubic-bezier(0.2, 0, 0, 1)";
    el.style.transform = "";
  });
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a measure helper that forces reflow via a discarded void read", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function measureButtonWidths(buttons) {
  buttons.forEach((button) => {
    button.style.width = "auto";
    button.style.minWidth = "auto";
  });
  void buttons[0]?.offsetHeight;
  return buttons.map((button) => button.scrollWidth);
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for consecutive style writes outside any loop", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function styleTooltip(el) {
  const width = el.offsetWidth;
  el.style.width = \`\${width}px\`;
  el.style.color = "red";
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for compositor-only transform/opacity writes after a per-iteration measure", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function applyInverseTransforms(elements, oldState) {
  for (const id in elements) {
    const element = elements[id];
    const oldRect = oldState[id];
    const newRect = element.getBoundingClientRect();
    const x = (oldRect.left + oldRect.right) / 2 - (newRect.left + newRect.right) / 2;
    element.style.transitionProperty = "none";
    element.style.transform = \`translate(\${x}px, 0px)\`;
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a used layout read interleaved with style writes on loop elements", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function resizeRows(rows) {
  for (const row of rows) {
    const height = row.offsetHeight;
    row.style.height = \`\${height}px\`;
    row.style.background = "red";
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags per-iteration getBoundingClientRect reads feeding style writes in a forEach", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function alignItems(items, container) {
  items.forEach((item) => {
    item.style.width = \`\${container.getBoundingClientRect().width}px\`;
    item.style.left = "0px";
  });
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a created element that is attached before the interleaved read-write sequence", () => {
    const result = runRule(
      jsBatchDomCss,
      `
function addMarkers(items, parent) {
  for (const item of items) {
    const marker = document.createElement("div");
    parent.appendChild(marker);
    const height = parent.offsetHeight;
    marker.style.height = \`\${height}px\`;
    marker.style.width = "10px";
  }
}
`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
