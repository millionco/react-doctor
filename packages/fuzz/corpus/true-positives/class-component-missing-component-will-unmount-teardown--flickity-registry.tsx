// rule: class-component-missing-component-will-unmount-teardown
// weakness: wrapper-transparency
// source: synthetic constructor ownership review
// verdict: fail

import { Component } from "react";

interface CarouselHandle {
  destroy: () => void;
}

export class Gallery extends Component {
  container: HTMLDivElement | null = null;
  widget: CarouselHandle | null = null;

  async componentDidMount() {
    if (!this.container) return;
    const CarouselConstructor = (await import("flickity")).default;
    this.widget = new CarouselConstructor(this.container, { resize: false, watchCSS: false });
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
