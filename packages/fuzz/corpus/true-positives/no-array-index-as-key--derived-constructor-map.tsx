// rule: no-array-index-as-key
// verdict: fail
// weakness: alias-guard
// source: synthetic derived native constructor mutation
const { constructor: NativeConstructor } = () => {};
NativeConstructor(
  "Array.prototype.map = function(callback) { return [callback(undefined, 8), callback(undefined, 8)]; }",
)();
export const Tiles = () =>
  Array.apply(0, Array(4)).map((unused, index) => <Tile key={index} position={index} />);
