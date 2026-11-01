import { analyzeControlFlow } from "../../semantic/control-flow-graph.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isClosedNativeMediaRefSnapshot } from "./utils/is-closed-native-media-ref-snapshot.js";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

const cases = [
  {
    name: "ordinary-native-video",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video ref={mediaRef} />}</>;\n};\n',
    expected: 0,
  },
  {
    name: "customized-builtin-video",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video is="custom-player" ref={mediaRef} />}</>;\n};\n',
    expected: 1,
  },
  {
    name: "customized-builtin-audio",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLAudioElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <audio is="custom-player" ref={mediaRef} />}</>;\n};\n',
    expected: 1,
  },
  {
    name: "ordinary-native-video-title",
    code: 'import { useEffect, useRef, useState } from "react";\nexport const Example = ({ mime, mediaKey }: { mime: string; mediaKey: string }) => {\n  const [failedKey, setFailedKey] = useState<string | null>(null);\n  const mediaRef = useRef<HTMLVideoElement | null>(null);\n  useEffect(() => {\n    if (!mediaRef.current) return;\n    const media = mediaRef.current;\n    \n    if (media.canPlayType(mime) === "") setFailedKey(mediaKey);\n    \n  }, [mime, mediaKey]);\n  return <>{failedKey === mediaKey ? null : <video title="Preview" ref={mediaRef} />}</>;\n};\n',
    expected: 0,
  },
];

describe.each([noDerivedState, noDerivedStateEffect])("native media host boundaries", (rule) => {
  it.each(cases)("$name", ({ code, expected }) => {
    const result = runRule(rule, code, {
      filename: "src/components/native-media-host.tsx",
      includeLocations: true,
      settings: { "react-doctor": { capabilities: ["react"], portedRuleMode: "curated" } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});

for (const readAfterDeclarationFirst of [false, true]) {
  it(`preserves occurrence order with later read first: ${readAfterDeclarationFirst}`, () => {
    const code = cases[0].code.replace(
      "const media = mediaRef.current;",
      'if (media.canPlayType(mime) === "") setFailedKey(mediaKey); const media = mediaRef.current;',
    );
    const parsed = parseFixture(code);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const cfg = analyzeControlFlow(parsed.program);
    const expressions: EsTreeNode[] = [];
    let effectFunction: EsTreeNode | undefined;
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "useEffect"
      )
        effectFunction = node.arguments[0];
      if (
        isNodeOfType(node, "MemberExpression") &&
        isNodeOfType(node.property, "Identifier") &&
        node.property.name === "canPlayType"
      )
        expressions.push(node.object);
    });
    expect(parsed.errors).toEqual([]);
    expect(expressions).toHaveLength(2);
    if (!effectFunction) throw new Error("Missing synthetic effect");
    const selectedEffect = effectFunction;
    const orderedExpressions = readAfterDeclarationFirst ? expressions.toReversed() : expressions;
    const results = orderedExpressions.map((expression) =>
      isClosedNativeMediaRefSnapshot({
        expression,
        effectFunction: selectedEffect,
        context: { scopes, cfg, report: () => undefined },
      }),
    );
    expect(results).toEqual(readAfterDeclarationFirst ? [true, false] : [false, true]);
  });
}
