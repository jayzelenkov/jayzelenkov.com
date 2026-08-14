import { geolocation, ipAddress, next } from "@vercel/functions";

export const config = {
  matcher: ["/((?!.*\\..*).*)"],
};

const PAGEVIEW_COOKIE = "pv";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function middleware(request, context) {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/_ping") {
    await recordPing(request);
    return new Response(null, { status: 204 });
  }

  if (request.method === "GET") {
    const pageviewId = crypto.randomUUID();
    context.waitUntil(recordPageview(request, pageviewId));
    return next({
      headers: {
        "Set-Cookie": `${PAGEVIEW_COOKIE}=${pageviewId}; Path=/; Max-Age=1800; SameSite=Lax; Secure`,
      },
    });
  }

  return next();
}

async function recordPageview(request, pageviewId) {
  const supabase = supabaseConfig();
  if (!supabase) {
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
  const userAgent = request.headers.get("user-agent");
  const { isCrawler, isLlm, botName } = classifyRequest(request);

  try {
    const response = await fetch(`${supabase.url}/rest/v1/pageviews`, {
      method: "POST",
      headers: supabase.headers,
      body: JSON.stringify({
        path: url.pathname,
        referrer: request.headers.get("referer"),
        country: country || null,
        city: city || null,
        user_agent: userAgent,
        visitor_hash: await hashVisitor(ipAddress(request), userAgent),
        is_crawler: isCrawler,
        is_llm: isLlm,
        bot_name: botName,
        pageview_id: pageviewId,
      }),
    });

    if (!response.ok) {
      console.error("pageview insert failed", response.status);
    }
  } catch (error) {
    console.error("pageview insert failed", error);
  }
}

// Visible-tab heartbeats every 10s. Time on path ≈ ping count * 10.
// Active now: created_at > now() - interval '20 seconds'
// Inactive/bounce: pageviews with no matching pings.
async function recordPing(request) {
  const supabase = supabaseConfig();
  if (!supabase) {
    return;
  }

  const { isCrawler, isLlm } = classifyRequest(request);
  if (isCrawler || isLlm) {
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await request.text());
  } catch {
    return;
  }

  const pageviewId = payload.id || cookieValue(request, PAGEVIEW_COOKIE);
  const path = payload.path;
  if (
    !UUID_RE.test(pageviewId || "") ||
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.length > 512 ||
    /[?\s]/.test(path)
  ) {
    return;
  }

  const userAgent = request.headers.get("user-agent");

  try {
    const response = await fetch(`${supabase.url}/rest/v1/pings`, {
      method: "POST",
      headers: supabase.headers,
      body: JSON.stringify({
        pageview_id: pageviewId,
        path,
        visitor_hash: await hashVisitor(ipAddress(request), userAgent),
      }),
    });

    if (!response.ok) {
      console.error("ping insert failed", response.status);
    }
  } catch (error) {
    console.error("ping insert failed", error);
  }
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }

  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
  };
}

function cookieValue(request, name) {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function hashVisitor(ip, userAgent) {
  if (!ip) {
    return null;
  }

  const salt = process.env.VISITOR_HASH_SALT || "";
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}|${ip}|${userAgent || ""}`)
  );

  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

// Classify by declared identity in User-Agent and Signature-Agent (Web Bot Auth).
// LLM tokens win: a GPTBot request is is_llm, not is_crawler.
// Human pageviews: WHERE NOT is_crawler AND NOT is_llm
const LLM_AGENTS = [
  ["gptbot", /gptbot/i],
  ["chatgpt-user", /chatgpt-user/i],
  ["oai-searchbot", /oai-searchbot/i],
  ["chatgpt", /chatgpt/i],
  ["claudebot", /claudebot/i],
  ["claude-searchbot", /claude-searchbot/i],
  ["claude-user", /claude-user/i],
  ["anthropic", /anthropic/i],
  ["claude-web", /claude-web/i],
  ["google-agent", /google-agent|agent\.bot\.goog/i],
  ["google-cloudvertexbot", /google-cloudvertexbot/i],
  ["google-notebooklm", /google-notebooklm|gemini[\s-]?notebook/i],
  ["gemini", /gemini/i],
  ["perplexitybot", /perplexitybot/i],
  ["perplexity-user", /perplexity-user/i],
  ["perplexity", /perplexity/i],
  ["exasearchbot", /exasearchbot/i],
  ["exa", /\bexa\b|exa\.ai/i],
  ["youbot", /youbot/i],
  ["duckassistbot", /duckassistbot/i],
  ["mistral", /mistralai(?:-user)?|\bmistral\b/i],
  ["meta-externalagent", /meta-externalagent/i],
  ["meta-externalfetcher", /meta-externalfetcher/i],
  ["bytespider", /bytespider/i],
  ["cohere", /cohere(?:bot|-ai)?/i],
  ["ai2bot", /ai2bot/i],
  ["timpibot", /timpibot/i],
  ["diffbot", /diffbot/i],
  ["firecrawl", /firecrawl/i],
  ["phind", /phind(?:bot)?/i],
  ["grok", /\bgrok\b|xai-grok|\bxai\b/i],
  ["copilot", /copilot/i],
  ["iaskspider", /iaskspider/i],
];

const CRAWLER_AGENTS = [
  ["googlebot", /googlebot/i],
  ["google", /adsbot-google|apis-google|mediapartners-google|feedfetcher-google|google-inspectiontool|storebot-google|google-read-aloud|googleother|googleproducer|google-site-verification/i],
  ["bingbot", /bingbot|msnbot|adidxbot|bingpreview/i],
  ["applebot", /applebot/i],
  ["amazonbot", /amazonbot/i],
  ["ccbot", /ccbot/i],
  ["duckduckbot", /duckduckbot/i],
  ["yandex", /yandex(?:bot|com\/bots)/i],
  ["baiduspider", /baiduspider/i],
  ["slurp", /\bslurp\b/i],
  ["facebook", /facebookexternalhit|facebot/i],
  ["twitterbot", /twitterbot/i],
  ["linkedinbot", /linkedinbot/i],
  ["slackbot", /slackbot/i],
  ["discordbot", /discordbot/i],
  ["whatsapp", /whatsapp/i],
  ["telegrambot", /telegrambot/i],
  ["pinterest", /pinterest(?:bot)?/i],
  ["preview", /skypeuripreview|slack-img|discordcard/i],
  ["semrush", /semrush/i],
  ["ahrefsbot", /ahrefsbot/i],
  ["mj12bot", /mj12bot/i],
  ["dotbot", /dotbot/i],
  ["petalbot", /petalbot|petalsearch/i],
  ["screaming-frog", /screaming frog/i],
  ["ia_archiver", /ia_archiver/i],
  ["pingdom", /pingdom/i],
  ["uptimerobot", /uptimerobot/i],
  ["lighthouse", /lighthouse|pagespeed/i],
  ["headless", /headlesschrome|phantomjs|puppeteer|playwright/i],
  ["http-client", /(?:^| )(?:curl|wget|httpie)\b|python-requests|python-urllib|go-http-client|libwww-perl|okhttp|scrapy|axios\/|node-fetch|undici/i],
];

const GENERIC_CRAWLER_RE =
  /bot\b|crawler|spider|crawling|\bslurp\b|preview\/|monitor|checker/i;
const GENERIC_CRAWLER_EXCLUDE_RE = /cubot/i;

function classifyRequest(request) {
  const userAgent = request.headers.get("user-agent") || "";
  const signatureAgent = request.headers.get("signature-agent") || "";
  const haystack = `${userAgent} ${signatureAgent}`.trim();

  const llmName = matchAgent(haystack, LLM_AGENTS);
  if (llmName) {
    return { isCrawler: false, isLlm: true, botName: llmName };
  }

  if (!userAgent.trim()) {
    return { isCrawler: true, isLlm: false, botName: "empty-ua" };
  }

  const crawlerName = matchAgent(haystack, CRAWLER_AGENTS);
  if (crawlerName) {
    return { isCrawler: true, isLlm: false, botName: crawlerName };
  }

  if (
    GENERIC_CRAWLER_RE.test(userAgent) &&
    !GENERIC_CRAWLER_EXCLUDE_RE.test(userAgent)
  ) {
    return { isCrawler: true, isLlm: false, botName: "crawler" };
  }

  return { isCrawler: false, isLlm: false, botName: null };
}

function matchAgent(haystack, agents) {
  for (const [name, pattern] of agents) {
    if (pattern.test(haystack)) {
      return name;
    }
  }
  return null;
}
