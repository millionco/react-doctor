import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAutoScrollingContent } from "./no-auto-scrolling-content.js";

describe("no-auto-scrolling-content", () => {
  it("flags an infinite Motion track with substantial percentage travel", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Partners = () => (
          <motion.div
            animate={{ x: ["0%", "-50%"] }}
            transition={{ duration: 20, ease: "linear", repeat: Infinity }}
          >
            <span>Acme</span>
            <span>Globex</span>
          </motion.div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a scalar target when a static initial position proves the travel", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { m } from "motion/react";

        const Quotes = () => (
          <m.div
            initial={{ translateX: "0%" }}
            animate={{ translateX: "-100%", transition: { repeat: Infinity } }}
          >
            <blockquote>Fast and reliable.</blockquote>
          </m.div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("tries translateX when x does not contain percentage travel", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Partners = () => (
          <motion.div
            animate={{ x: ["0px", "20px"], translateX: ["0%", "-50%"] }}
            transition={{ repeat: Infinity }}
          >
            Acme and Globex
          </motion.div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts finite entrances, small loops, and pixel travel", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Examples = () => (
          <>
            <motion.div animate={{ x: ["-100%", "0%"] }} transition={{ duration: 0.3 }}>
              Settings
            </motion.div>
            <motion.div animate={{ x: ["0%", "10%"] }} transition={{ repeat: Infinity }}>
              Ambient drift
            </motion.div>
            <motion.div animate={{ x: ["0px", "760px"] }} transition={{ repeat: Infinity }}>
              Playhead
            </motion.div>
          </>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts dynamic animation values and unresolved Motion lookalikes", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";
        import { motion as localMotion } from "./animation";

        const Examples = ({ positions, repeat }) => (
          <>
            <motion.div animate={{ x: positions }} transition={{ repeat: Infinity }}>Logos</motion.div>
            <motion.div animate={{ x: ["0%", "-50%"] }} transition={{ repeat }}>Logos</motion.div>
            <localMotion.div animate={{ x: ["0%", "-50%"] }} transition={{ repeat: Infinity }}>
              Logotypes
            </localMotion.div>
          </>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a shadowed Infinity identifier", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Infinity = 2;
        const Partners = () => (
          <motion.div
            animate={{ x: ["0%", "-50%"] }}
            transition={{ repeat: Infinity }}
          >
            Acme and Globex
          </motion.div>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts controlled carousels and pauseable tickers", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Examples = () => (
          <>
            <section>
              <motion.div animate={{ x: ["0%", "-100%"] }} transition={{ repeat: Infinity }}>
                <article>First slide</article>
                <article>Second slide</article>
              </motion.div>
              <button aria-label="Previous slide">←</button>
              <button aria-label="Next slide">→</button>
            </section>
            <div>
              <motion.p animate={{ x: ["0%", "-50%"] }} transition={{ repeat: Infinity }}>
                Scheduled maintenance at 8 PM
              </motion.p>
              <button>Pause ticker</button>
            </div>
          </>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("finds an associated pause control one wrapper above the track", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Partners = () => (
          <section>
            <div className="overflow-hidden">
              <motion.div
                id="partner-track"
                animate={{ x: ["0%", "-50%"] }}
                transition={{ repeat: Infinity }}
              >
                Acme and Globex
              </motion.div>
            </div>
            <button aria-controls="partner-track">Pause</button>
          </section>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not mistake unrelated controls for marquee controls", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Partners = () => (
          <section>
            <motion.div
              id="partner-track"
              animate={{ x: ["0%", "-50%"] }}
              transition={{ repeat: Infinity }}
            >
              Acme and Globex
            </motion.div>
            <button>Next</button>
            <button aria-controls="another-panel">Stop</button>
          </section>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts dynamic and live content", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Examples = ({ headlines }) => (
          <>
            <motion.div animate={{ x: ["0%", "-50%"] }} transition={{ repeat: Infinity }}>
              {headlines.map((headline) => <span key={headline.id}>{headline.title}</span>)}
            </motion.div>
            <motion.div
              role="STATUS"
              aria-live="polite"
              animate={{ x: ["0%", "-50%"] }}
              transition={{ repeat: Infinity }}
            >
              Latest service status
            </motion.div>
            <div role="ALERT status">
              <motion.div
                animate={{ x: ["0%", "-50%"] }}
                transition={{ repeat: Infinity }}
              >
                Emergency maintenance begins now
              </motion.div>
            </div>
            <div role={window.currentRole}>
              <motion.div
                animate={{ x: ["0%", "-50%"] }}
                transition={{ repeat: Infinity }}
              >
                Possibly live content
              </motion.div>
            </div>
          </>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts unresolved text tracks", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        import { motion } from "framer-motion";

        const Examples = ({ emphasis }) => (
          <>
            <motion.div animate={{ x: ["0%", "-50%"] }} transition={{ repeat: Infinity }}>
              <PartnerLogo /> Acme
            </motion.div>
            <motion.div animate={{ x: ["0%", "-50%"] }} transition={{ repeat: Infinity }}>
              <span /> Globex
            </motion.div>
            <motion.div animate={{ x: ["0%", "-50%"] }} transition={{ repeat: Infinity }}>
              <span className={emphasis}>Acme</span>
            </motion.div>
          </>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not overlap native marquee or ordinary overflow scrollers", () => {
    const result = runRule(
      noAutoScrollingContent,
      `
        const Examples = () => (
          <>
            <marquee>Legacy announcement</marquee>
            <div className="overflow-x-auto whitespace-nowrap">Manually scrollable content</div>
          </>
        );
      `,
    );

    expect(result.diagnostics).toHaveLength(0);
  });
});
