// rule: only-export-components
// weakness: provider-identity
// source: independent synthetic merged imported provider exposure
// verdict: fail
const rewriteProvider = () => {
  interface observer {}
  mutate(observer);
};
rewriteProvider();

import { observer } from "mobx-react-lite";
const Badge = observer(() => <span />);
export const Card = () => <Badge />;
export default Badge;
