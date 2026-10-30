// rule: click-events-have-key-events
// verdict: pass
// weakness: library-idiom
// source: Synthetic invalid-prop applicability regression.
export const Readout = () => <span onClick="">Value</span>;
