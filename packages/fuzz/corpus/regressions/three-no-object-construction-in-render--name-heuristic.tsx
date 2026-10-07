// rule: three-no-object-construction-in-render
// verdict: pass
// weakness: name-heuristic
// source: parity LBALab/lba2remake and Irev-Dev/cadhub
import { Euler, Mesh, Vector3 } from "three";

export const THROW_ALPHA = () => {
  const offset = new Vector3();
  offset.applyEuler(new Euler());
  return offset;
};

export const CSGArray2R3fComponent = () => [new Mesh()];
