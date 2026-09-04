import { NextResponse, type NextRequest } from "next/server";
import { getServerBackendEnvironment } from "./lib/serverBackendIdentity";

export function proxy(request: NextRequest) {
  const backend = getServerBackendEnvironment();
  if (backend.status === "configured") return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        error: "BACKEND_UNAVAILABLE",
        deployment: backend.deployment,
        reason: backend.reason,
      },
      { status: 503 },
    );
  }

  if (request.nextUrl.pathname === "/login") return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|.*\\..*).*)",
  ],
};
