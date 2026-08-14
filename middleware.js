import { geolocation, next } from "@vercel/functions";

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};

export default function middleware(request, context) {
  if (request.method === "GET") {
    context.waitUntil(recordPageview(request));
  }

  return next();
}

async function recordPageview(request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return;
  }

  if (request.headers.get("sec-purpose") === "prefetch") {
    return;
  }

  const url = new URL(request.url);
  if (/\.[a-z0-9]+$/i.test(url.pathname)) {
    return;
  }

  const { country, city } = geolocation(request);

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/pageviews`, {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        path: url.pathname,
        referrer: request.headers.get("referer"),
        country: country || null,
        city: city || null,
        user_agent: request.headers.get("user-agent"),
      }),
    });

    if (!response.ok) {
      console.error("pageview insert failed", response.status);
    }
  } catch (error) {
    console.error("pageview insert failed", error);
  }
}
