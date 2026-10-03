/**
 * Request header carrying the verified user id from middleware.ts to the service-role
 * client (lib/db/client.ts), and on to PostgREST, where audit_row() (migration 0010)
 * records it as audit_log.actor. Kept out of client.ts so the edge middleware bundle
 * doesn't pull in next/headers.
 */
export const ACTOR_HEADER = "x-app-actor";
