// rule: no-default-props
// weakness: name-heuristic
// source: man-group/dtale@d34f0a573c23d197e13cb42d2cb048b926a77cac Wordcloud.react.js
import { Component } from "react";

class Wordcloud extends Component {
  render() {
    return <output>{this.props.height}</output>;
  }
}

Wordcloud.defaultProps = { height: 400 };
