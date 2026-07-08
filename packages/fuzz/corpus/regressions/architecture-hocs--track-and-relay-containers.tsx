// rule: no-inline-hoc-on-component
// weakness: library-idiom
// source: PR #1000 corpus sweep (artsy react-tracking + Relay container creators)
import { track } from "react-tracking";
import { createRefetchContainer, graphql } from "react-relay";
import { useState } from "react";

export const NavBar = track()((props: { title: string }) => {
  const [open, setOpen] = useState(false);
  return (
    <nav onClick={() => setOpen(!open)}>
      {props.title}
      {String(open)}
    </nav>
  );
});

export const Container = createRefetchContainer(
  (props: { data: { children: string } }) => <section>{props.data.children}</section>,
  {
    data: graphql`
      fragment Container_data on Root {
        children
      }
    `,
  },
  graphql`
    query ContainerQuery {
      root {
        children
      }
    }
  `,
);
