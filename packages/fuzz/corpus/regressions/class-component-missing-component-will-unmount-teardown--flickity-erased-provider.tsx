// rule: class-component-missing-component-will-unmount-teardown
// weakness: name-heuristic
// source: synthetic
// verdict: pass
import React, { Component } from "react";
import Flickity from "flickity";

interface Function {}
Function("return 1")();
interface GalleryProps {
  options?: object;
  onAcquire?: (widget: unknown) => void;
}

class Gallery extends Component<GalleryProps> {
  container: HTMLDivElement | null = null;
  widget: any = null;
  componentDidMount() {
    if (!this.container) return;
    this.widget = new Flickity(this.container, {});
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
export default Gallery;
