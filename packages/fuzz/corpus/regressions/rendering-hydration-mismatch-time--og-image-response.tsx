// rule: rendering-hydration-mismatch-time
// weakness: framework-gating
// source: fresh modern-corpus FP hunt (JSX rasterized by next/og never hydrates)
import { ImageResponse } from "next/og";

declare const formatDate: (date: Date) => string;

export async function GET() {
  return new ImageResponse(
    <div style={{ display: "flex", flexDirection: "column" }}>
      <p>Status report</p>
      <p>{formatDate(new Date())}</p>
    </div>,
  );
}
