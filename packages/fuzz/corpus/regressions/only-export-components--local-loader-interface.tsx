// rule: only-export-components
// weakness: provider-identity
// source: independent synthetic local loader regression
// verdict: pass
import { observer } from "mobx-react-lite";
const require = (_source: string) => ({ observer: 0 });
interface require {}
require("other").observer = 1;
const Badge = observer(() => <span />);
export const Card = () => <Badge />;
export default Badge;
