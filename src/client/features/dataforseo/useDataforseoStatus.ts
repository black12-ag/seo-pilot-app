import { queryOptions, useQuery } from "@tanstack/react-query";
import { getSeoApiKeyStatus } from "@/serverFunctions/config";

export const dataforseoStatusQueryOptions = () =>
  queryOptions({
    queryKey: ["seoApiKeyStatus"],
    queryFn: () => getSeoApiKeyStatus(),
    staleTime: 5 * 60_000,
  });

/** True or false once known. Null while loading, or if the check failed. */
export function useDataforseoConfigured(enabled = true): boolean | null {
  const query = useQuery({ ...dataforseoStatusQueryOptions(), enabled });
  return query.data?.configured ?? null;
}
