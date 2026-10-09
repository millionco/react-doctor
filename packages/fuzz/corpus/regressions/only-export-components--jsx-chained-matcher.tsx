// rule: only-export-components
// weakness: library-idiom
// source: github.com/ensdomains/ens-app-v3 (parity for github.com/millionco/react-doctor/issues/1858)
// verdict: pass
import { match } from "ts-pattern";

export const Gate = ({ children }) =>
  match(children)
    .with({ ready: true }, () => <main />)
    .otherwise(() => <aside />);
export const Card = () => <Gate>{content}</Gate>;
