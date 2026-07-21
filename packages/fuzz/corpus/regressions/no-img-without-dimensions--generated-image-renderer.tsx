// rule: no-img-without-dimensions
// weakness: framework-gating
// source: PR #1337 parity, CopilotKit/CopilotKit docs app/og/[...slug]/route.tsx
// verdict: pass

import { ImageResponse } from "next/og";

export const GET = () => new ImageResponse(<img src="/logo.png" />);
