// rule: jsx-key
// weakness: data-container
// source: RDE twentyhq/twenty 6dd1e8a
declare const PageIcon: () => null;
declare const Wrapper: (props: { children?: unknown }) => null;

const contextChip = {
  Icons: true
    ? [<PageIcon />]
    : [
        <Wrapper>
          <PageIcon />
        </Wrapper>,
      ],
};

export const value = contextChip;
