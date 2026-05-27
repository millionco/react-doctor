// True when a JSX tag name looks like a host (DOM/SVG/custom) element
// rather than a React/Solid component. The Solid (and React) JSX
// transforms split on this same criterion — lowercase-led names are
// emitted as `createElement("div", ...)` strings, capitalised names
// are emitted as variable references — so it doubles as the gate for
// "is this an intrinsic element?" in many lint checks.
export const isDomElementName = (elementName: string): boolean => /^[a-z]/.test(elementName);
