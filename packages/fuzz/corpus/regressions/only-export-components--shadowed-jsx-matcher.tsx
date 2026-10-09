// rule: only-export-components
// weakness: name-heuristic
// source: github.com/millionco/react-doctor/issues/1858
// verdict: fail
import { match } from "./match";

export const Gate = () => match(state, { ready: () => <main /> });
export const Card = ({ Gate }) => <Gate />;
