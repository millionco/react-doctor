import type { Program } from "@shaderfrog/glsl-parser/ast/ast-types.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { resolveStableOptionsObject } from "../../../utils/resolve-stable-options-object.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { getApiReferenceProvenance } from "./get-api-reference-provenance.js";
import { isThreeModuleSource } from "./is-three-module-source.js";
import { parseGlslShaderSource } from "./parse-glsl-shader-source.js";
import {
  resolveStaticShaderSource,
  type StaticShaderSource,
} from "./resolve-static-shader-source.js";

const SHADER_MATERIAL_CONSTRUCTORS: ReadonlySet<string> = new Set([
  "RawShaderMaterial",
  "ShaderMaterial",
]);
const STATIC_SHADER_MATERIAL_PROPERTY_NAMES: ReadonlyArray<string> = [
  "clipping",
  "fog",
  "fragmentShader",
  "glslVersion",
  "lights",
  "morphNormals",
  "morphTargets",
  "skinning",
  "transmission",
  "uniforms",
  "vertexShader",
];

export interface StaticThreeShaderStage {
  readonly expression: EsTreeNode;
  readonly program: Program;
  readonly source: StaticShaderSource;
  readonly stage: "fragment" | "vertex";
}

export interface StaticThreeShaderMaterial {
  readonly constructorName: string;
  readonly constructorNode: EsTreeNodeOfType<"NewExpression">;
  readonly fragmentShader: StaticThreeShaderStage | null;
  readonly optionsObject: EsTreeNodeOfType<"ObjectExpression">;
  readonly properties: ReadonlyMap<string, EsTreeNode>;
  readonly vertexShader: StaticThreeShaderStage | null;
}

const resolveShaderStage = (
  expression: EsTreeNode | undefined,
  stage: "fragment" | "vertex",
  context: RuleContext,
): StaticThreeShaderStage | null => {
  if (!expression) return null;
  const source = resolveStaticShaderSource(expression, context.scopes);
  if (!source) return null;
  const program = parseGlslShaderSource(source.text, stage);
  return program ? { expression, program, source, stage } : null;
};

export const resolveStaticThreeShaderMaterial = (
  node: EsTreeNodeOfType<"NewExpression">,
  context: RuleContext,
): StaticThreeShaderMaterial | null => {
  const provenance = getApiReferenceProvenance(node.callee, context.scopes);
  if (
    !provenance ||
    !isThreeModuleSource(provenance.moduleSource) ||
    !SHADER_MATERIAL_CONSTRUCTORS.has(provenance.apiName)
  ) {
    return null;
  }
  const options = node.arguments[0];
  if (!options || isNodeOfType(options, "SpreadElement")) return null;
  const optionsObject = resolveStableOptionsObject(
    options,
    STATIC_SHADER_MATERIAL_PROPERTY_NAMES,
    context.scopes,
    node,
  );
  if (!optionsObject) return null;
  const unresolvedPropertyNames = new Set(STATIC_SHADER_MATERIAL_PROPERTY_NAMES);
  const properties = new Map<string, EsTreeNode>();
  for (
    let propertyIndex = optionsObject.properties.length - 1;
    propertyIndex >= 0;
    propertyIndex -= 1
  ) {
    const property = optionsObject.properties[propertyIndex];
    if (!property || isNodeOfType(property, "SpreadElement")) return null;
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) return null;
    if (!unresolvedPropertyNames.has(propertyName)) continue;
    unresolvedPropertyNames.delete(propertyName);
    if (property.kind === "init" && !property.method) {
      properties.set(propertyName, property.value);
    }
  }
  const fragmentShaderExpression = properties.get("fragmentShader");
  const vertexShaderExpression = properties.get("vertexShader");
  return {
    constructorName: provenance.apiName,
    constructorNode: node,
    fragmentShader: resolveShaderStage(fragmentShaderExpression, "fragment", context),
    optionsObject,
    properties,
    vertexShader: resolveShaderStage(vertexShaderExpression, "vertex", context),
  };
};
