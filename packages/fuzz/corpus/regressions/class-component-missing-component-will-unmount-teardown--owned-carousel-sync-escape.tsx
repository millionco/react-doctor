// rule: class-component-missing-component-will-unmount-teardown
// weakness: source-provenance
// source: synthetic bounded owned-carousel review control
// verdict: fail

import React from "react";
import { Splide as Deck } from "@splidejs/splide";
const peer = {
  splides: {
    push({ splide }) {
      splide.destroy = () => {};
    },
  },
  Components: { Sync: { remount() {} } },
};
export class GalleryView extends React.Component {
  deck: Deck | undefined;
  componentDidMount() {
    this.deck = new Deck("#gallery");
    this.deck.on("ready", () => {});
    this.deck.mount();
  }
  componentWillUnmount() {
    if (this.deck) {
      this.deck.destroy();
      this.deck = undefined;
    }
  }
  componentDidUpdate() {
    this.deck.sync(peer);
  }
  render() {
    return null;
  }
}
