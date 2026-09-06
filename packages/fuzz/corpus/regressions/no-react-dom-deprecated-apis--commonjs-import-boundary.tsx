// rule: no-react-dom-deprecated-apis
// weakness: alias-guard
// source: synthetic native parity regression
import { default as NamedDefaultDom } from "react-dom";

const CommonJsDom = require("react-dom");
const CommonJsAlias = CommonJsDom;
CommonJsAlias.render(<div />, document.body);
NamedDefaultDom.render(<div />, document.body);
