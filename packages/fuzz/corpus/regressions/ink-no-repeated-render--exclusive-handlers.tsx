// rule: ink-no-repeated-render
// weakness: control-flow-path
// source: RDE hyperdxio/hyperdx Ink CLI sample
import { render } from "ink";

export const selectServer = (hasServer: boolean) => {
  if (hasServer) render(null);
  else render(null);
};

export const login = () => render(null);
export const logout = () => render(null);
