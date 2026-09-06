// rule: async-parallel
// weakness: async-boundary
// source: synthetic native parity regression
export async function load() {
  const first = await import("./first");
  const second = await import("./second");
  await import("./style.css");
  return [first, second];
}
