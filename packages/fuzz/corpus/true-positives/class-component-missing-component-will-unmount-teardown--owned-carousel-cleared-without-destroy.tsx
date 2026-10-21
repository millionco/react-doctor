// rule: class-component-missing-component-will-unmount-teardown
// weakness: library-idiom
// source: synthetic owned carousel lifecycle regression
// verdict: fail

import React from "react";
import { Splide as Deck } from "@splidejs/splide";

export class GalleryView extends React.Component {
  deck: Deck | undefined;

  componentDidMount() {
    this.deck = new Deck("#gallery");
    this.deck.on("ready", () => {});
    this.deck.mount();
  }

  componentWillUnmount() {
    if (this.deck) {
      this.deck = undefined;
    }
  }

  render() {
    return null;
  }
}
