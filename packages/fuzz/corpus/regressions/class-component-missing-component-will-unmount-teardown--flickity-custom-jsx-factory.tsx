// rule: class-component-missing-component-will-unmount-teardown
// weakness: provider-identity
// source: synthetic
// verdict: pass
/** @jsx customFactory */
import React, { Component } from "react";
import Flickity from "flickity";

const customFactory = () => null;
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
