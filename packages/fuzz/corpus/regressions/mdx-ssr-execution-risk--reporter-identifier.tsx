// rule: mdx-ssr-execution-risk
// weakness: name-heuristic
// source: mdx-js/mdx node-loader, React Doctor Daytona eval 2026-07-19

import { createFormatAwareProcessors } from "@mdx-js/mdx/internal-create-format-aware-processors";
import { reporter } from "vfile-reporter";

export const loadMdxFile = async (url: URL) =>
  reporter(await createFormatAwareProcessors().process(url));
