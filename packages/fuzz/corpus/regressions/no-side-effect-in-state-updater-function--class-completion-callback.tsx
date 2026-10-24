// rule: no-side-effect-in-state-updater-function
// verdict: pass
// weakness: deferred-callback
// source: synthetic regression
import React from "react";
import ReactDOM from "react-dom";

class Panel extends React.Component {
  retry = () => this.setState({ count: 1 }, () => console.log("committed"));
}

ReactDOM.render(<Panel />, document.body);
