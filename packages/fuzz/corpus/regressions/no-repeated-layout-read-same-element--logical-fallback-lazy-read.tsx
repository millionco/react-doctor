// rule: no-repeated-layout-read-same-element
// weakness: control-flow
// source: react-bench corpus audit 2026-07 (canvas sizing: || fallback reads are lazy right operands — in the common path only one read runs)
export function measureCanvas(canvas: HTMLCanvasElement) {
  const width = canvas.clientWidth || canvas.getBoundingClientRect().width;
  const height = canvas.clientHeight || canvas.getBoundingClientRect().height;
  if (width === 0 || height === 0) return null;
  return [width, height];
}
