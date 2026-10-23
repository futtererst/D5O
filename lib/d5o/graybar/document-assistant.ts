/** Optional advisory provider. Outputs are never business commands or approval facts. */
export type GraybarSuggestion = { kind: "extraction" | "product-fit" | "comparison" | "match" | "exception";
  text: string; sourceDocumentId: string; sourceLocation: string; confidence: "review" };
export interface GraybarDocumentAssistant {
  readonly status: "configured" | "unavailable";
  suggest(documentId: string, sourceBytes: Uint8Array): Promise<GraybarSuggestion[]>;
}
export const graybarDocumentAssistant: GraybarDocumentAssistant = {
  status: "unavailable",
  async suggest() { throw new Error("graybar_ai_provider_unavailable"); },
};
