// rule: r3f-no-inline-resource-prop
// weakness: method-semantics
// source: Cursor Bugbot review of PR #1371
import "@react-three/fiber";
import { BufferGeometry } from "three";

const geometry = new BufferGeometry().setIndex([0, 1, 2]);

export const Scene = () => <mesh geometry={geometry.toNonIndexed()} />;
