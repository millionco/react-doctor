import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { computeDiagnosticDelta } from "@react-doctor/core";
import type { Diagnostic } from "@react-doctor/core";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { createDiagnosticEvidenceReader } from "../src/cli/utils/read-diagnostic-evidence.js";

const makeDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/wrapper-before.tsx",
  plugin: "react-doctor",
  rule: "click-events-have-key-events",
  severity: "error",
  title: "Click handler missing keyboard handler",
  message: "A click handler needs a keyboard handler.",
  help: "Add a keyboard handler.",
  line: 1,
  column: 1,
  endLine: 3,
  category: "Accessibility",
  matchByOccurrence: true,
  ...overrides,
});

describe("createDiagnosticEvidenceReader", () => {
  let rootDirectory: string;

  beforeEach(() => {
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-evidence-"));
    fs.mkdirSync(path.join(rootDirectory, "src"));
  });

  afterEach(() => {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  it("matches a handler moved behind one unambiguous forwarded prop", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      "const handleSuggestion = useCallback((text) => {\n  handleSendMessage(text);\n}, [handleSendMessage]);\n<ChatMessageBubble onSuggestion={handleSuggestion} />;\n",
    );

    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({ filePath: "src/chat-message-bubble.tsx", line: 2, endLine: 4 }),
      ],
      baseDiagnostics: [makeDiagnostic({ line: 2, endLine: 4 })],
      readHeadLine: () => null,
      readBaseLine: () => null,
      readHeadEvidence: createDiagnosticEvidenceReader(rootDirectory, {
        resolveForwardedHandlers: true,
      }),
      readBaseEvidence: createDiagnosticEvidenceReader(rootDirectory),
    });

    expect(delta.newDiagnostics).toHaveLength(0);
    expect(delta.fixedCount).toBe(0);
    expect(delta.crossFileMatchCount).toBe(1);
  });

  it("refuses to equate a forwarded prop with ambiguous callsite bindings", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      "<ChatMessageBubble onSuggestion={handleSendMessage} />;\n<ChatMessageBubble onSuggestion={discardMessage} />;\n",
    );

    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({ filePath: "src/chat-message-bubble.tsx", line: 2, endLine: 4 }),
      ],
      baseDiagnostics: [makeDiagnostic({ line: 2, endLine: 4 })],
      readHeadLine: () => null,
      readBaseLine: () => null,
      readHeadEvidence: createDiagnosticEvidenceReader(rootDirectory, {
        resolveForwardedHandlers: true,
      }),
      readBaseEvidence: createDiagnosticEvidenceReader(rootDirectory),
    });

    expect(delta.newDiagnostics).toHaveLength(1);
    expect(delta.fixedCount).toBe(1);
    expect(delta.crossFileMatchCount).toBe(0);
  });

  it("refuses to equate a forwarded prop when a callsite binding is unresolved", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      "<ChatMessageBubble onSuggestion={handleSendMessage} />;\n<ChatMessageBubble onSuggestion={() => discardMessage()} />;\n",
    );

    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({ filePath: "src/chat-message-bubble.tsx", line: 2, endLine: 4 }),
      ],
      baseDiagnostics: [makeDiagnostic({ line: 2, endLine: 4 })],
      readHeadLine: () => null,
      readBaseLine: () => null,
      readHeadEvidence: createDiagnosticEvidenceReader(rootDirectory, {
        resolveForwardedHandlers: true,
      }),
      readBaseEvidence: createDiagnosticEvidenceReader(rootDirectory),
    });

    expect(delta.newDiagnostics).toHaveLength(1);
    expect(delta.fixedCount).toBe(1);
  });
});
