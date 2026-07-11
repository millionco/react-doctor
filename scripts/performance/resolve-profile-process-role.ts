import type { V8ProfileCallFrame } from "./types.ts";

export const resolveProfileProcessRole = (
  callFrames: ReadonlyArray<V8ProfileCallFrame>,
): string => {
  const urls = callFrames.map((callFrame) => callFrame.url).join("\n");
  if (urls.includes("packages/react-doctor/dist/cli.js")) return "react-doctor";
  if (
    urls.includes("deslop-js") ||
    urls.includes("entries-worker") ||
    urls.includes("parse-worker")
  ) {
    return "dead-code";
  }
  if (urls.includes("oxlint") || urls.includes("oxlint-plugin-react-doctor")) return "oxlint";
  return "node";
};
