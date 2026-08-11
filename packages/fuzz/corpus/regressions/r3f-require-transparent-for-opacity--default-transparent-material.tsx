// rule: r3f-require-transparent-for-opacity
// weakness: library-idiom
// source: React Doctor parity PR #1629

import "@react-three/fiber";

export const Shadows = () => <shadowMaterial opacity={0.2} />;
