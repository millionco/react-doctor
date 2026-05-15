import fs from "node:fs";
import path from "node:path";
import { resolveUseCallBinding } from "./resolve-use-call-binding.js";

interface OxlintSpan {
  offset: number;
  length: number;
}

interface OxlintLabel {
  label: string;
  span: OxlintSpan;
}

interface OxlintDiagnosticCandidate {
  code: string;
  message: string;
  filename: string;
  labels: OxlintLabel[];
}

const RULES_OF_HOOKS_CODE = "react-hooks(rules-of-hooks)";
const REACT_HOOK_USE_MESSAGE_PREFIX = 'React Hook "use"';

export const shouldSuppressLocalUseHookDiagnostic = (
  diagnostic: OxlintDiagnosticCandidate,
  rootDirectory: string,
): boolean => {
  if (diagnostic.code !== RULES_OF_HOOKS_CODE) return false;
  if (!diagnostic.message.startsWith(REACT_HOOK_USE_MESSAGE_PREFIX)) return false;
  const primaryLabel = diagnostic.labels[0];
  if (!primaryLabel) return false;

  const absolutePath = path.isAbsolute(diagnostic.filename)
    ? diagnostic.filename
    : path.join(rootDirectory, diagnostic.filename);

  let sourceText: string;
  try {
    sourceText = fs.readFileSync(absolutePath, "utf-8");
  } catch {
    return false;
  }

  const bindingResolution = resolveUseCallBinding(
    sourceText,
    absolutePath,
    primaryLabel.span.offset,
  );
  return bindingResolution !== null && !bindingResolution.isReactUseBinding;
};
