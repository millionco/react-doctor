const CombineIterationsComponent = ({ items }: { items: number[] }) => {
  const result = items.filter((item) => item > 0).map((item) => item * 2);
  return <div>{result.join(",")}</div>;
};

const SpreadSortComponent = ({ items }: { items: number[] }) => {
  const sorted = [...items].sort((first, second) => first - second);
  return <div>{sorted.join(",")}</div>;
};

const MinViaSortComponent = ({ items }: { items: number[] }) => {
  const smallest = items.sort((first, second) => first - second)[0];
  return <div>{smallest}</div>;
};

const RegexpInLoopComponent = ({ items }: { items: string[] }) => {
  const matches: string[] = [];
  for (const item of items) {
    if (new RegExp("test").test(item)) {
      matches.push(item);
    }
  }
  return <div>{matches.join(",")}</div>;
};

const SetMapLookupsComponent = ({ items }: { items: string[] }) => {
  const allowed = ["a", "b", "c"];
  const filtered: string[] = [];
  for (const item of items) {
    if (allowed.includes(item)) {
      filtered.push(item);
    }
  }
  return <div>{filtered.join(",")}</div>;
};

const BatchDomCssComponent = () => {
  const applyStyles = (element: HTMLElement) => {
    element.style.color = "red";
    element.style.backgroundColor = "blue";
  };
  return <button onClick={(event) => applyStyles(event.currentTarget)}>Style</button>;
};

const IndexMapsComponent = ({ users }: { users: { id: string; name: string }[] }) => {
  const ids = ["1", "2", "3"];
  const found: string[] = [];
  for (const id of ids) {
    const user = users.find((innerUser) => innerUser.id === id);
    if (user) found.push(user.name);
  }
  return <div>{found.join(",")}</div>;
};

const CacheStorageComponent = () => {
  const theme = localStorage.getItem("theme");
  const themeAgain = localStorage.getItem("theme");
  return (
    <div>
      {theme}
      {themeAgain}
    </div>
  );
};

const EarlyExitComponent = ({ value }: { value: number }) => {
  if (value > 0) {
    if (value > 10) {
      if (value > 100) {
        if (value > 1000) {
          return <div>big</div>;
        }
      }
    }
  }
  return <div>small</div>;
};

const SequentialAwaitComponent = () => {
  const loadData = async () => {
    const users = await fetch("/api/users");
    const posts = await fetch("/api/posts");
    const comments = await fetch("/api/comments");
    return { users, posts, comments };
  };
  return <button onClick={loadData}>Load</button>;
};

const FlatmapFilterComponent = ({ users }: { users: { isActive: boolean; name: string }[] }) => {
  const activeNames = users.map((user) => (user.isActive ? user.name : null)).filter(Boolean);
  return <div>{activeNames.join(",")}</div>;
};

export {
  CombineIterationsComponent,
  SpreadSortComponent,
  MinViaSortComponent,
  RegexpInLoopComponent,
  SetMapLookupsComponent,
  BatchDomCssComponent,
  IndexMapsComponent,
  CacheStorageComponent,
  EarlyExitComponent,
  SequentialAwaitComponent,
  FlatmapFilterComponent,
};
