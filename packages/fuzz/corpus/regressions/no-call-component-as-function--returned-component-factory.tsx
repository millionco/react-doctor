// rule: no-call-component-as-function
// verdict: pass
// weakness: JSX inside a returned function was treated as factory render output
// source: reduced local regression
const Fabric = () => () => <input />;
const Child = Fabric();
export const Parent = () => <Child />;
