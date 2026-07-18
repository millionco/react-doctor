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
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\nconst handleSuggestion = useCallback((text) => {\n  handleSendMessage(text);\n}, [handleSendMessage]);\n<ChatMessageBubble onSuggestion={handleSuggestion} />;\n',
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

  it("resolves a handler through a qualified React.useCallback call", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\nconst handleSuggestion = React.useCallback((text) => {\n  handleSendMessage(text);\n}, [handleSendMessage]);\n<ChatMessageBubble onSuggestion={handleSuggestion} />;\n',
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

  it("unwraps typed handler bindings at component callsites", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\ntype Handler = (text: string) => void;\n<ChatMessageBubble onSuggestion={handleSendMessage as Handler} />;\n',
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

  it("ignores recursive renders inside the diagnosed component", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion, nested }) {\n  const nestedBubble = nested ? <ChatMessageBubble onSuggestion={onSuggestion} nested={false} /> : null;\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\n<ChatMessageBubble onSuggestion={handleSendMessage} nested />;\n',
    );

    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({ filePath: "src/chat-message-bubble.tsx", line: 3, endLine: 5 }),
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

  it("resolves a default-exported arrow component through an aliased import", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "const ChatMessageBubble = ({ onSuggestion }) => {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n};\nexport default ChatMessageBubble;\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import Bubble from "./chat-message-bubble";\n<Bubble onSuggestion={handleSendMessage} />;\n',
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
    expect(delta.crossFileMatchCount).toBe(1);
  });

  it("matches a handler extracted into a memo and forwardRef wrapped component", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      'import { forwardRef, memo } from "react";\nexport const ChatMessageBubble = memo(forwardRef(({ onSuggestion }, _ref) => {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}));\n',
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\n<ChatMessageBubble onSuggestion={handleSendMessage} />;\n',
    );

    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({ filePath: "src/chat-message-bubble.tsx", line: 3, endLine: 5 }),
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

  it("uses the diagnostic column to find a single-line arrow component", () => {
    const componentSource =
      "export const ChatMessageBubble = ({ onSuggestion }) => <span onClick={() => onSuggestion(question)}>{question}</span>;\n";
    fs.writeFileSync(path.join(rootDirectory, "src/chat-message-bubble.tsx"), componentSource);
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\n<ChatMessageBubble onSuggestion={handleSendMessage} />;\n',
    );
    const reader = createDiagnosticEvidenceReader(rootDirectory, {
      resolveForwardedHandlers: true,
    });

    const evidence = reader(
      makeDiagnostic({
        filePath: "src/chat-message-bubble.tsx",
        line: 1,
        column: componentSource.indexOf("<span") + 1,
        endLine: 1,
      }),
    );

    expect(evidence).toContain("handleSendMessage(question)");
  });

  it("resolves a JavaScript import specifier to its TypeScript source", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble.js";\n<ChatMessageBubble onSuggestion={handleSendMessage} />;\n',
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
    expect(delta.crossFileMatchCount).toBe(1);
  });

  it("does not treat a default import as a named diagnosed component", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export default function OtherBubble() { return null; }\nexport function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import Bubble from "./chat-message-bubble";\n<Bubble onSuggestion={handleSendMessage} />;\n',
    );

    const delta = computeDiagnosticDelta({
      headDiagnostics: [
        makeDiagnostic({ filePath: "src/chat-message-bubble.tsx", line: 3, endLine: 5 }),
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
  });

  it("ignores same-named bindings in sibling lexical scopes", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\nconst handleSuggestion = (text) => handleSendMessage(text);\nfunction Sibling() {\n  const handleSuggestion = (text) => discardMessage(text);\n  return null;\n}\n<ChatMessageBubble onSuggestion={handleSuggestion} />;\n',
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
    expect(delta.crossFileMatchCount).toBe(1);
  });

  it("does not resolve through an outer binding shadowed by a parameter", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\nconst handleSuggestion = (text) => handleSendMessage(text);\nfunction ChatPage({ handleSuggestion }) {\n  return <ChatMessageBubble onSuggestion={handleSuggestion} />;\n}\n',
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

  it("treats imported handlers as opaque lexical bindings", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/handlers.ts"),
      "export const handleSuggestion = (text) => handleSendMessage(text);\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\nimport { handleSuggestion } from "./handlers";\nfunction Sibling() {\n  const handleSuggestion = (text) => discardMessage(text);\n  return null;\n}\n<ChatMessageBubble onSuggestion={handleSuggestion} />;\n',
    );
    const reader = createDiagnosticEvidenceReader(rootDirectory, {
      resolveForwardedHandlers: true,
    });

    const evidence = reader(
      makeDiagnostic({ filePath: "src/chat-message-bubble.tsx", line: 2, endLine: 4 }),
    );

    expect(evidence).toContain("handleSuggestion(question)");
    expect(evidence).not.toContain("discardMessage(question)");
  });

  it("refuses to equate a forwarded prop with ambiguous callsite bindings", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\n<ChatMessageBubble onSuggestion={handleSendMessage} />;\n<ChatMessageBubble onSuggestion={discardMessage} />;\n',
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
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\n<ChatMessageBubble onSuggestion={handleSendMessage} />;\n<ChatMessageBubble onSuggestion={() => discardMessage()} />;\n',
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

  it("ignores same-named components that do not import the diagnosed component", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\n<ChatMessageBubble onSuggestion={handleSendMessage} />;\n',
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/unrelated.tsx"),
      "const ChatMessageBubble = ({ onSuggestion }) => null;\n<ChatMessageBubble onSuggestion={discardMessage} />;\n",
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
    expect(delta.crossFileMatchCount).toBe(1);
  });

  it("rejects a wrapper that changes forwarded arguments", () => {
    fs.writeFileSync(
      path.join(rootDirectory, "src/wrapper-before.tsx"),
      "function WrapperBefore() {\n  return <span onClick={() => handleSendMessage(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-message-bubble.tsx"),
      "export function ChatMessageBubble({ onSuggestion }) {\n  return <span onClick={() => onSuggestion(question)}>\n    {question}\n  </span>\n}\n",
    );
    fs.writeFileSync(
      path.join(rootDirectory, "src/chat-page.tsx"),
      'import { ChatMessageBubble } from "./chat-message-bubble";\nconst handleSuggestion = (text) => handleSendMessage(text.trim());\n<ChatMessageBubble onSuggestion={handleSuggestion} />;\n',
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
  });

  it("does not read diagnostic paths outside the project", () => {
    const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-outside-"));
    const outsidePath = path.join(outsideDirectory, "outside.tsx");
    fs.writeFileSync(outsidePath, "const secret = 'not evidence';\n");
    const reader = createDiagnosticEvidenceReader(rootDirectory);

    expect(reader(makeDiagnostic({ filePath: outsidePath }))).toBeNull();

    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  });

  it("does not follow diagnostic symlinks", () => {
    const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-outside-"));
    const outsidePath = path.join(outsideDirectory, "outside.tsx");
    fs.writeFileSync(outsidePath, "const secret = 'not evidence';\n");
    fs.symlinkSync(outsidePath, path.join(rootDirectory, "src/linked.tsx"));
    const reader = createDiagnosticEvidenceReader(rootDirectory);

    expect(reader(makeDiagnostic({ filePath: "src/linked.tsx" }))).toBeNull();

    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  });

  it("does not follow ancestor symlinks outside the project", () => {
    const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-outside-"));
    fs.writeFileSync(
      path.join(outsideDirectory, "outside.tsx"),
      "const secret = 'not evidence';\n",
    );
    fs.symlinkSync(outsideDirectory, path.join(rootDirectory, "src/linked-directory"));
    const reader = createDiagnosticEvidenceReader(rootDirectory);

    expect(reader(makeDiagnostic({ filePath: "src/linked-directory/outside.tsx" }))).toBeNull();

    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  });
});
