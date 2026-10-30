import { expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rerenderStateOnlyInHandlers } from "./rerender-state-only-in-handlers.js";

interface PayloadAliasCase {
  name: string;
  code: string;
  expectedDiagnosticCount: number;
}

const cases: PayloadAliasCase[] = [
  {
    name: "separate-one-hop-readonly-alias-handoff",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "guard-only-single-self-clear",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "empty-second-dependency-effect",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => {}, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "two-guard-only-self-clear-effects",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { if (request.length > 6) setRequest(""); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "same-effect-direct-payload-before-clear",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { publish(request); if (request.length > 3) setRequest(""); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "nested-asynchronous-self-clear",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setTimeout(() => setRequest(""), 0); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "shadowed-alias-source",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const request = "local"; const payload = request; publish(payload); }, []);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "mutable-replaced-alias",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { let payload = request; payload = "local"; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "unreachable-alias-consumer",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; if (false) publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "same-effect-readonly-alias-before-clear",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { const payload = request; publish(payload); if (request.length > 3) setRequest(""); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "argument-before-alias-declaration-tdz",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { publish(payload); const payload = request; }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "earlier-typeof-alias-tdz-before-valid-argument",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { void typeof payload; const payload = request; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "block-local-alias-outside-top-level-certificate",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { if (request) { const payload = request; publish(payload); } }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "two-hop-alias-outside-certificate",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const first = request; const payload = first; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "deferred-alias-consumer",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; setTimeout(() => publish(payload), 0); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "alias-only-used-in-guard",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; if (payload.length > 3) publish("constant"); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "discarded-member-alias-read",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; payload.length; }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "alias-only-passed-to-state-setter",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; setRequest(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "shadowed-alias-source-with-real-state-dependency",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const request = "local"; const payload = request; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "bigint-dead-alias-consumer",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; if (0n) publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "local-noop-is-not-an-external-callback",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const discard = (_payload: string) => {}; const payload = request; discard(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "state-setter-callee-alias-is-not-an-external-callback",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const write = setRequest; const payload = request; write(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "default-noop-callback-outside-certificate",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish = (_payload: string) => {} }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "imported-callee-outside-certificate",
    code: `import { publish } from "./callbacks";
import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = () => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "optional-callback-outside-certificate",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; publish?.(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "later-throwing-argument-prevents-handoff",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; publish(payload, (() => { throw new Error("stop"); })()); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "returned-call-outside-straight-line-certificate",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; return publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "unconstructed-class-field-consumer",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; class Deferred { value = publish(payload); } }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "class-static-consumer-outside-straight-line-certificate",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; class Deferred { static { publish(payload); } } }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "nested-alias-reference-outside-certificate",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; const later = () => payload; publish(payload); void later; }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "renamed-callback-parameter",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish: deliver }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; deliver(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "annotated-direct-alias",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload: string = request; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "extra-read-after-initialization",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; void payload; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 0,
  },
  {
    name: "reassigned-callback-parameter",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { publish = (_payload: string) => {}; const payload = request; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "default-props-object-outside-certificate",
    code: `import { useEffect, useState } from "react";
interface PanelProps { publish: (payload: string) => void; }
const Panel = ({ publish }: PanelProps = { publish: (_payload: string) => {} }) => {
const [request, setRequest] = useState("");
useEffect(() => { if (request.length > 3) setRequest(""); }, [request]);
useEffect(() => { const payload = request; publish(payload); }, [request]);
return <button onClick={() => setRequest("go")}>Send</button>;
};
`,
    expectedDiagnosticCount: 1,
  },
  {
    name: "erased-callback-interface",
    code: 'import { useEffect, useState } from "react";\ninterface PanelProps { publish: (payload: string) => void; }\nconst Panel = ({ publish }: PanelProps) => {\ninterface publish {}\nconst [request, setRequest] = useState("");\nuseEffect(() => { if (request.length > 3) setRequest(""); }, [request]);\nuseEffect(() => { const payload = request; publish(payload); }, [request]);\nreturn <button onClick={() => setRequest("go")}>Send</button>;\n};\n',
    expectedDiagnosticCount: 0,
  },
  {
    name: "erased-callback-alias",
    code: 'import { useEffect, useState } from "react";\ninterface PanelProps { publish: (payload: string) => void; }\nconst Panel = ({ publish }: PanelProps) => {\ntype publish = string;\nconst [request, setRequest] = useState("");\nuseEffect(() => { if (request.length > 3) setRequest(""); }, [request]);\nuseEffect(() => { const payload = request; publish(payload); }, [request]);\nreturn <button onClick={() => setRequest("go")}>Send</button>;\n};\n',
    expectedDiagnosticCount: 0,
  },
];

it.each(cases)("$name", ({ code, expectedDiagnosticCount }) => {
  const result = runRule(rerenderStateOnlyInHandlers, code, {
    filename: "synthetic-effect-local-alias-payload.tsx",
    includeLocations: true,
  });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedDiagnosticCount);
});
