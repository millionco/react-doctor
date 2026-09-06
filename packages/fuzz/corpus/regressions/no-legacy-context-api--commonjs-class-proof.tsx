// rule: no-legacy-context-api
// weakness: alias-guard
// source: synthetic native parity regression
const CommonJsReact = require("react");

class Provider extends CommonJsReact.Component {
  static childContextTypes = {};

  getChildContext() {
    return {};
  }
}

const ProviderAlias = Provider;
ProviderAlias.contextTypes = {};
