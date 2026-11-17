// rule: js-set-map-lookups
// verdict: pass
// weakness: name-heuristic
// source: independently synthetic readonly renderer with inert type binding
import Markdown from "react-markdown";
export const Example = ({ blocks }) => (
  <section>
    {blocks.map((block) => (
      <Markdown
        key={block}
        components={{
          code({ className }) {
            {
              interface className {}
            }
            return <code>{className?.includes("language-sample")}</code>;
          },
        }}
      >
        {block}
      </Markdown>
    ))}
  </section>
);
