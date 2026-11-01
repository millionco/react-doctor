// rule: only-export-components
// verdict: fail
import { observer } from "mobx-react-lite";
const Badge = observer(() => <span />);
export const Card = () => <Badge />;
export default Badge;
export const readAmount = () => 4;
