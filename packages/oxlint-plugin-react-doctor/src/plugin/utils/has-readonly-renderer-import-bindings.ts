import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
const RENDERERS = new Set([
  "react",
  "react-dom",
  "react-dom/client",
  "@react-three/drei",
  "@react-three/fiber",
  "@react-three/rapier",
  "@react-three/postprocessing",
  "three",
]);
const REACT_CALLS = new Set([
  "memo",
  "forwardRef",
  "createElement",
  "createContext",
  "createRef",
  "useState",
  "useReducer",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useCallback",
  "useRef",
  "useContext",
  "useImperativeHandle",
  "useSyncExternalStore",
  "lazy",
]);
const FIBER_CALLS = new Set(["useFrame", "useThree", "useLoader"]);
const DREI_CALLS = new Set([
  "useGLTF",
  "useTexture",
  "useAnimations",
  "useKeyboardControls",
  "useFont",
]);
const THREE_CLASSES = new Set([
  "Vector2",
  "Vector3",
  "Vector4",
  "Euler",
  "Quaternion",
  "Matrix3",
  "Matrix4",
  "Color",
  "Object3D",
  "Group",
  "Mesh",
  "Box3",
  "Sphere",
  "Raycaster",
  "Plane",
  "Clock",
  "BufferGeometry",
  "Texture",
  "TextureLoader",
  "AnimationMixer",
  "MeshBasicMaterial",
  "ShaderMaterial",
  "SpriteMaterial",
  "Material",
  "WebGLRenderTarget",
]);
const THREE_VALUES = new Set([
  "DoubleSide",
  "FrontSide",
  "BackSide",
  "SRGBColorSpace",
  "LinearSRGBColorSpace",
  "RepeatWrapping",
  "ClampToEdgeWrapping",
  "NearestFilter",
  "LinearFilter",
  "UnsignedByteType",
]);
const directCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node.parent, "CallExpression") &&
  node.parent.callee === node &&
  !node.parent.optional;
const directNew = (node: EsTreeNode): boolean =>
  isNodeOfType(node.parent, "NewExpression") && node.parent.callee === node;
const jsxName = (node: EsTreeNode): boolean =>
  Boolean(
    node.parent &&
    (isNodeOfType(node.parent, "JSXOpeningElement") ||
      isNodeOfType(node.parent, "JSXClosingElement")) &&
    node.parent.name === node,
  );
const isSupportedRendererReference = (node: EsTreeNode, source: string, name: string): boolean => {
  if (isWithinAssignmentTarget(node)) return false;
  if (jsxName(node)) return true;
  if (source === "react" && REACT_CALLS.has(name) && directCall(node)) return true;
  if (
    (source === "react-dom/client" || source === "react-dom") &&
    name === "createRoot" &&
    directCall(node)
  )
    return true;
  if (source === "@react-three/fiber" && FIBER_CALLS.has(name) && directCall(node)) return true;
  if (source === "@react-three/drei" && DREI_CALLS.has(name)) {
    if (directCall(node)) return true;
    const property = node.parent;
    return (
      (name === "useGLTF" || name === "useFont") &&
      isNodeOfType(property, "MemberExpression") &&
      property.object === node &&
      !property.optional &&
      !property.computed &&
      isNodeOfType(property.property, "Identifier") &&
      property.property.name === "preload" &&
      directCall(property)
    );
  }
  return (
    source === "three" &&
    ((THREE_CLASSES.has(name) &&
      (directNew(node) ||
        (isNodeOfType(node.parent, "BinaryExpression") &&
          node.parent.operator === "instanceof" &&
          node.parent.right === node))) ||
      THREE_VALUES.has(name))
  );
};
const hasReadonlyRendererReferences = (
  symbol: SymbolDescriptor,
  source: string,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!hasCompleteSymbolReferences(symbol, program, scopes)) return false;
  const declaration = symbol.declarationNode;
  const named = getImportedName(declaration);
  for (const reference of symbol.references) {
    const node = reference.identifier;
    if (node === symbol.bindingIdentifier) continue;
    if (named) {
      if (!isSupportedRendererReference(node, source, named)) return false;
      continue;
    }
    const member = node.parent;
    if (
      isNodeOfType(member, "JSXMemberExpression") &&
      member.object === node &&
      isNodeOfType(member.property, "JSXIdentifier") &&
      jsxName(member)
    )
      continue;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== node ||
      member.computed ||
      member.optional ||
      !isNodeOfType(member.property, "Identifier") ||
      !isSupportedRendererReference(member, source, member.property.name)
    )
      return false;
  }
  return true;
};
/** Requires separately verified stock suppliers. This checks local uses only;
 * it neither proves called functions pure nor grants imported values to opaque consumers. */
export const hasReadonlyRendererImportBindings = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(program, "Program"))
    for (const statement of program.body) {
      if (
        (isNodeOfType(statement, "ExportNamedDeclaration") ||
          isNodeOfType(statement, "ExportAllDeclaration")) &&
        statement.source &&
        isNodeOfType(statement.source, "Literal") &&
        typeof statement.source.value === "string" &&
        RENDERERS.has(statement.source.value)
      )
        return false;
    }
  for (const symbol of scopes.rootScope.symbols.values()) {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (
      !declaration ||
      !isNodeOfType(declaration.source, "Literal") ||
      typeof declaration.source.value !== "string" ||
      !RENDERERS.has(declaration.source.value)
    )
      continue;
    if (
      declaration.importKind === "type" ||
      (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind === "type")
    )
      continue;
    if (!hasReadonlyRendererReferences(symbol, declaration.source.value, program, scopes))
      return false;
  }
  return true;
};
