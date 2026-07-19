// rule: jsx-key
// weakness: non-rendering-consumer
// source: RDE tldraw/tldraw ddd841e
declare const createShapesFromJsx: (shapes: unknown[]) => void;
declare const Shape: (props: { id: string }) => null;

createShapesFromJsx([<Shape id="one" />, <Shape id="two" />]);
