// The abstract domain the path-feasibility checker reasons over: atoms are
// either an SSA value (identified by an opaque key the caller mints from
// `ssa.versionAt`) or a constant literal (with its truthiness precomputed,
// since `if (x)` reasons about truthiness, not just equality). Facts are the
// conjuncts a path condition lowers to — a value's truthiness, or an
// (in)equality between two atoms.

export type Atom =
  | { readonly kind: "value"; readonly key: string }
  | { readonly kind: "const"; readonly key: string; readonly truthy: boolean };

export type PathFact =
  | { readonly kind: "truthy"; readonly atom: Atom; readonly polarity: boolean }
  | {
      readonly kind: "equality";
      readonly left: Atom;
      readonly right: Atom;
      // `true` for `===`/`==`, `false` for `!==`/`!=`.
      readonly polarity: boolean;
    };

export const valueAtom = (key: string): Atom => ({ kind: "value", key });

// Canonicalize a literal into a constant atom, or null when its value can't
// be represented (so the guard is dropped — sound, just less precise).
export const constAtomOf = (value: unknown): Atom | null => {
  if (value === null) return { kind: "const", key: "null", truthy: false };
  switch (typeof value) {
    case "boolean":
      return { kind: "const", key: `b:${value}`, truthy: value };
    case "number":
      return { kind: "const", key: `n:${value}`, truthy: value !== 0 && !Number.isNaN(value) };
    case "string":
      return { kind: "const", key: `s:${value}`, truthy: value.length > 0 };
    case "bigint":
      return { kind: "const", key: `i:${value}`, truthy: value !== BigInt(0) };
    default:
      return null;
  }
};

export const atomKey = (atom: Atom): string => (atom.kind === "value" ? `v:${atom.key}` : atom.key);

// A union-find over atom keys: the congruence-closure backbone for equality
// reasoning. `===` facts union two atoms; membership of the same class is
// then what makes a `!==` between them, or two distinct constants in one
// class, a contradiction.
export interface UnionFind {
  readonly find: (key: string) => string;
  readonly union: (left: string, right: string) => void;
}

export const createUnionFind = (): UnionFind => {
  const parent = new Map<string, string>();

  const find = (key: string): string => {
    let root = parent.get(key) ?? key;
    if (!parent.has(key)) parent.set(key, key);
    while (root !== (parent.get(root) ?? root)) {
      root = parent.get(root) ?? root;
    }
    // Path compression.
    let current = key;
    while (current !== root) {
      const nextParent = parent.get(current) ?? current;
      parent.set(current, root);
      current = nextParent;
    }
    return root;
  };

  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(leftRoot, rightRoot);
  };

  return { find, union };
};
