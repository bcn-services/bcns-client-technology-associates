/**
 * webhooks.ts — Generic inbound-webhook hygiene helpers.
 *
 * The pipeline lives in @bcn-services/app-core (shared platform code — fixes
 * propagate by version bump); this file just re-exports it. Platform rules:
 * every inbound webhook verifies its signature and every handler is
 * idempotent. There are deliberately NO provider-specific routes in the
 * template — which processor/SMS/accounting webhooks a client needs is a
 * per-client decision. Client builds wire a provider's real verifier
 * (e.g. Stripe's `webhooks.constructEvent`, Twilio's request validation)
 * into these seams.
 */

export {
  type SignatureVerifier,
  type ProcessedEventStore,
  type WebhookOutcome,
  unverifiedVerifier,
  createMemoryEventStore,
  processWebhook,
} from "@bcn-services/app-core";
