export interface RfxItem {
  itemCode: string;
  description: string;
  spec: string;
  quantity: number;
  unit: string;
}

export interface Rfx {
  rfxId: string;
  title: string;
  buyer: string;
  issuedOn: string;
  responseDueBy: string;
  deliveryLocation: string;
  items: RfxItem[];
}

/** How a vendor's file expressed a price, so extraction can be checked against it. */
export interface GroundTruthLine {
  itemCode: string;
  /** Per-unit price in INR as the vendor effectively quoted it (before any footnote discount). null = not stated. */
  quotedUnitPriceINR: number | null;
  /** The number as it literally appears in the file, in the file's currency/unit basis. */
  statedValue: number | null;
  statedBasis: "per_unit" | "per_box_100" | "not_stated";
  currency: "INR" | "USD";
  /** What the unit price would be if the vendor had priced it (used for the "same as last year" lines). */
  referenceUnitPriceINR: number;
  note?: string;
}

export interface GroundTruthVendor {
  vendorId: string;
  vendorName: string;
  file: string;
  currency: "INR" | "USD";
  flaws: string[];
  /** Fractional discount applicable to the whole quote (e.g. 0.05), disclosed only in a footnote. */
  hiddenDiscount: number;
  lines: GroundTruthLine[];
}

export interface GroundTruth {
  generatedFrom: string;
  fxRateInrPerUsd: number;
  vendors: GroundTruthVendor[];
}
