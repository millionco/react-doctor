// rule: display-name
// verdict: fail
// weakness: nested-jsx-data
// source: adversarial render-output control for jsx-data-factory

export const makeComponent = () => () => [<Icon key="icon" />, <span key="text">Text</span>];
