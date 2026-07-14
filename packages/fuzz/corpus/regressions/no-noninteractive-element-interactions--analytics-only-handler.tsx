// rule: no-noninteractive-element-interactions
// weakness: cross-file
// source: Nexu open-design 52611c07, IntegrationsView.tsx:170

import posthog from "posthog-js";

const recordSkillsObservation = (capture: typeof posthog.capture): void => {
  capture("skills_coming_soon_viewed", { area: "skills" });
};

export const SkillsComingSoon = () => (
  <section onClick={() => recordSkillsObservation(posthog.capture)}>
    <h2>Skills</h2>
    <p>Coming soon</p>
  </section>
);
