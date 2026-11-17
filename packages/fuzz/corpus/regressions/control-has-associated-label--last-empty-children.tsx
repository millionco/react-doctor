// rule: control-has-associated-label
// weakness: library-idiom
// source: independently synthetic native React children-prop control
// verdict: fail
export const EmptyControl = () => <button children="Continue" children="" />;
