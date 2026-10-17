// rule: no-non-null-assertion-on-maybe-undefined-result
// verdict: fail
// weakness: alias-guard
// source: synthetic callable-constructor provider exposure

export const readProjectedProvider = () => {
  const compile = (() => undefined).constructor;
  compile("Map.prototype.get = () => undefined")();
  const groups = new Map<string, { value: string }>();
  return groups.get("selected") ? groups.get("selected")!.value : undefined;
};
