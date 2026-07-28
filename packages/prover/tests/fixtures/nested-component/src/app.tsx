interface DashboardProperties {
  title: string;
}

export const Dashboard = ({ title }: DashboardProperties) => {
  const Header = () => <h1>{title}</h1>;
  return <Header />;
};
