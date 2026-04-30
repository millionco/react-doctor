// server-dedup-props: paired prop={x} + propOrdered={x.toSorted()} on
// the same JSX element doubles RSC payload size.

declare const ClientList: (props: {
  users: User[];
  usersOrdered?: User[];
  active?: User[];
}) => JSX.Element;

interface User {
  id: number;
  name: string;
  active: boolean;
}

export default function UsersPage({ users }: { users: User[] }) {
  return (
    <ClientList
      users={users}
      usersOrdered={users.toSorted((a, b) => a.id - b.id)}
      active={users.filter((u) => u.active)}
    />
  );
}
