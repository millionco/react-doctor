// rule: only-export-components
// weakness: library-idiom
// source: github.com/millionco/react-doctor/issues/1858
// verdict: pass
import type { ReactNode } from "react";

const dispatch = (handlers: Record<string, () => ReactNode>): ReactNode => handlers.ready();

export const Gate = () => dispatch({ ready: () => <div /> });
export const Card = () => <Gate />;
