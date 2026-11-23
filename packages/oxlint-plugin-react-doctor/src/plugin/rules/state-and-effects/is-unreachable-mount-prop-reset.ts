import * as path from "node:path";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPathInside } from "../../utils/is-path-inside.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { readNamedNegatedEffectProp } from "./find-negated-effect-prop.js";
import { hasOnlyTruthyVitePropConsumers } from "./has-only-truthy-vite-prop-consumers.js";

export const createMountPropResetProof = (context: RuleContext) => {
  const proofByProperty = new Map<string, boolean>();
  return (writer: EsTreeNode, effect: EsTreeNode): boolean => {
    const root = getReactDoctorStringSetting(context.settings, "rootDirectory");
    if (!root || !path.isAbsolute(root) || !context.filename) return false;
    const filename = path.resolve(root, context.filename);
    if (!isPathInside(filename, root)) return false;
    let program = writer;
    while (program.parent) program = program.parent;
    if (!isNodeOfType(program, "Program")) return false;
    const proof = readNamedNegatedEffectProp(writer, program, context.scopes);
    if (!proof || proof.effect !== effect) return false;
    const key = proof.name + "\u0000" + proof.property;
    let accepted = proofByProperty.get(key);
    if (accepted === undefined) {
      accepted = hasOnlyTruthyVitePropConsumers({
        projectRoot: root,
        filename,
        exportedName: proof.name,
        property: proof.property,
        program,
        scopes: context.scopes,
      });
      proofByProperty.set(key, accepted);
    }
    return accepted;
  };
};
