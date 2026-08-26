import { CatalogBrowse } from "@/components/CatalogBrowse";

// Real, live Cinemeta catalog data — never statically prerendered.
export const dynamic = "force-dynamic";

export default function SeriesPage() {
  return <CatalogBrowse type="series" pageTitle="Series" />;
}
