import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Chart } from "react-chartjs-2";
import { Provider } from "react-redux";

export const schema = z.string();
export const dependencies = [zodResolver, Chart, Provider];
