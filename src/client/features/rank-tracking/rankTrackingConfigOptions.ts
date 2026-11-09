import { SERP_LANGUAGE_OPTIONS } from "@/shared/keyword-locations";
import { pagesToDepth } from "@/shared/rank-tracking";
import type { SaveConfigInput } from "./useSaveConfigMutations";

export const LANGUAGE_ITEMS = SERP_LANGUAGE_OPTIONS.map((language) => ({
  value: language.code,
  label: language.label,
}));

export const DEVICE_ITEMS: {
  value: SaveConfigInput["devices"];
  label: string;
}[] = [
  { value: "both", label: "Desktop + Mobile" },
  { value: "desktop", label: "Desktop only" },
  { value: "mobile", label: "Mobile only" },
];

export const DEPTH_ITEMS = Array.from({ length: 10 }, (_, i) => i + 1).map(
  (pages) => ({
    value: pagesToDepth(pages),
    label: `${pages} ${pages === 1 ? "page" : "pages"} (top ${pages * 10} results)`,
  }),
);

export const SOURCE_ITEMS: {
  value: SaveConfigInput["source"];
  label: string;
}[] = [
  { value: "gsc", label: "Search Console (free, your own site)" },
  { value: "dataforseo", label: "Live Google results (DataForSEO key)" },
];
