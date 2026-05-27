# Rule Resource Tutor Examples

## ESTree

Key idea:

- Nodes describe syntax.
- Nodes are contextless by design.
- Parent/scope information comes from tooling, not the raw spec.

Rule implication:

- Do not assume `node.parent` exists unless React Doctor utilities attach it.

## Babel

Key idea:

- A path wraps a node with parent, container, scope, and traversal state.
- Visitors operate on paths.
- Bindings tell whether two identifiers are the same variable.

Rule implication:

- Use binding resolution when imports, aliases, or shadowing matter.

## OXC and Babex

Key idea:

- OXC provides fast JS/TS parsing and lint infrastructure.
- Babex exposes Babel-compatible APIs backed by OXC.

Rule implication:

- Use Babel/ESTree vocabulary, but verify parser-specific shapes for TS, JSX, optional chaining, and computed properties.

## React Compiler

Key idea:

- Conservative modeling is acceptable.
- Unsupported JavaScript/control-flow cases should be explicit.

Rule implication:

- It is better to document a v1 non-goal than to guess.

## Deslop

Key idea:

- Findings can have confidence tiers.
- High-confidence findings are suitable for CI gates; lower-confidence findings are better as review prompts.

Rule implication:

- Strong React Doctor diagnostics should be high-confidence and low-noise.
