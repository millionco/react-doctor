import { useLayoutEffect } from "react";
import { useMeasuredStrip } from "src/useMeasuredStrip";

export default function AlternateEntry({
  index,
  preferredWidth,
}: {
  index: number;
  preferredWidth: number;
}) {
  const { wrapper, content, offset } = useMeasuredStrip({ index });
  useLayoutEffect(() => {
    const current = wrapper.current;
    if (!current) return;
    current.getBoundingClientRect = () => new DOMRect(0, 0, preferredWidth, 40);
  }, [wrapper, preferredWidth]);
  return (
    <div ref={wrapper}>
      <nav ref={content}>{offset}</nav>
    </div>
  );
}
