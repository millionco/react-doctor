import React from "react";

export default function AlternateRail({ wrapper, content, offset }: any) {
  return (
    <div ref={wrapper} style={{ width: 320 + Math.abs(offset) }}>
      <nav ref={content}>Alternate rail</nav>
    </div>
  );
}
