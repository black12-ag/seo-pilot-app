import { queryOptions, useQuery } from "@tanstack/react-query";
import { getSeoApiKeyStatus } from "@/serverFunctions/config";
import { dataforseoPageFor } from "./dataforseoPages";

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

/** Whether a page needs the DataForSEO key this install doesn't have. */
export function useNeedsDataforseoKey(enabled = true) {
  const status = useQuery({ ...dataforseoStatusQueryOptions(), enabled }).data;
  return (path: string) =>
    status?.configured === false &&
    dataforseoPageFor(path, status.ownAiEngine.available) !== null;
}

/** Whether the installation's own AI engine can answer AI visibility prompts. */
export function useOwnAiEngineAvailable(enabled = true): boolean {
  const query = useQuery({ ...dataforseoStatusQueryOptions(), enabled });
  return query.data?.ownAiEngine.available ?? false;
}
