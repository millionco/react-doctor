// rule: no-ease-in-motion
// weakness: receiver-provenance
// source: bugbot-pr-850

interface CarouselProps {
  transition: {
    ease: string;
  };
}

const Carousel = ({ transition }: CarouselProps) => <div data-ease={transition.ease} />;

export const Gallery = () => <Carousel transition={{ ease: "easeIn" }} />;
