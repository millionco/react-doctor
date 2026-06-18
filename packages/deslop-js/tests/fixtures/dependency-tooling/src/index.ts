import { zodResolver } from "@hookform/resolvers/zod";
import { Chart } from "react-chartjs-2";
import { Provider } from "react-redux";

export const dependencies = [zodResolver, Chart, Provider];
