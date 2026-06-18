import type { TypeOnlyShape } from "type-only-lib";
import { realFunction } from "value-used-lib";
import "side-effect-lib";
import type { MixedShape } from "mixed-use-lib";
import { mixedRuntime } from "mixed-use-lib";

export type { ReexportedType } from "reexported-type-lib";
export { reexportedValue } from "reexported-value-lib";

export const consume = (shape: TypeOnlyShape, mixed: MixedShape): string => {
  realFunction();
  mixedRuntime();
  return `${shape.kind}:${mixed.id}`;
};
