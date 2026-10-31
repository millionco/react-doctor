// rule: jsx-curly-brace-presence
// weakness: name-heuristic
// source: synthetic
// verdict: pass
export const FuzzCommentLiteral = () => <div>{/* retain literal context */ "hello"}</div>;
