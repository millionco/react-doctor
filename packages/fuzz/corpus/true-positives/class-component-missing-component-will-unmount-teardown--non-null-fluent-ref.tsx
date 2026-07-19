// rule: class-component-missing-component-will-unmount-teardown
// weakness: ref-owner-provenance
// source: Cursor Bugbot review of PR #1365

import React from "react";

export class NonNullFluentRef extends React.Component {
  svgRef = React.createRef<SVGSVGElement>();

  componentDidMount() {
    d3.select(this.svgRef.current!).selectAll("rect").on("mouseover", this.handleMouseOver);
  }

  handleMouseOver = () => {};

  render() {
    return <svg ref={this.svgRef} />;
  }
}
