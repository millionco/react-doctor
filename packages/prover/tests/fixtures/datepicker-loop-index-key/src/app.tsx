interface CalendarProperties {
  monthsShown: number;
}

export const Calendar = ({ monthsShown }: CalendarProperties) => {
  const monthList = [];
  for (let monthIndex = 0; monthIndex < monthsShown; monthIndex += 1) {
    const monthKey = `month-${monthIndex}`;
    monthList.push(<section key={monthKey}>Month</section>);
  }
  return <main>{monthList}</main>;
};
