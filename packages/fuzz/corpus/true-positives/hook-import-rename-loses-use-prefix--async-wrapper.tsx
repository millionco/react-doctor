// rule: hook-import-rename-loses-use-prefix
// weakness: control-flow
// source: deep review of PR #1359

import { useQuery as query } from "@tanstack/react-query";

export const useProducts = async () => query({ queryKey: ["products"] });
