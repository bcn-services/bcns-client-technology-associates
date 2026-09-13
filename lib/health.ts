/**
 * health.ts — Pure health evaluation for the /api/health endpoint.
 *
 * The logic lives in @bcn-services/app-core (shared platform code — fixes
 * propagate by version bump); this file just re-exports it so app code
 * imports from "@/lib/health". See app-core's health.ts for the platform
 * rules (real DB probe for UptimeRobot; keyless runs report
 * ok/unconfigured, a configured-but-failing DB ping is a 503).
 */

export {
  type DbStatus,
  type HealthReport,
  type DbPing,
  pingSupabase,
  evaluateHealth,
} from "@bcn-services/app-core";
