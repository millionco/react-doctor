// rule: display-name
// verdict: fail
// weakness: render-output

export const createView = () => () => [1, 2].map((value) => <span key={value}>{value}</span>);
