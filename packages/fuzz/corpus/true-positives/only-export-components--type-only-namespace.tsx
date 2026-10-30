// rule: only-export-components
// weakness: provider-identity
// source: independent synthetic erased namespace regression
// verdict: fail
namespace require {
  export interface Marker {}
}
require("mobx-react-lite").observer = () => 42;
import { observer } from "mobx-react-lite";
const Badge = observer(() => <span />);
export const Card = () => <Badge />;
export default Badge;
