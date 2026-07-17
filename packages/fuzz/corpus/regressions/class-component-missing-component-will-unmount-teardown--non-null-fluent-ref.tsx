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
