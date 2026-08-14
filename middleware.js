import { geolocation, ipAddress, next } from "@vercel/functions";

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
  const userAgent = request.headers.get("user-agent");
  const { isCrawler, isLlm, botName } = classifyRequest(request);

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
        user_agent: userAgent,
        visitor_hash: await hashVisitor(ipAddress(request), userAgent),
        is_crawler: isCrawler,
        is_llm: isLlm,
        bot_name: botName,
      }),
    });

    if (!response.ok) {
      console.error("pageview insert failed", response.status);
    }
  } catch (error) {
    console.error("pageview insert failed", error);
  }
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
