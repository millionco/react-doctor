import type { Rule } from "../../utils/rule.js";
import type { RunRuleOptions } from "../../../test-utils/run-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { collectEffectStateWriteFacts } from "./utils/collect-effect-state-write-facts.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { isMatchedSdkStateSnapshot } from "./utils/is-matched-sdk-state-snapshot.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

interface SdkSnapshotCase {
  name: string;
  code: string;
  expectedDiagnostics: ReturnType<typeof runRule>["diagnostics"];
}

let fixtureDirectory = "";
beforeEach(() => {
  fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-sdk-snapshot-"));
  fs.writeFileSync(
    path.join(fixtureDirectory, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: { react: "16.14.0", "twilio-video": "^2.34.0" },
    }),
  );
  resetManifestCaches();
});
afterEach(() => {
  fs.rmSync(fixtureDirectory, { recursive: true, force: true });
  resetManifestCaches();
});

const sdkSnapshotCases: SdkSnapshotCase[] = [
  {
    name: "ordinary-sdk-snapshot-pair",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [],
  },
  {
    name: "genuine-type-local-import-alias",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant } from "twilio-video";\nexport const useSignalSnapshot = (remote: Participant) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [],
  },
  {
    name: "documented-removal-alias",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.removeListener("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [],
  },
  {
    name: "single-statement-block-handler",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => { setScore(sample); };\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [],
  },
  {
    name: "plain-copy-without-listener",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "opaque-local-emitter-role",
    code: 'import { useEffect, useState } from "react";\ninterface LocalPeer { networkQualityLevel: number; on(event: string, callback: (value: number) => void): unknown; off(event: string, callback: (value: number) => void): unknown; }\nexport const useSignalSnapshot = (remote: LocalPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "generic-type-parameter-shadows-import",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = <VideoPeer,>(remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cleanup-different-receiver",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer, alternate: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { alternate.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cleanup-different-event",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("trackStarted", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "cleanup-different-callback",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", (sample: number) => receiveScore(sample)); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "conditional-cleanup",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { if (Math.random() > 0.5) remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-direct-invocation",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    receiveScore(0);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "handler-ignores-event-payload",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(remote.networkQualityLevel);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "synchronous-write-wrong-state",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  const [alternateScore, setAlternateScore] = useState(0);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setAlternateScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "alternateScore" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "additional-selected-setter-writer",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  const resetScore = () => setScore(0);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "registration-before-snapshot",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    setScore(remote.networkQualityLevel);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "receiver-missing-dependency",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, []);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "visible-receiver-method-replacement",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  remote.on = () => remote;\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "computed-registration-member",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote["on"]("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "visible-emitter-meta-listener",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  remote.on("newListener", () => {});\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "unrelated-state-copy-same-effect",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer, caption: string) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  const [text, setText] = useState(caption);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setText(caption);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "text" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
      {
        column: 4,
        line: 9,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "companion-effect-family-preservation",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer, caption: string) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  const [text, setText] = useState(caption);\n  useEffect(() => { setText(caption); }, [caption]);\n  return [score, text];\n};\n',
    expectedDiagnostics: [
      {
        column: 20,
        line: 12,
        message:
          'Storing "text" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "value import and function declaration hook",
    code: 'import { useEffect, useState } from "react";\nimport { Participant as VideoPeer } from "twilio-video";\nexport function useSignalSnapshot(remote: VideoPeer) {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n}\n',
    expectedDiagnostics: [],
  },
  {
    name: "second SDK import alias override",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nimport { Participant as OtherPeer } from "twilio-video";\nOtherPeer.prototype.on = function () { return this; };\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 9,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "global Function lookup",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nglobalThis["Function"]("return 0")();\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "static constructor extraction",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nconst compile = (() => {}).constructor;\ncompile("return 0")();\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 9,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "computed constructor extraction",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nconst memberName = "constructor";\nconst compile = (() => {})[memberName];\ncompile("return 0")();\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 10,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "computed constructor destructuring",
    code: 'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nconst memberName = "constructor";\nconst { [memberName]: compile } = () => {};\ncompile("return 0")();\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    expectedDiagnostics: [
      {
        column: 4,
        line: 10,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
];

describe.each([
  { name: "direct", rule: noDerivedState },
  { name: "semantic wrapper", rule: wrapWithSemanticContext(noDerivedState) },
])("no-derived-state SDK snapshots ($name)", ({ rule }) => {
  it.each(sdkSnapshotCases)("$name", (testCase) => {
    const filename = path.join(fixtureDirectory, "source.tsx");
    fs.writeFileSync(filename, testCase.code);
    const result = runRule(rule, testCase.code, {
      filename,
      forceJsx: true,
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual(testCase.expectedDiagnostics);
  });
});

interface SdkSupplementalFixture {
  name: string;
  files: Record<string, string>;
  sourceRelativePath: string;
  optionsLiteral: RunRuleOptions;
}

interface SdkVersionBoundaryCase extends SdkSupplementalFixture {
  expectedDiagnostics: ReturnType<typeof runRule>["diagnostics"];
}

const sdkVersionBoundaryCases: SdkVersionBoundaryCase[] = [
  {
    name: "installed-supported-release",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "node_modules/twilio-video/package.json":
        '{\n  "name": "twilio-video",\n  "version": "2.34.0"\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [],
  },
  {
    name: "absent-installed-supported-exact-caret",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [],
  },
  {
    name: "absent-installed-exact-declaration-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "absent-installed-other-caret-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.35.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "absent-installed-tilde-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "~2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "absent-installed-comparator-range-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": ">=2.34.0 <3"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "absent-installed-prerelease-caret-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0-beta.1"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "installed-prerelease-with-valid-caret-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "node_modules/twilio-video/package.json":
        '{\n  "name": "twilio-video",\n  "version": "2.34.0-beta.1"\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "installed-unsupported-release-with-valid-caret-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "node_modules/twilio-video/package.json":
        '{\n  "name": "twilio-video",\n  "version": "2.35.0"\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "installed-invalid-version-with-valid-caret-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "node_modules/twilio-video/package.json":
        '{\n  "name": "twilio-video",\n  "version": "unknown"\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "installed-missing-version-with-valid-caret-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "node_modules/twilio-video/package.json": '{\n  "name": "twilio-video"\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "npm-provider-alias-declaration-refused",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "npm:another-video-sdk@2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "lexical-named-import-renaming-allowed",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [],
  },
  {
    name: "local-type-alias-not-import-renaming",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\ntype LocalPeer = VideoPeer;\nexport const useSignalSnapshot = (remote: LocalPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 8,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
  {
    name: "installed-invalid-json-with-valid-caret-provenance-boundary",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-version-boundary",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "node_modules/twilio-video/package.json": "{\n",
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
    expectedDiagnostics: [
      {
        column: 4,
        line: 7,
        message:
          'Storing "score" in state when you can derive it from other values costs an extra render.',
        nodeType: "CallExpression",
      },
    ],
  },
];

const sdkCertificateBoundaryCases: SdkSupplementalFixture[] = [
  {
    name: "nearer-interface-type-shadows-sdk-import",
    files: {
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const makeSignalHook = () => {\n  interface VideoPeer { networkQualityLevel: number; on(...values: unknown[]): void; off(...values: unknown[]): void; }\nconst useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n  return useSignalSnapshot;\n};\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "nearer-class-type-shadows-sdk-import",
    files: {
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const makeSignalHook = () => {\n  class VideoPeer { networkQualityLevel = 0; on(...values: unknown[]) {} off(...values: unknown[]) {} }\nconst useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n  return useSignalSnapshot;\n};\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "effectful-receiver-default",
    files: {
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nconst makeRemote = (): VideoPeer => { throw new Error("unavailable"); };\nexport const useSignalSnapshot = (remote: VideoPeer = makeRemote()) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "effectful-effect-parameter-default",
    files: {
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nconst acquireOnce = () => { throw new Error("locked"); };\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect((marker = acquireOnce()) => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "effectful-handler-parameter-default",
    files: {
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nconst acquireOnce = () => { throw new Error("locked"); };\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number = acquireOnce()) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "effectful-cleanup-parameter-default",
    files: {
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nconst acquireOnce = () => { throw new Error("locked"); };\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return (marker = acquireOnce()) => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "erased-same-name-receiver-runtime-escape",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  type remote = unknown;\n  expose(remote);\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "runtime-sdk-prototype-provider-customization",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport { Participant as VideoPeer } from "twilio-video";\nVideoPeer.prototype.on = () => { throw new Error("patched"); };\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "receiver-alias-method-replacement",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const forwarded = remote;\n  forwarded.on = () => remote;\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "duplicate-registration-single-removal",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "generator-handler-does-not-commit-on-event",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = function* (sample: number) { setScore(sample); };\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
  {
    name: "async-cleanup-unsupported-lifetime",
    files: {
      "source.tsx":
        'import { useEffect, useState } from "react";\nimport type { Participant as VideoPeer } from "twilio-video";\nexport const useSignalSnapshot = (remote: VideoPeer) => {\n  const [score, setScore] = useState(remote.networkQualityLevel);\n  useEffect(() => {\n    const receiveScore = (sample: number) => setScore(sample);\n    setScore(remote.networkQualityLevel);\n    remote.on("networkQualityLevelChanged", receiveScore);\n    return async () => { remote.off("networkQualityLevelChanged", receiveScore); };\n  }, [remote]);\n  return score;\n};\n',
      "package.json":
        '{\n  "name": "synthetic-signal-snapshot",\n  "private": true,\n  "dependencies": {\n    "react": "16.14.0",\n    "twilio-video": "^2.34.0"\n  }\n}\n',
    },
    sourceRelativePath: "source.tsx",
    optionsLiteral: {
      forceJsx: true,
      includeLocations: true,
    },
  },
];

const sdkSnapshotCertificateProbe: Rule = {
  id: "sdk-snapshot-certificate-test-probe",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (!isReactHookCall(node, "useEffect", context.scopes)) return;
      const analysis = getProgramAnalysis(node);
      if (!analysis) return;
      for (const fact of collectEffectStateWriteFacts(analysis, context, node, context.filename)) {
        if (!isNodeOfType(fact.callExpression, "CallExpression")) continue;
        const [snapshot] = fact.callExpression.arguments;
        if (
          !isNodeOfType(snapshot, "MemberExpression") ||
          !isNodeOfType(snapshot.object, "Identifier") ||
          snapshot.object.name !== "remote" ||
          !isNodeOfType(snapshot.property, "Identifier") ||
          snapshot.property.name !== "networkQualityLevel"
        )
          continue;
        context.report({
          node: fact.callExpression,
          message: isMatchedSdkStateSnapshot({ context, effectCall: node, fact })
            ? "SDK snapshot certificate matched."
            : "SDK snapshot certificate declined.",
        });
      }
    },
  }),
};

describe.each([
  { name: "direct", rule: noDerivedState, probe: sdkSnapshotCertificateProbe },
  {
    name: "semantic wrapper",
    rule: wrapWithSemanticContext(noDerivedState),
    probe: wrapWithSemanticContext(sdkSnapshotCertificateProbe),
  },
])("SDK snapshot supplemental boundaries ($name)", ({ rule, probe }) => {
  it.each(sdkVersionBoundaryCases)("version/import role: $name", (testCase) => {
    for (const [relativePath, contents] of Object.entries(testCase.files)) {
      const filename = path.join(fixtureDirectory, relativePath);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, contents);
    }
    resetManifestCaches();
    const code = testCase.files[testCase.sourceRelativePath];
    const filename = path.join(fixtureDirectory, testCase.sourceRelativePath);
    const result = runRule(rule, code, { ...testCase.optionsLiteral, filename });
    expect(result).toEqual({ diagnostics: testCase.expectedDiagnostics, parseErrors: [] });
  });

  it("accepts the ordinary positive in the focused certificate probe", () => {
    const testCase = sdkVersionBoundaryCases[1];
    for (const [relativePath, contents] of Object.entries(testCase.files)) {
      const filename = path.join(fixtureDirectory, relativePath);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, contents);
    }
    resetManifestCaches();
    const code = testCase.files[testCase.sourceRelativePath];
    const result = runRule(probe, code, {
      filename: path.join(fixtureDirectory, testCase.sourceRelativePath),
      forceJsx: true,
    });
    expect(result).toEqual({
      diagnostics: [{ message: "SDK snapshot certificate matched.", nodeType: "CallExpression" }],
      parseErrors: [],
    });
  });

  it.each(sdkCertificateBoundaryCases)("certificate refusal: $name", (testCase) => {
    for (const [relativePath, contents] of Object.entries(testCase.files)) {
      const filename = path.join(fixtureDirectory, relativePath);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, contents);
    }
    resetManifestCaches();
    const code = testCase.files[testCase.sourceRelativePath];
    const filename = path.join(fixtureDirectory, testCase.sourceRelativePath);
    const result = runRule(probe, code, { filename, forceJsx: true });
    expect(result).toEqual({
      diagnostics: [{ message: "SDK snapshot certificate declined.", nodeType: "CallExpression" }],
      parseErrors: [],
    });
    const direct = runRule(noDerivedState, code, { ...testCase.optionsLiteral, filename });
    const hosted = runRule(rule, code, { ...testCase.optionsLiteral, filename });
    expect(direct.parseErrors).toEqual([]);
    expect(hosted).toEqual(direct);
  });
});

describe("SDK snapshot erased bindings and transparent values", () => {
  it.each([
    ["erased React hook", "interface useState {}\n"],
    ["type-only hook exports", "export type {useState,useEffect};\n"],
    ["inert object keys", "const notes={Function:'description',constructor:'description'};\n"],
    ["inert method keys", "class Notes { static Function(){return 'description'} }\n"],
  ])("preserves the ordinary snapshot beside %s", (_name, prefix) => {
    const code = prefix + sdkSnapshotCases[0].code;
    const result = runRule(noDerivedState, code, {
      filename: path.join(fixtureDirectory, "source.tsx"),
      forceJsx: true,
    });
    expect(result).toEqual({ diagnostics: [], parseErrors: [] });
  });
  it("preserves transparent snapshot value assertions", () => {
    const code = sdkSnapshotCases[0].code.replaceAll(
      "remote.networkQualityLevel",
      "(remote.networkQualityLevel as number)",
    );
    expect(
      runRule(noDerivedState, code, {
        filename: path.join(fixtureDirectory, "source.tsx"),
        forceJsx: true,
      }),
    ).toEqual({ diagnostics: [], parseErrors: [] });
  });
});

describe.each([
  { name: "direct", rule: noDerivedStateEffect },
  { name: "semantic wrapper", rule: wrapWithSemanticContext(noDerivedStateEffect) },
])("SDK snapshots in the companion effect rule ($name)", ({ rule }) => {
  it.each([
    { name: "ordinary-sdk-snapshot-pair", expectedCount: 0 },
    { name: "cleanup-different-callback", expectedCount: 1 },
    { name: "unrelated-state-copy-same-effect", expectedCount: 1 },
    { name: "companion-effect-family-preservation", expectedCount: 1 },
  ])("$name", ({ name, expectedCount }) => {
    const fixture = sdkSnapshotCases.find((candidate) => candidate.name === name);
    if (!fixture) throw Error(`Missing SDK snapshot fixture: ${name}`);
    const result = runRule(rule, fixture.code, {
      filename: path.join(fixtureDirectory, "source.tsx"),
      forceJsx: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
