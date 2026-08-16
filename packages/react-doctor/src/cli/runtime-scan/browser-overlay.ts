import { getDisplayName, getFiberId, getNearestHostFibers, isCompositeFiber } from "bippy";
import type { Fiber } from "bippy";
import {
  RUNTIME_SCAN_OVERLAY_COLOR_RGB,
  RUNTIME_SCAN_OVERLAY_FILL_ALPHA,
  RUNTIME_SCAN_OVERLAY_FONT,
  RUNTIME_SCAN_OVERLAY_FONT_SIZE_PX,
  RUNTIME_SCAN_OVERLAY_LABEL_GAP_PX,
  RUNTIME_SCAN_OVERLAY_LABEL_PADDING_PX,
  RUNTIME_SCAN_OVERLAY_LINE_WIDTH_PX,
  RUNTIME_SCAN_OVERLAY_MAX_ACTIVE_OUTLINES,
  RUNTIME_SCAN_OVERLAY_MAX_DEVICE_PIXEL_RATIO,
  RUNTIME_SCAN_OVERLAY_MAX_LABEL_LENGTH,
  RUNTIME_SCAN_OVERLAY_VISIBLE_FRAME_COUNT,
  RUNTIME_SCAN_OVERLAY_Z_INDEX,
} from "./constants.js";

interface RuntimeScanOverlayBlueprint {
  readonly id: number;
  readonly name: string;
  readonly elements: ReadonlyArray<Element>;
  count: number;
}

interface RuntimeScanActiveOutline {
  readonly id: number;
  readonly name: string;
  count: number;
  x: number;
  y: number;
  width: number;
  height: number;
  frame: number;
}

interface RuntimeScanOutlineGroup {
  readonly outlines: ReadonlyArray<RuntimeScanActiveOutline>;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly alpha: number;
}

const blueprints = new Map<number, RuntimeScanOverlayBlueprint>();
const activeOutlines = new Map<number, RuntimeScanActiveOutline>();
let canvas: HTMLCanvasElement | null = null;
let context: CanvasRenderingContext2D | null = null;
let flushAnimationFrameId: number | null = null;
let drawAnimationFrameId: number | null = null;
let previousScrollX = window.scrollX;
let previousScrollY = window.scrollY;

const mergeRects = (rects: ReadonlyArray<DOMRect>): DOMRect => {
  const firstRect = rects[0];
  if (rects.length === 1) return firstRect;

  let minimumX = firstRect.x;
  let minimumY = firstRect.y;
  let maximumX = firstRect.right;
  let maximumY = firstRect.bottom;
  for (const rect of rects.slice(1)) {
    minimumX = Math.min(minimumX, rect.x);
    minimumY = Math.min(minimumY, rect.y);
    maximumX = Math.max(maximumX, rect.right);
    maximumY = Math.max(maximumY, rect.bottom);
  }
  return new DOMRect(minimumX, minimumY, maximumX - minimumX, maximumY - minimumY);
};

const resizeCanvas = (): void => {
  if (canvas === null || context === null) return;
  const devicePixelRatio = Math.min(
    window.devicePixelRatio || 1,
    RUNTIME_SCAN_OVERLAY_MAX_DEVICE_PIXEL_RATIO,
  );
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
};

const ensureCanvas = (): boolean => {
  if (canvas !== null && context !== null) return true;
  const documentElement = document.documentElement;
  if (documentElement === null) return false;

  const host = document.createElement("div");
  host.dataset.reactDoctorRuntimeScanOverlay = "";
  const shadowRoot = host.attachShadow({ mode: "open" });
  const nextCanvas = document.createElement("canvas");
  nextCanvas.setAttribute("aria-hidden", "true");
  nextCanvas.style.position = "fixed";
  nextCanvas.style.inset = "0";
  nextCanvas.style.pointerEvents = "none";
  nextCanvas.style.zIndex = String(RUNTIME_SCAN_OVERLAY_Z_INDEX);
  shadowRoot.appendChild(nextCanvas);
  documentElement.appendChild(host);

  const nextContext = nextCanvas.getContext("2d");
  if (nextContext === null) {
    host.remove();
    return false;
  }
  canvas = nextCanvas;
  context = nextContext;
  resizeCanvas();
  return true;
};

const buildGroupLabel = (outlines: ReadonlyArray<RuntimeScanActiveOutline>): string => {
  const renderCountByName = new Map<string, number>();
  for (const outline of outlines) {
    renderCountByName.set(outline.name, (renderCountByName.get(outline.name) ?? 0) + outline.count);
  }
  const label = [...renderCountByName.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name, count]) => `${name} ×${count}`)
    .join(", ");
  return label.length > RUNTIME_SCAN_OVERLAY_MAX_LABEL_LENGTH
    ? `${label.slice(0, RUNTIME_SCAN_OVERLAY_MAX_LABEL_LENGTH)}…`
    : label;
};

const groupOutlines = (): ReadonlyArray<RuntimeScanOutlineGroup> => {
  const outlinesByRect = new Map<string, RuntimeScanActiveOutline[]>();
  for (const outline of activeOutlines.values()) {
    const key = `${Math.round(outline.x)},${Math.round(outline.y)},${Math.round(
      outline.width,
    )},${Math.round(outline.height)}`;
    const existing = outlinesByRect.get(key);
    if (existing === undefined) {
      outlinesByRect.set(key, [outline]);
    } else {
      existing.push(outline);
    }
  }
  return [...outlinesByRect.values()].map((outlines) => {
    const firstOutline = outlines[0];
    return {
      outlines,
      x: firstOutline.x,
      y: firstOutline.y,
      width: firstOutline.width,
      height: firstOutline.height,
      alpha: Math.max(
        ...outlines.map((outline) => 1 - outline.frame / RUNTIME_SCAN_OVERLAY_VISIBLE_FRAME_COUNT),
      ),
    };
  });
};

const draw = (): void => {
  drawAnimationFrameId = null;
  if (canvas === null || context === null) return;
  context.clearRect(0, 0, window.innerWidth, window.innerHeight);
  context.font = `${RUNTIME_SCAN_OVERLAY_FONT_SIZE_PX}px ${RUNTIME_SCAN_OVERLAY_FONT}`;

  for (const group of groupOutlines()) {
    const x = Math.round(group.x) + RUNTIME_SCAN_OVERLAY_LINE_WIDTH_PX / 2;
    const y = Math.round(group.y) + RUNTIME_SCAN_OVERLAY_LINE_WIDTH_PX / 2;
    const width = Math.round(group.width);
    const height = Math.round(group.height);
    context.strokeStyle = `rgba(${RUNTIME_SCAN_OVERLAY_COLOR_RGB},${group.alpha})`;
    context.lineWidth = RUNTIME_SCAN_OVERLAY_LINE_WIDTH_PX;
    context.strokeRect(x, y, width, height);
    context.fillStyle = `rgba(${RUNTIME_SCAN_OVERLAY_COLOR_RGB},${
      group.alpha * RUNTIME_SCAN_OVERLAY_FILL_ALPHA
    })`;
    context.fillRect(x, y, width, height);

    const label = buildGroupLabel(group.outlines);
    const labelWidth = context.measureText(label).width + RUNTIME_SCAN_OVERLAY_LABEL_PADDING_PX * 2;
    const labelHeight =
      RUNTIME_SCAN_OVERLAY_FONT_SIZE_PX + RUNTIME_SCAN_OVERLAY_LABEL_PADDING_PX * 2;
    const labelY = Math.max(0, y - labelHeight - RUNTIME_SCAN_OVERLAY_LABEL_GAP_PX);
    context.fillStyle = `rgba(${RUNTIME_SCAN_OVERLAY_COLOR_RGB},${group.alpha})`;
    context.fillRect(x, labelY, labelWidth, labelHeight);
    context.fillStyle = `rgba(255,255,255,${group.alpha})`;
    context.fillText(
      label,
      x + RUNTIME_SCAN_OVERLAY_LABEL_PADDING_PX,
      labelY + labelHeight - RUNTIME_SCAN_OVERLAY_LABEL_PADDING_PX,
    );
  }

  for (const outline of activeOutlines.values()) {
    outline.frame += 1;
    if (outline.frame > RUNTIME_SCAN_OVERLAY_VISIBLE_FRAME_COUNT) {
      activeOutlines.delete(outline.id);
    }
  }
  if (activeOutlines.size > 0) drawAnimationFrameId = requestAnimationFrame(draw);
};

const flushBlueprints = (): void => {
  flushAnimationFrameId = null;
  if (!ensureCanvas()) return;
  const rectByElement = new Map<Element, DOMRect>();
  for (const blueprint of blueprints.values()) {
    for (const element of blueprint.elements) {
      if (!element.isConnected || rectByElement.has(element)) continue;
      rectByElement.set(element, element.getBoundingClientRect());
    }
  }
  for (const blueprint of blueprints.values()) {
    const rects = blueprint.elements
      .map((element) => rectByElement.get(element))
      .filter((rect) => rect !== undefined)
      .filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length === 0) continue;
    const rect = mergeRects(rects);
    const existing = activeOutlines.get(blueprint.id);
    if (existing === undefined) {
      if (activeOutlines.size >= RUNTIME_SCAN_OVERLAY_MAX_ACTIVE_OUTLINES) continue;
      activeOutlines.set(blueprint.id, {
        id: blueprint.id,
        name: blueprint.name,
        count: blueprint.count,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        frame: 0,
      });
    } else {
      existing.count += blueprint.count;
      existing.x = rect.x;
      existing.y = rect.y;
      existing.width = rect.width;
      existing.height = rect.height;
      existing.frame = 0;
    }
  }
  blueprints.clear();
  if (drawAnimationFrameId === null && activeOutlines.size > 0) {
    drawAnimationFrameId = requestAnimationFrame(draw);
  }
};

export const recordRuntimeScanOverlayRender = (fiber: Fiber): void => {
  if (!isCompositeFiber(fiber)) return;
  const name = getDisplayName(fiber.type);
  if (name === null) return;
  const elements = getNearestHostFibers(fiber)
    .map((hostFiber) => hostFiber.stateNode)
    .filter((stateNode) => stateNode instanceof Element);
  if (elements.length === 0) return;
  const id = getFiberId(fiber);
  const existing = blueprints.get(id);
  if (existing === undefined) {
    blueprints.set(id, { id, name, elements, count: 1 });
  } else {
    existing.count += 1;
  }
  if (flushAnimationFrameId === null) {
    flushAnimationFrameId = requestAnimationFrame(flushBlueprints);
  }
};

window.addEventListener("resize", resizeCanvas);
window.addEventListener(
  "scroll",
  () => {
    const deltaX = window.scrollX - previousScrollX;
    const deltaY = window.scrollY - previousScrollY;
    previousScrollX = window.scrollX;
    previousScrollY = window.scrollY;
    for (const outline of activeOutlines.values()) {
      outline.x -= deltaX;
      outline.y -= deltaY;
    }
    if (drawAnimationFrameId === null && activeOutlines.size > 0) {
      drawAnimationFrameId = requestAnimationFrame(draw);
    }
  },
  { passive: true },
);
