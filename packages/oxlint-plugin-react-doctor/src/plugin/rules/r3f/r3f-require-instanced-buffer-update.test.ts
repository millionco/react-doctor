import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRequireInstancedBufferUpdate } from "./r3f-require-instanced-buffer-update.js";

describe("r3f-require-instanced-buffer-update", () => {
  it("reports matrix and color writes without matching upload flags", () => {
    const code = `
      import { useFrame } from "@react-three/fiber";
      import { useRef } from "react";
      const Scene = () => {
        const meshRef = useRef(null);
        useFrame(() => {
          meshRef.current.setMatrixAt(0, matrix);
          meshRef.current.setColorAt(0, color);
        });
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(2);
  });

  it("reports mutations returned directly from concise and block callbacks", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = () => {
        const meshRef = useRef(null);
        const conciseUpdate = () => meshRef.current.setMatrixAt(0, matrix);
        const returnedUpdate = () => {
          return meshRef.current.setColorAt(0, color);
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(2);
  });

  it("accepts matching matrix and color upload flags", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = () => {
        const meshRef = useRef(null);
        const update = () => {
          meshRef.current.setMatrixAt(0, matrix);
          meshRef.current.instanceMatrix.needsUpdate = true;
          meshRef.current.setColorAt(0, color);
          meshRef.current.instanceColor.needsUpdate = true;
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("accepts a matching upload returned directly after the mutation", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = () => {
        const meshRef = useRef(null);
        const update = () => {
          meshRef.current.setMatrixAt(0, matrix);
          return meshRef.current.instanceMatrix.needsUpdate = true;
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("requires the update on every path after a mutation", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = ({ upload }) => {
        const meshRef = useRef(null);
        const update = () => {
          meshRef.current.setMatrixAt(0, matrix);
          if (upload) meshRef.current.instanceMatrix.needsUpdate = true;
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("accepts a matching update after a conditional mutation", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = ({ shouldMove }) => {
        const meshRef = useRef(null);
        const update = () => {
          if (shouldMove) meshRef.current.setMatrixAt(0, matrix);
          meshRef.current.instanceMatrix.needsUpdate = true;
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("accepts an upload after a synchronous iterator finishes writing matrices", () => {
    const code = `
      import "@react-three/fiber";
      import { useLayoutEffect, useRef } from "react";
      const Scene = ({ placements }) => {
        const meshRef = useRef(null);
        useLayoutEffect(() => {
          placements.forEach((placement, index) => {
            meshRef.current.setMatrixAt(index, placement.matrix);
          });
          meshRef.current.instanceMatrix.needsUpdate = true;
        }, [placements]);
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("accepts an outer upload when a callback also has a conditional upload", () => {
    const code = `
      import "@react-three/fiber";
      import { useLayoutEffect, useRef } from "react";
      const Scene = ({ placements, eagerUpload }) => {
        const meshRef = useRef(null);
        useLayoutEffect(() => {
          placements.forEach((placement, index) => {
            meshRef.current.setMatrixAt(index, placement.matrix);
            if (eagerUpload) meshRef.current.instanceMatrix.needsUpdate = true;
          });
          meshRef.current.instanceMatrix.needsUpdate = true;
        }, [placements, eagerUpload]);
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("does not treat an async iterator callback as synchronously uploaded", () => {
    const code = `
      import "@react-three/fiber";
      import { useLayoutEffect, useRef } from "react";
      const Scene = ({ placements }) => {
        const meshRef = useRef(null);
        useLayoutEffect(() => {
          placements.forEach(async (placement, index) => {
            await loadPlacement(placement);
            meshRef.current.setMatrixAt(index, placement.matrix);
          });
          meshRef.current.instanceMatrix.needsUpdate = true;
        }, [placements]);
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("reports early exits and flags written before the mutation", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = ({ stop }) => {
        const meshRef = useRef(null);
        const earlyExit = () => {
          meshRef.current.setMatrixAt(0, matrix);
          if (stop) return;
          meshRef.current.instanceMatrix.needsUpdate = true;
        };
        const wrongOrder = () => {
          meshRef.current.instanceColor.needsUpdate = true;
          meshRef.current.setColorAt(0, color);
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(2);
  });

  it("does not let another ref or buffer satisfy the mutation", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = () => {
        const firstRef = useRef(null);
        const secondRef = useRef(null);
        const wrongRef = () => {
          firstRef.current.setMatrixAt(0, matrix);
          secondRef.current.instanceMatrix.needsUpdate = true;
        };
        const wrongBuffer = () => {
          firstRef.current.setColorAt(0, color);
          firstRef.current.instanceMatrix.needsUpdate = true;
        };
        return <><instancedMesh ref={firstRef} /><instancedMesh ref={secondRef} /></>;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(2);
  });

  it("recognizes static computed properties and transparent wrappers", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = () => {
        const meshRef = useRef(null);
        const update = () => {
          (meshRef.current["setMatrixAt"])(0, matrix);
          (meshRef.current["instanceMatrix"].needsUpdate as boolean) = true;
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("stays quiet when an opaque helper receives the instanced mesh", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      import { uploadInstances } from "./upload-instances";
      const Scene = () => {
        const meshRef = useRef(null);
        const update = async () => {
          meshRef.current.setMatrixAt(0, matrix);
          await uploadInstances(meshRef.current);
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("reports when only one branch transfers the mesh to an opaque helper", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      import { uploadInstances } from "./upload-instances";
      const Scene = ({ upload }) => {
        const meshRef = useRef(null);
        const update = () => {
          meshRef.current.setMatrixAt(0, matrix);
          if (upload) uploadInstances(meshRef.current);
        };
        return <instancedMesh ref={meshRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("stays quiet for unproven owners, aliases, dynamic properties, and overridden refs", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = ({ props, method, buffer }) => {
        const meshRef = useRef(null);
        const customRef = useRef(null);
        const aliasRef = meshRef.current;
        meshRef.current.setMatrixAt(0, matrix);
        customRef.current.setMatrixAt(0, matrix);
        aliasRef.setMatrixAt(0, matrix);
        meshRef.current[method](0, matrix);
        meshRef.current[buffer].needsUpdate = true;
        return <><instancedMesh ref={meshRef} {...props} /><mesh ref={customRef} /></>;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(0);
  });

  it("resolves const ref aliases while respecting shadowed bindings", () => {
    const code = `
      import "@react-three/fiber";
      import { useRef } from "react";
      const Scene = () => {
        const meshRef = useRef(null);
        const jsxRef = meshRef;
        const update = () => {
          meshRef.current.setMatrixAt(0, matrix);
        };
        const unrelated = (meshRef) => meshRef.current.setMatrixAt(0, matrix);
        return <instancedMesh ref={jsxRef} />;
      };
    `;
    expect(runRule(r3fRequireInstancedBufferUpdate, code).diagnostics).toHaveLength(1);
  });

  it("declares the R3F v4 capability gate", () => {
    expect(r3fRequireInstancedBufferUpdate.requires).toEqual(["r3f:4"]);
  });
});
