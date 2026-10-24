// rule: no-side-effect-in-state-updater-function
// verdict: fail
// weakness: class-api
// source: synthetic regression
import React from "react";
import ReactDOM from "react-dom";

class Panel extends React.Component {
  retry = () =>
    this.setState(() => {
      console.log("retry");
      return {};
    });
}

ReactDOM.render(<Panel />, document.body);
