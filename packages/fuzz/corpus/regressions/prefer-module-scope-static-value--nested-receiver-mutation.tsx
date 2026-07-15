// rule: prefer-module-scope-static-value
// weakness: nested receiver mutation
// source: facebook/docusaurus 5997f3ab website/src/pages/index.tsx
const tweets = [{ showOnHomepage: true }, { showOnHomepage: false }];

export const TweetColumns = () => {
  const tweetColumns = [[], [], []];
  tweets
    .filter((tweet) => tweet.showOnHomepage)
    .forEach((tweet, index) => tweetColumns[index % 3]!.push(tweet));
  return <div>{tweetColumns.map((column) => column.length)}</div>;
};

export const ReadOnlyColumns = () => {
  const columns = [["first"], ["second"]];
  return <div>{columns.length}</div>;
};
