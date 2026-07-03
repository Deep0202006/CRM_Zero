import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export async function proxy(req: NextRequest) {
  let res = NextResponse.next({
    request: {
      headers: req.headers,
    },
  });
  
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[proxy] Supabase env vars missing — auth guard cannot run. Check .env.local (dev) or Vercel Environment Variables (production).");
    return NextResponse.next();
  }

  const supabase = createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          res = NextResponse.next({
            request: req,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            res.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // If there is no user and the user is trying to access a protected route,
  // redirect them to the login page.
  if (!user && !req.nextUrl.pathname.startsWith('/login') && req.nextUrl.pathname !== '/') {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/login';
    return NextResponse.redirect(redirectUrl);
  }

  // If there is a user and the user is on the login page, redirect them to the dashboard.
  if (user && req.nextUrl.pathname.startsWith('/login')) {
    const redirectUrl = req.nextUrl.clone();
    redirectUrl.pathname = '/dashboard';
    return NextResponse.redirect(redirectUrl);
  }

  return res;
}

// Specify the paths that the middleware should run on.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - manifest.json / icon.png / icon512_maskable.png / icon512_rounded.png (PWA files)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|manifest.json|icon.*\\.png).*)',
  ],
};
