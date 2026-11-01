// rule: only-export-components
// verdict: pass
import { observer } from "mobx-react-lite";
const Badge = observer(() => <span />);
export const Card = () => <Badge />;
export default Badge;
