// rule: rules-of-hooks
// weakness: wrapper-transparency
// source: fuzz seed 1000381
// verdict: fail

const React = require("react");

React!.useEffect(() => {}, []);
