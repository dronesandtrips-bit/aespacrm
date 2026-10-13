import { describe, expect, it } from "bun:test";
import { CONTACT_ENRICHMENT_WEBHOOK, contactEnrichmentWebhook } from "../src/lib/contact-enrichment";

describe("Single-contact enrichment connection", () => {
  it("uses the official production webhook when configuration is absent", () => {
    expect(contactEnrichmentWebhook(null)).toBe(CONTACT_ENRICHMENT_WEBHOOK);
    expect(contactEnrichmentWebhook(undefined)).toBe(CONTACT_ENRICHMENT_WEBHOOK);
    expect(contactEnrichmentWebhook("  ")).toBe(CONTACT_ENRICHMENT_WEBHOOK);
    expect(CONTACT_ENRICHMENT_WEBHOOK).toBe("https://webhook.hostdosul.com/webhook/zapcrm-ai-enrich");
  });
  it("preserves a configured integration instead of replacing it", () => {
    expect(contactEnrichmentWebhook(" https://example.com/custom-webhook ")).toBe("https://example.com/custom-webhook");
  });
});