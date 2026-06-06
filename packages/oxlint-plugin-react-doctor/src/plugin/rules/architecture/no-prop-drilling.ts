import { PROP_DRILL_CHAIN_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { isComponentAssignment } from "../../utils/is-component-assignment.js";
import { isComponentDeclaration } from "../../utils/is-component-declaration.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";

type FunctionLikeNode =
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">;

// A same-file component we can reason about: we can see its body, so we
// know exactly which of its props it forwards untouched vs. actually
// reads. Imported components are deliberately NOT modeled — we can't see
// their body, so a prop handed to one counts as consumed (the chain ends
// there). That keeps the rule conservative: we only ever claim "drilled"
// when every hop in the chain is provably a pure pass-through.
interface LocalComponent {
  readonly symbol: SymbolDescriptor;
  readonly displayName: string;
  // external prop name (how a parent names the attribute) → the local
  // parameter binding symbol the destructure introduces. Renamed
  // destructures (`{ user: u }`) map "user" → the `u` binding.
  readonly propBindingByExternalName: Map<string, SymbolDescriptor>;
  readonly propBindingSymbols: ReadonlySet<SymbolDescriptor>;
}

// One untouched forward of a single prop to a same-file child component:
// `<Child childPropExternalName={<the prop>} />`.
interface PropForwardEdge {
  readonly attribute: EsTreeNode;
  readonly childComponent: LocalComponent;
  readonly childPropExternalName: string;
}

interface PropUsage {
  // True only when EVERY reference to the prop is a bare forward to a
  // same-file child AND there is at least one such forward. A single
  // read, render, transform, spread, or hand-off to a DOM/imported
  // element flips this to false (the component genuinely consumes it).
  readonly isPureForwarder: boolean;
  readonly forwardEdges: ReadonlyArray<PropForwardEdge>;
}

// The deepest pure-forward chain rooted at one (component, prop): how
// many consecutive pass-through components the prop crosses, the names
// along that chain, and the JSX attribute at the root hop to report on.
// `terminates` is true only when the chain actually ends at a CONSUMER
// (a component that uses the prop). It separates a real terminus from a
// cycle dead-end: a prop that loops between pure forwarders forever is
// never "used", so a cycle-broken branch must not be counted toward
// depth — otherwise the loop-closing hop is scored like a consumption
// and manufactures a phantom drill.
interface DrillChain {
  readonly depth: number;
  readonly path: ReadonlyArray<string>;
  readonly reportAttribute: EsTreeNode | null;
  readonly terminates: boolean;
}

// Mirror of `stripParenExpression`'s wrapper set, but applied UPWARD:
// `<Child x={user as User} />` / `<Child x={(user)} />` still forward
// `user` untouched, so we treat these transparent wrappers as part of
// the same expression when deciding whether the reference IS the whole
// attribute value.
const TRANSPARENT_EXPRESSION_WRAPPERS = new Set<string>([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSTypeAssertion",
  "TSNonNullExpression",
  "TSInstantiationExpression",
  "ChainExpression",
]);

const collectAllScopeSymbols = (rootScope: ScopeDescriptor): SymbolDescriptor[] => {
  const symbols: SymbolDescriptor[] = [];
  const visit = (scope: ScopeDescriptor): void => {
    for (const symbol of scope.symbols) symbols.push(symbol);
    for (const child of scope.children) visit(child);
  };
  visit(rootScope);
  return symbols;
};

const getComponentFunctionNode = (symbol: SymbolDescriptor): FunctionLikeNode | null => {
  const declaration = symbol.declarationNode;
  if (isNodeOfType(declaration, "FunctionDeclaration")) {
    return isComponentDeclaration(declaration) ? declaration : null;
  }
  if (isNodeOfType(declaration, "VariableDeclarator")) {
    if (!isComponentAssignment(declaration)) return null;
    const initializer = declaration.init;
    if (
      initializer &&
      (isNodeOfType(initializer, "ArrowFunctionExpression") ||
        isNodeOfType(initializer, "FunctionExpression"))
    ) {
      return initializer;
    }
  }
  return null;
};

// v1 models only top-level destructured named props (`function C({ user })`).
// `function C(props)` (member access), `{ ...rest }`, and nested
// destructures (`{ user: { id } }`) are intentionally skipped — the prop
// is either consumed or its identity can't be threaded through a chain
// precisely, so those components act as opaque consumers.
const collectDestructuredPropBindings = (
  functionNode: FunctionLikeNode,
  scopes: ScopeAnalysis,
): { byExternalName: Map<string, SymbolDescriptor>; symbols: Set<SymbolDescriptor> } => {
  const byExternalName = new Map<string, SymbolDescriptor>();
  const symbols = new Set<SymbolDescriptor>();
  const firstParam = functionNode.params?.[0];
  if (!firstParam || !isNodeOfType(firstParam, "ObjectPattern")) return { byExternalName, symbols };
  for (const property of firstParam.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (property.computed) continue;
    if (!isNodeOfType(property.key, "Identifier")) continue;
    // `{ user = fallback }` → AssignmentPattern; the binding is the left
    // identifier and the default never mutates a forwarded value.
    let valueNode: EsTreeNode = property.value;
    if (isNodeOfType(valueNode, "AssignmentPattern")) valueNode = valueNode.left;
    if (!isNodeOfType(valueNode, "Identifier")) continue;
    const symbol = scopes.symbolFor(valueNode);
    if (!symbol) continue;
    byExternalName.set(property.key.name, symbol);
    symbols.add(symbol);
  }
  return { byExternalName, symbols };
};

// Climbs out of transparent wrappers so the caller can ask "is THIS
// reference the entire value of an attribute?" without parens / casts
// hiding the relationship.
const outermostWrappedExpression = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (current.parent && TRANSPARENT_EXPRESSION_WRAPPERS.has(current.parent.type)) {
    const wrapper = current.parent as EsTreeNode & { expression?: EsTreeNode };
    if (wrapper.expression !== current) break;
    current = wrapper;
  }
  return current;
};

const getJsxAttributeName = (attribute: EsTreeNodeOfType<"JSXAttribute">): string | null =>
  isNodeOfType(attribute.name, "JSXIdentifier") ? attribute.name.name : null;

export const noPropDrilling = defineRule<Rule>({
  id: "no-prop-drilling",
  title: "Prop drilled through too many components",
  severity: "warn",
  tags: ["test-noise", "react-jsx-only"],
  recommendation:
    "Lift the value into a Context/Provider (or compose with `children`) so intermediate components don't forward a prop they never use.",
  create: (context: RuleContext) => {
    const scopes = context.scopes;

    // Resolves `<Tag .../>` to a same-file component, or null for DOM
    // elements (lowercase), imported components, and `<obj.Member />` —
    // all of which terminate a chain.
    const resolveLocalComponent = (
      tagName: EsTreeNode,
      componentBySymbol: Map<SymbolDescriptor, LocalComponent>,
    ): LocalComponent | null => {
      if (!isNodeOfType(tagName, "JSXIdentifier")) return null;
      const symbol = scopes.symbolFor(tagName);
      if (!symbol) return null;
      return componentBySymbol.get(symbol) ?? null;
    };

    // A reference is a "bare forward" when it IS the whole value of a
    // `childProp={<ref>}` attribute on a same-file component. Anything
    // else (a read, `user.name`, `fn(user)`, `{...user}`, a DOM sink, an
    // imported child) is a real use.
    const forwardEdgeForReference = (
      referenceIdentifier: EsTreeNode,
      componentBySymbol: Map<SymbolDescriptor, LocalComponent>,
    ): PropForwardEdge | null => {
      const outer = outermostWrappedExpression(referenceIdentifier);
      const container = outer.parent;
      if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return null;
      if (container.expression !== outer) return null;
      const attribute = container.parent;
      if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return null;
      if (attribute.value !== container) return null;
      const childPropExternalName = getJsxAttributeName(attribute);
      if (!childPropExternalName) return null;
      const openingElement = attribute.parent;
      if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return null;
      const childComponent = resolveLocalComponent(openingElement.name, componentBySymbol);
      if (!childComponent) return null;
      return { attribute, childComponent, childPropExternalName };
    };

    const classifyPropUsage = (
      propSymbol: SymbolDescriptor,
      componentBySymbol: Map<SymbolDescriptor, LocalComponent>,
      cache: Map<SymbolDescriptor, PropUsage>,
    ): PropUsage => {
      const cached = cache.get(propSymbol);
      if (cached) return cached;
      const forwardEdges: PropForwardEdge[] = [];
      let hasRealUse = false;
      for (const reference of propSymbol.references) {
        const edge = forwardEdgeForReference(reference.identifier, componentBySymbol);
        if (edge) forwardEdges.push(edge);
        else hasRealUse = true;
      }
      const usage: PropUsage = {
        isPureForwarder: forwardEdges.length > 0 && !hasRealUse,
        forwardEdges,
      };
      cache.set(propSymbol, usage);
      return usage;
    };

    // Walks the deepest pure-forward chain from one (component, prop),
    // counting only consecutive pass-through components. `visiting`
    // breaks self/mutual recursion (`<Tree node={node} />`) so the walk
    // always terminates.
    const deepestDrillChain = (
      component: LocalComponent,
      propSymbol: SymbolDescriptor,
      componentBySymbol: Map<SymbolDescriptor, LocalComponent>,
      usageCache: Map<SymbolDescriptor, PropUsage>,
      visiting: Set<SymbolDescriptor>,
    ): DrillChain => {
      // Re-entering a binding already on the stack is a cycle, not a
      // terminus — the prop never gets consumed down this path.
      if (visiting.has(propSymbol)) {
        return { depth: 0, path: [], reportAttribute: null, terminates: false };
      }
      const usage = classifyPropUsage(propSymbol, componentBySymbol, usageCache);
      // A component that doesn't purely forward the prop consumes it: the
      // valid end of a drilling chain.
      if (!usage.isPureForwarder) {
        return { depth: 0, path: [], reportAttribute: null, terminates: true };
      }
      visiting.add(propSymbol);
      let best: DrillChain = { depth: 0, path: [], reportAttribute: null, terminates: false };
      for (const edge of usage.forwardEdges) {
        const childBinding = edge.childComponent.propBindingByExternalName.get(
          edge.childPropExternalName,
        );
        // A local child that doesn't expose this attribute as a named
        // destructured prop (it uses `props`, spreads, or nested-
        // destructures) consumes the value opaquely — a valid terminus.
        const childChain: DrillChain = childBinding
          ? deepestDrillChain(
              edge.childComponent,
              childBinding,
              componentBySymbol,
              usageCache,
              visiting,
            )
          : { depth: 0, path: [], reportAttribute: null, terminates: true };
        // Only count a hop whose downstream actually reaches a consumer.
        if (!childChain.terminates) continue;
        const candidateDepth = 1 + childChain.depth;
        if (candidateDepth > best.depth) {
          best = {
            depth: candidateDepth,
            path: [component.displayName, ...childChain.path],
            reportAttribute: edge.attribute,
            terminates: true,
          };
        }
      }
      visiting.delete(propSymbol);
      return best;
    };

    return {
      "Program:exit"() {
        const components: LocalComponent[] = [];
        const componentBySymbol = new Map<SymbolDescriptor, LocalComponent>();
        for (const symbol of collectAllScopeSymbols(scopes.rootScope)) {
          const functionNode = getComponentFunctionNode(symbol);
          if (!functionNode) continue;
          const { byExternalName, symbols } = collectDestructuredPropBindings(functionNode, scopes);
          const component: LocalComponent = {
            symbol,
            displayName: symbol.name,
            propBindingByExternalName: byExternalName,
            propBindingSymbols: symbols,
          };
          components.push(component);
          componentBySymbol.set(symbol, component);
        }
        // A chain needs a forwarder plus something it forwards into.
        if (components.length < 2) return;

        const usageCache = new Map<SymbolDescriptor, PropUsage>();

        // Any prop binding that another pure forwarder hands a value to
        // is mid-chain, not a chain origin. Reporting only at origins
        // gives one diagnostic per drilled prop instead of one per hop.
        const forwardedIntoBindings = new Set<SymbolDescriptor>();
        for (const component of components) {
          for (const propSymbol of component.propBindingSymbols) {
            const usage = classifyPropUsage(propSymbol, componentBySymbol, usageCache);
            if (!usage.isPureForwarder) continue;
            for (const edge of usage.forwardEdges) {
              const childBinding = edge.childComponent.propBindingByExternalName.get(
                edge.childPropExternalName,
              );
              if (childBinding) forwardedIntoBindings.add(childBinding);
            }
          }
        }

        const reportedAttributes = new Set<EsTreeNode>();
        for (const component of components) {
          for (const propSymbol of component.propBindingSymbols) {
            if (forwardedIntoBindings.has(propSymbol)) continue;
            const usage = classifyPropUsage(propSymbol, componentBySymbol, usageCache);
            if (!usage.isPureForwarder) continue;
            const chain = deepestDrillChain(
              component,
              propSymbol,
              componentBySymbol,
              usageCache,
              new Set(),
            );
            if (chain.depth < PROP_DRILL_CHAIN_THRESHOLD || !chain.reportAttribute) continue;
            if (reportedAttributes.has(chain.reportAttribute)) continue;
            reportedAttributes.add(chain.reportAttribute);
            const propName = isNodeOfType(chain.reportAttribute, "JSXAttribute")
              ? getJsxAttributeName(chain.reportAttribute)
              : null;
            context.report({
              node: chain.reportAttribute,
              message: `Prop ${propName ? `"${propName}"` : "value"} is forwarded untouched through ${chain.depth} components (${chain.path.join(" → ")}) before it's used. Lift it into a Context/Provider (or compose with \`children\`) so these middle components don't have to pass it down.`,
            });
          }
        }
      },
    };
  },
});
