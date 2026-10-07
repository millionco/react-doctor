// rule: rules-of-hooks
// weakness: wrapper-transparency
// source: fuzz follow-up from seed 1000381
// verdict: fail

const React = require("react");

(React satisfies typeof React).useEffect(() => {}, []);
