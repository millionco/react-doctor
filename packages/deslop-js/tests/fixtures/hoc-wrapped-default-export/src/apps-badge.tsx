const connect = (mapState: unknown, mapDispatch: unknown) => {
  return (component: unknown) => component;
};

export class AppsBadge {
  render(): null {
    return null;
  }
}

export default connect(null, {})(AppsBadge);
