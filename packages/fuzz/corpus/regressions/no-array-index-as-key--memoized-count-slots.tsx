import { useMemo, useState } from "react";

const lengths = [31, 56, 72];
function Placeholder({ width }: { width: string }) {
  const [text, setText] = useState("");
  return <input style={{ width }} value={text} onChange={(event) => setText(event.target.value)} />;
}
export function LoadingRows({ count }: { count: number }) {
  const sizes = useMemo(
    () => Array.from({ length: count }, (_, position) => `${lengths[position % lengths.length]}%`),
    [count],
  );
  return (
    <section>
      {sizes.map((width, index) => (
        <Placeholder key={index} width={width} />
      ))}
    </section>
  );
}
