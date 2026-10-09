// rule: only-export-components
// weakness: library-idiom
// source: github.com/cosscom/coss (parity for github.com/millionco/react-doctor/issues/1858)
// verdict: pass
import { useRender } from "@base-ui/react/use-render";

export const Gate = ({ children }) => useRender({ defaultTagName: "div", props: { children } });
export const Card = () => <Gate>{content}</Gate>;
