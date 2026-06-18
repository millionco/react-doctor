import { isCodingAgentEnvironment } from "./is-ci-environment.js";
import { supportsHyperlinks } from "./supports-hyperlinks.js";

/**
 * Whether to emit OSC 8 clickable `file:line` locations for this run: a
 * hyperlink-capable terminal AND not a coding agent (whose output parsers
 * would choke on the escape sequences).
 */
export const shouldRenderHyperlinks = (stream: NodeJS.WriteStream = process.stdout): boolean =>
  supportsHyperlinks(stream) && !isCodingAgentEnvironment();
