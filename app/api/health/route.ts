/**
 * /api/health — external uptime probe target (UptimeRobot per the hosting
 * reference). Thin adapter over lib/health.ts's pure evaluation.
 *
 * 200 when the DB is connected OR no DB is configured (keyless template runs
 * must not look down); 503 when a configured DB fails its ping.
 */

import { NextResponse } from "next/server";
import { getConfig } from "@/lib/env";
import { evaluateHealth } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const report = await evaluateHealth(getConfig());
  return NextResponse.json(report, { status: report.ok ? 200 : 503 });
}
