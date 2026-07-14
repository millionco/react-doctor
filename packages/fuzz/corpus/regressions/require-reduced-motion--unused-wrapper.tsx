// rule: require-reduced-motion
// weakness: wrapper-transparency
// source: PR 1238 adversarial validation

import { animate } from "framer-motion";

const getAnimation = () => animate;

export const App = () => <div>{typeof getAnimation}</div>;
