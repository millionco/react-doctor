// rule: class-component-missing-component-will-unmount-teardown
// weakness: name-heuristic
// source: synthetic
// verdict: pass
/** @jsx React.createElement */
import React, { Component } from "react";
import Flickity from "flickity";

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
    const React = { createElement: () => null };
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
