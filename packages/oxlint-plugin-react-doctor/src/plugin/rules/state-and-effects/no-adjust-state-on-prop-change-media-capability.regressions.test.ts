import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change — media capability synchronization", () => {
  it("stays silent when an effect stores browser media capability", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function AnimatedBackground({ src, mime }) {
        const normalizedMime = mime?.trim().toLowerCase();
        const isVideoCandidate = normalizedMime?.startsWith("video/");
        const mediaKey = src + normalizedMime;
        const [videoSupport, setVideoSupport] = useState(null);
        useEffect(() => {
          if (!src || !normalizedMime || !isVideoCandidate) {
            setVideoSupport(null);
            return;
          }
          const video = document.createElement("video");
          const isPlayable = video.canPlayType(normalizedMime) !== "";
          setVideoSupport({ mediaKey, isPlayable });
        }, [src, normalizedMime, isVideoCandidate, mediaKey]);
        return videoSupport;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a typed media ref supplies the capability", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useEffect, useRef, useState } from "react";
      function AnimatedBackground({ mime }) {
        const videoRef = useRef<HTMLVideoElement>(null);
        const [isPlayable, setIsPlayable] = useState(false);
        useEffect(() => {
          const video = videoRef.current;
          if (!video) return;
          setIsPlayable(video.canPlayType(mime) !== "");
        }, [mime]);
        return <video ref={videoRef} hidden={!isPlayable} />;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports an unrelated prop-keyed reset beside a media capability query", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Editor({ documentId, mime }) {
        const [draft, setDraft] = useState(null);
        useEffect(() => {
          setDraft(null);
          document.createElement("video").canPlayType(mime);
        }, [documentId, mime]);
        return draft;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a shadowed document binding", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Capability({ document, mime }) {
        const [isPlayable, setIsPlayable] = useState(false);
        useEffect(() => {
          setIsPlayable(false);
          document.createElement("video").canPlayType(mime);
        }, [mime]);
        return isPlayable;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a user object with a matching method name", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Capability({ codec, mime }) {
        const [isPlayable, setIsPlayable] = useState(false);
        useEffect(() => {
          setIsPlayable(false);
          codec.canPlayType(mime);
        }, [mime]);
        return isPlayable;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent for a nullable browser-created media element", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `function Capability({ mime }) {
        const [isPlayable, setIsPlayable] = useState(false);
        useEffect(() => {
          const video = typeof document === "undefined"
            ? null
            : document.createElement("video");
          if (!video) {
            setIsPlayable(false);
            return;
          }
          setIsPlayable(video.canPlayType(mime) !== "");
        }, [mime]);
        return isPlayable;
      }`,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
