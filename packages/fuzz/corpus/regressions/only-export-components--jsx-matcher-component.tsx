// rule: only-export-components
// weakness: cross-file
// source: github.com/millionco/react-doctor/issues/1858
// verdict: pass
import { match } from "./match";

export const Gate = () => match(state, { ready: () => <main />, waiting: () => <aside /> });
export const Card = () => <Gate />;
