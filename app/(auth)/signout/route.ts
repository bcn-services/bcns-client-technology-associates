import { NextResponse, type NextRequest } from "next/server";
import { createUserClient } from "@/lib/auth/client";
import { publicUrl } from "@/lib/public-url";

/** POST only: a GET sign-out is a CSRF-able link. signOut() clears the sb-* cookies via cookies(). */
export async function POST(request: NextRequest): Promise<NextResponse> {
  await createUserClient()?.auth.signOut();
  return NextResponse.redirect(publicUrl("/login", request), 303);
}
