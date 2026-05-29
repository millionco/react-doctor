// AST child keys that hold TypeScript type-position nodes — type
// annotations, type parameters/arguments, and the heritage type lists
// (`implements`, `extends X<T>` type args). Reference-collecting walkers
// skip these so identifiers that appear ONLY in a type are never
// recorded as runtime value references (they're erased at compile time).
//
// Single source of truth — consumed by the scope analyzer, the
// closure-capture walk, and the reference-name collector so the three
// can't drift on which keys are type-only.
export const TYPE_POSITION_CHILD_KEYS: ReadonlySet<string> = new Set([
  "implements",
  "returnType",
  "superTypeArguments",
  "superTypeParameters",
  "typeAnnotation",
  "typeArguments",
  "typeParameters",
]);
