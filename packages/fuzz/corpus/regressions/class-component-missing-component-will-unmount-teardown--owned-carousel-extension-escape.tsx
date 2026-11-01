// rule: class-component-missing-component-will-unmount-teardown
// weakness: source-provenance
// source: synthetic bounded owned-carousel review control
// verdict: fail

import React from "react";
import { Splide as Deck } from "@splidejs/splide";
export class GalleryView extends React.Component {
  deck: Deck | undefined;
  componentDidMount() {
    this.deck = new Deck("#gallery");
    this.deck.on("ready", () => {});
    this.deck.mount({
      Patch: (instance) => {
        instance.destroy = () => {};
        return {};
      },
    });
  }
  componentWillUnmount() {
    if (this.deck) {
      this.deck.destroy();
      this.deck = undefined;
    }
  }
  render() {
    return null;
  }
}
