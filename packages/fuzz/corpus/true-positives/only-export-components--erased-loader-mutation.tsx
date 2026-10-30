// rule: only-export-components
// weakness: provider-identity
// source: independent synthetic regression
// verdict: fail
import { observer } from "mobx-react-lite";

declare const require: (source: string) => { observer: unknown };
require("mobx-react-lite").observer = () => 42;

const Badge = observer(() => <span />);
export const Card = () => <Badge />;
export default Badge;
