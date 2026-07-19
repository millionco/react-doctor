// rule: hook-import-rename-loses-use-prefix
// weakness: wrapper-transparency
// source: deep review of PR #1359

import { useQuery as query } from "@tanstack/react-query";

export const useProducts = () => query({ queryKey: ["products"] });
