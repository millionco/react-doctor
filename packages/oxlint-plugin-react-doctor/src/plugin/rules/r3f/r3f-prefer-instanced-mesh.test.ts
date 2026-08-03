import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fPreferInstancedMesh } from "./r3f-prefer-instanced-mesh.js";

const R3F_RUNTIME_IMPORT = `import { Canvas } from "@react-three/fiber";`;

describe("r3f-prefer-instanced-mesh", () => {
  it("reports repeated meshes with shared geometry and material", () => {
    const result = runRule(
      r3fPreferInstancedMesh,
      `${R3F_RUNTIME_IMPORT}
       const Scene = ({ geometry, material }) => <>{[0, 1, 2].map((index) => <mesh key={index} geometry={geometry} material={material} position={[index, 0, 0]} />)}</>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports exact local callbacks used by repeated rendered maps", () => {
    const result = runRule(
      r3fPreferInstancedMesh,
      `${R3F_RUNTIME_IMPORT}
       const Scene = ({ geometry, material }) => {
         const renderMesh = (index) => <mesh key={index} geometry={geometry} material={material} />;
         return [0, 1].map(renderMesh);
       };
       const Declared = ({ geometry, material }) => {
         function renderMesh(index) {
           return <mesh key={index} geometry={geometry} material={material} />;
         }
         return [0, 1].map(renderMesh);
       };`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports transparent TypeScript resource references", () => {
    const result = runRule(
      r3fPreferInstancedMesh,
      `${R3F_RUNTIME_IMPORT}
       const Scene = ({ geometry, material }) => <>{[0, 1].map((index) => <mesh key={index} geometry={geometry!} material={material as Material} />)}</>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows per-item geometry or material", () => {
    const result = runRule(
      r3fPreferInstancedMesh,
      `${R3F_RUNTIME_IMPORT}
       const Scene = ({ geometry, material, items }) => <>
         {[items[0], items[1]].map((item) => <mesh geometry={item.geometry} material={material} />)}
         {[items[0], items[1]].map((item) => <mesh geometry={geometry} material={item.material} />)}
         {[items[0], items[1]].map((item) => <mesh geometry={geometry} material={materials[item.kind]} />)}
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows resource bindings reassigned by the map callback", () => {
    const result = runRule(
      r3fPreferInstancedMesh,
      `${R3F_RUNTIME_IMPORT}
       const Scene = ({ firstGeometry, material }) => {
         let geometry = firstGeometry;
         return [0, 1].map((index) => {
           geometry = createGeometry(index);
           return <mesh geometry={geometry} material={material} />;
         });
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows unknown, singleton, conditional, and unrendered maps", () => {
    const result = runRule(
      r3fPreferInstancedMesh,
      `${R3F_RUNTIME_IMPORT}
       const Unknown = ({ geometry, material, items }) => <>{items.map((item) => <mesh geometry={geometry} material={material} />)}</>;
       const Singleton = ({ geometry, material }) => <>{[0].map(() => <mesh geometry={geometry} material={material} />)}</>;
       const Conditional = ({ geometry, material, visible }) => <>{[0, 1].map(() => visible && <mesh geometry={geometry} material={material} />)}</>;
       const Unrendered = ({ geometry, material }) => { [0, 1].map(() => <mesh geometry={geometry} material={material} />); return null; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows meshes without authoritative shared resource props", () => {
    const result = runRule(
      r3fPreferInstancedMesh,
      `${R3F_RUNTIME_IMPORT}
       const Scene = ({ geometry, material, props }) => <>
         {[0, 1].map(() => <mesh><boxGeometry /><meshBasicMaterial /></mesh>)}
         {[0, 1].map(() => <mesh geometry={geometry} />)}
         {[0, 1].map(() => <mesh geometry={geometry} material={material} {...props} />)}
         {[0, 1].map(() => <Mesh geometry={geometry} material={material} />)}
       </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires local R3F runtime evidence", () => {
    const result = runRule(
      r3fPreferInstancedMesh,
      `const Scene = ({ geometry, material }) => <>{[0, 1].map(() => <mesh geometry={geometry} material={material} />)}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
