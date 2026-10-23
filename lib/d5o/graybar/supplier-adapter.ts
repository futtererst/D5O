/** All supplier channels must produce reviewed document/offer/order facts through the same typed commands. */
export type GraybarCapability = "pricingAvailability" | "quoteExchange" | "poSubmission" | "acknowledgments" | "shipments" | "invoices";
export type SupplierObservation = { capability: GraybarCapability; channel: "document" | "direct"; sourceId: string; observedAt: string; payload: unknown };
export interface GraybarSupplierAdapter {
  readonly channel: "document" | "direct";
  readonly capabilities: Readonly<Record<GraybarCapability, "configured" | "unconfigured">>;
  observe(capability: GraybarCapability, reference: string): Promise<SupplierObservation>;
}
const unavailable = { pricingAvailability: "unconfigured", quoteExchange: "unconfigured", poSubmission: "unconfigured",
  acknowledgments: "unconfigured", shipments: "unconfigured", invoices: "unconfigured" } as const;
export const graybarDirectAdapter: GraybarSupplierAdapter = {
  channel: "direct", capabilities: unavailable,
  async observe() { throw new Error("graybar_direct_connection_unconfigured"); },
};
export const graybarDocumentCapabilities = { quoteExchange: "configured", acknowledgments: "configured",
  shipments: "configured", invoices: "configured", pricingAvailability: "unconfigured", poSubmission: "unconfigured" } as const;
