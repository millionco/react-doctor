// rule: no-effect-chain
// verdict: pass
// weakness: provenance
// source: parity ReactNative Run, gluestack UI, and miu2d

import { useEffect, useRef, useState } from "react";

export const CommittedDomFollowups = ({ activeSection, frames, messages }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const consoleRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const [activeId, setActiveId] = useState("");
  const [canvasFrames, setCanvasFrames] = useState(frames);
  const [consoleMessages, setConsoleMessages] = useState(messages);

  useEffect(() => setActiveId(activeSection), [activeSection]);
  useEffect(() => setCanvasFrames(frames), [frames]);
  useEffect(() => setConsoleMessages(messages), [messages]);

  useEffect(() => {
    itemRefs.current[activeId]?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  useEffect(() => {
    if (!canvasFrames) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    context?.fillRect(0, 0, canvas.width, canvas.height);
  }, [canvasFrames]);

  useEffect(() => {
    if (!consoleRef.current) return;
    consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [consoleMessages]);

  return (
    <>
      <a
        ref={(element) => {
          itemRefs.current.section = element;
        }}
      >
        Section
      </a>
      <canvas ref={canvasRef} />
      <div ref={consoleRef}>{consoleMessages.length}</div>
    </>
  );
};
