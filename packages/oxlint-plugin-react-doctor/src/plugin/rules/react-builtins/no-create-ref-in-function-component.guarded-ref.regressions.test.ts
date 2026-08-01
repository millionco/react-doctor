import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCreateRefInFunctionComponent } from "./no-create-ref-in-function-component.js";

const REACT_BENCH_EVIDENCE_SHA256 =
  "dd5101abb13ff47b037aa4b715b700162664324e6c22b436fba2f033ff1c6c8e";
const RECONSTRUCTED_SOURCE_SHA256 =
  "b07ffb8d4de282140eb407725e51b093e7b29a2c40441d9885f1e41d4609d576";
const REACT_BENCH_FIXTURE = fileURLToPath(
  new URL("./__fixtures__/create-ref-guarded-reactbench.txt", import.meta.url),
);

const runGuardedRefRule = (source: string) => runRule(noCreateRefInFunctionComponent, source);

describe("no-create-ref-in-function-component — guarded useRef persistence", () => {
  it(`replays the exact React Bench source (${REACT_BENCH_EVIDENCE_SHA256})`, () => {
    const reconstructedSource = readFileSync(REACT_BENCH_FIXTURE, "utf8").replaceAll("\r\n", "\n");
    expect(createHash("sha256").update(reconstructedSource).digest("hex")).toBe(
      RECONSTRUCTED_SOURCE_SHA256,
    );
    const result = runRule(noCreateRefInFunctionComponent, reconstructedSource, {
      filename: `${REACT_BENCH_FIXTURE}.tsx`,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for exact nested values persisted behind null and false guards", () => {
    const nullGuardResult = runGuardedRefRule(`import React, { createRef } from "react";
export const Input = () => {
  const controlRef = React.useRef(null);
  if (controlRef.current === null) {
    controlRef.current = { refs: { target: createRef() } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    const falseGuardResult = runGuardedRefRule(`import * as ReactRuntime from "react";
export const Input = () => {
  const controlRef = ReactRuntime.useRef(false);
  if (controlRef.current === false) {
    controlRef.current = { refs: { target: ReactRuntime.createRef() } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    const undefinedGuardResult = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = () => {
  const controlRef = useRef();
  if (controlRef.current === undefined) {
    controlRef.current = { refs: { target: createRef() } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(nullGuardResult.parseErrors).toEqual([]);
    expect(nullGuardResult.diagnostics).toEqual([]);
    expect(falseGuardResult.parseErrors).toEqual([]);
    expect(falseGuardResult.diagnostics).toEqual([]);
    expect(undefinedGuardResult.parseErrors).toEqual([]);
    expect(undefinedGuardResult.diagnostics).toEqual([]);
  });

  it("reports when the guard and assignment target different refs", () => {
    const result = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = () => {
  const guardRef = useRef(null);
  const controlRef = useRef(null);
  if (!guardRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when the explicit guard cannot match the initial ref value", () => {
    const result = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = () => {
  const controlRef = useRef(null);
  if (controlRef.current === false) {
    controlRef.current = { refs: { target: createRef() } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports without a stabilizing assignment", () => {
    const result = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ observe }) => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    const control = { refs: { target: createRef() } };
    observe(control);
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when createRef is observed before persistence", () => {
    const result = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ observe }) => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: observe(createRef()) } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when persistence is conditional inside the empty-ref guard", () => {
    const result = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ enabled }) => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    if (enabled) {
      controlRef.current = { refs: { target: createRef() } };
    }
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when the outer ref binding is mutable", () => {
    const result = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = () => {
  let controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when useRef is shadowed", () => {
    const result = runGuardedRefRule(`import { createRef } from "react";
const useRef = (current) => ({ current });
export const Input = () => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports when the useRef call is not unconditional from component entry", () => {
    const result = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ enabled }) => {
  if (!enabled) return null;
  const controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports after a later clear or replacement of the persistent value", () => {
    const clearResult = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ reset }) => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  if (reset) controlRef.current = null;
  return <Unknown control={controlRef.current} />;
};`);
    const replacementResult = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ replace }) => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  const replaceControl = () => {
    controlRef.current = { refs: { target: createRef() } };
  };
    return <Unknown control={controlRef.current} replace={replace ? replaceControl : undefined} />;
};`);
    expect(clearResult.diagnostics).toHaveLength(1);
    expect(replacementResult.diagnostics).toHaveLength(1);
  });

  it("reports later writes through wrapped ref receivers", () => {
    const result = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ reset }) => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  if (reset === "parenthesized") (controlRef).current = null;
  if (reset === "asserted") (controlRef as typeof controlRef).current = null;
  if (reset === "non-null") controlRef!.current = null;
  return <Unknown control={controlRef.current} />;
};`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports later writes and escapes through const ref aliases", () => {
    const aliasWriteResult = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ reset }) => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  const firstAlias = controlRef;
  const secondAlias = firstAlias;
  if (reset) secondAlias.current = null;
  return <Unknown control={controlRef.current} />;
};`);
    const escapedAliasResult = runGuardedRefRule(`import { createRef, useRef } from "react";
export const Input = ({ resetRef }) => {
  const controlRef = useRef(null);
  if (!controlRef.current) {
    controlRef.current = { refs: { target: createRef() } };
  }
  const controlAlias = controlRef;
  resetRef(controlAlias);
  return <Unknown control={controlRef.current} />;
};`);
    expect(aliasWriteResult.diagnostics).toHaveLength(1);
    expect(escapedAliasResult.diagnostics).toHaveLength(1);
  });
});
