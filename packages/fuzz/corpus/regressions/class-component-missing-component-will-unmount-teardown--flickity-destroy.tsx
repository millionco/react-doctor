// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: synthetic constructor ownership review
// verdict: pass

import { Component } from "react";
import Flickity from "flickity";

export class Gallery extends Component {
  container: HTMLDivElement | null = null;
  widget: Flickity | null = null;

  componentDidMount() {
    if (!this.container) return;
    this.widget = new Flickity(this.container, { resize: false, watchCSS: false });
  }

  componentWillUnmount() {
    this.widget?.destroy();
  }

  render() {
    return (
      <div
        ref={(element) => {
          this.container = element;
        }}
      />
    );
  }
}
