// rule: no-array-index-as-key
// verdict: pass
// weakness: library-idiom
// source: synthetic generated numeric slots
export const Tiles = (count: number) =>
  (Array.apply(0, Array(count)) as undefined[]).map((unused, index) => (
    <Tile key={index} position={index} />
  ));
