/** Default for single-contact requests only; bulk rescans require their own configuration. */
export const CONTACT_ENRICHMENT_WEBHOOK = "https://webhook.hostdosul.com/webhook/zapcrm-ai-enrich";

export function contactEnrichmentWebhook(configuredUrl: string | null | undefined): string {
  return configuredUrl?.trim() || CONTACT_ENRICHMENT_WEBHOOK;
}