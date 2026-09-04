type ErpCategory = { erp_name: string; count: number; share_percent: number };

export type ErpSegment = {
  unique_businesses: number;
  observed_count: number;
  erp_using_count: number;
  none_count: number;
  not_captured_count: number;
  coverage_percent: number;
  categories: ErpCategory[];
};

export function buildErpIntelligenceExportRows(
  segment: "Retailer" | "Distributor",
  value?: ErpSegment,
) {
  const summary = value ?? { unique_businesses: 0, observed_count: 0, erp_using_count: 0, none_count: 0, not_captured_count: 0, coverage_percent: 0, categories: [] };
  return [
    { Segment: segment, Section: "Summary", Metric: "Unique businesses", Value: summary.unique_businesses, Category: "", Businesses: "", "Share %": "" },
    { Segment: segment, Section: "Summary", Metric: "Observed businesses", Value: summary.observed_count, Category: "", Businesses: "", "Share %": "" },
    { Segment: segment, Section: "Summary", Metric: "ERP using", Value: summary.erp_using_count, Category: "", Businesses: "", "Share %": "" },
    { Segment: segment, Section: "Summary", Metric: "Explicit None", Value: summary.none_count, Category: "", Businesses: "", "Share %": "" },
    { Segment: segment, Section: "Summary", Metric: "Not captured", Value: summary.not_captured_count, Category: "", Businesses: "", "Share %": "" },
    { Segment: segment, Section: "Summary", Metric: "Coverage %", Value: summary.coverage_percent, Category: "", Businesses: "", "Share %": "" },
    ...summary.categories.map((category) => ({ Segment: segment, Section: "Latest unique business category", Metric: "", Value: "", Category: category.erp_name, Businesses: category.count, "Share %": category.share_percent })),
  ];
}
