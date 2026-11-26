import type { OwnedStaticData } from "./read-owned-static-data-modules.js";
export interface CssTokenValidation {
  readonly checkedKeys: number;
  readonly checkedPrimitiveValues: number;
}
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9-]*$/u;
const DECIMAL = "(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)";
const RGBA = new RegExp(
  `^rgba\\((${DECIMAL}),\\s*(${DECIMAL}),\\s*(${DECIMAL}),\\s*(${DECIMAL})\\)$`,
  "u",
);
const BEZIER = new RegExp(
  `^cubic-bezier\\((-?${DECIMAL}),\\s*(-?${DECIMAL}),\\s*(-?${DECIMAL}),\\s*(-?${DECIMAL})\\)$`,
  "u",
);
/** Conservative lexical subset for primitive tokens inserted into CSS values.
 * No escapes, strings, URLs, comments, directives or declaration delimiters.
 */
export const isBoundedPrimitiveCssToken = (value: OwnedStaticData): boolean => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0;
  if (typeof value !== "string" || value.length > 160) return false;
  if (
    IDENTIFIER.test(value) ||
    /^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/iu.test(value)
  )
    return true;
  const rgba = RGBA.exec(value);
  if (rgba) {
    const values = rgba.slice(1).map(Number);
    return (
      values.slice(0, 3).every((v) => Number.isInteger(v) && v >= 0 && v <= 255) &&
      values[3] >= 0 &&
      values[3] <= 1
    );
  }
  const bezier = BEZIER.exec(value);
  if (bezier) {
    const values = bezier.slice(1).map(Number);
    return (
      values.every(Number.isFinite) &&
      values[0] >= 0 &&
      values[0] <= 1 &&
      values[2] >= 0 &&
      values[2] <= 1
    );
  }
  return false;
};
/** Consumes only owned abstract data produced by the selected module proof.
 * The formatter's static literals/quasis need their own CSS skeleton check.
 */
export function validateOwnedCssTokenValues(
  providers: ReadonlyMap<string, ReadonlyMap<string, OwnedStaticData>>,
  recordPaths: readonly string[],
  primitivePaths: readonly string[],
): CssTokenValidation | null {
  const select = (path: string): OwnedStaticData[] | null => {
    const segments = path.split(".");
    if (segments.some((s) => s !== "*" && !/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(s))) return null;
    const provider = providers.get(segments.shift()!);
    const key = segments.shift();
    if (!provider || !key || !provider.has(key)) return null;
    let values: OwnedStaticData[] = [provider.get(key)!];
    for (const segment of segments) {
      const next: OwnedStaticData[] = [];
      for (const value of values) {
        if (!value || typeof value !== "object" || value.kind !== "record") return null;
        if (segment === "*") next.push(...value.fields.values());
        else if (value.fields.has(segment)) next.push(value.fields.get(segment)!);
        else return null;
      }
      values = next;
    }
    return values;
  };
  let checkedKeys = 0,
    checkedPrimitiveValues = 0;
  for (const path of recordPaths) {
    const values = select(path);
    if (!values) return null;
    for (const value of values) {
      if (!value || typeof value !== "object" || value.kind !== "record") return null;
      for (const key of value.fields.keys()) {
        if (!IDENTIFIER.test(key)) return null;
        checkedKeys++;
      }
    }
  }
  for (const path of primitivePaths) {
    const values = select(path);
    if (!values) return null;
    for (const value of values) {
      if (!isBoundedPrimitiveCssToken(value)) return null;
      checkedPrimitiveValues++;
    }
  }
  return { checkedKeys, checkedPrimitiveValues };
}
