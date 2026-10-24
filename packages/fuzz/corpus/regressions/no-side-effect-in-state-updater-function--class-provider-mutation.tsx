// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: alias-guard
// source: synthetic regression
import React from "react";
import ReactDOM from "react-dom";

React.__defineGetter__("Component", () => Custom);

class Panel extends React.Component {
  retry = () =>
    this.setState(() => {
      console.log("custom updater");
      return {};
    });
}

ReactDOM.render(<Panel />, document.body);
