// rule: rules-of-hooks
// weakness: class-field-scope
// source: synthetic
// verdict: fail
import { useState } from "react";

class CounterPanel {
  useCounter = () => useState(0);
  render = this.useCounter;
}

CounterPanel.prototype.isReactComponent = {};

export default CounterPanel;
