import React from "react";
export const List = React.createClass({
  render() {
    let Rows;
    Rows = this.props.items.map((item) => <button onClick={this.open}>{item.name}</button>);
    return <div>{Rows}</div>;
  },
});
