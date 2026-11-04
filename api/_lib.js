// Shared helpers for the SEO/serverless endpoints.
// Uses the public anon key (already exposed in index.html) over Supabase REST,
// so there are no npm dependencies and no build step.

export const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://ycoclceordqbeumeujzf.supabase.co';

// The anon key is public by design (it ships in index.html). The fallback means
// these endpoints keep working even if SUPABASE_ANON_KEY is not set on Vercel;
// without it every request 401s and sitemaps/part pages silently break.
export const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inljb2NsY2VvcmRxYmV1bWV1anpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3OTYyODQsImV4cCI6MjA5MDM3MjI4NH0.C2WvWR1MVMWJPJ6fHgcuEZLNC3HeElYsFjWSTFhrmzo';

export const SITE = process.env.SITE_URL
  || 'https://marketplace.sparepartsfinder.co.za';

// Supabase caps a single REST response (default max-rows = 1000). Anything that
// needs more rows must page through them, and every page size here stays <= 1000.
export const PAGE_SIZE = 1000;

// Brand pages with fewer listings than this are thin: noindex'd and kept out of the sitemap.
export const MIN_BRAND_LISTINGS = 3;

// Listings without a photo are not indexed (thin, and Google drops them anyway).
export const HAS_IMAGES = 'images=not.is.null&images=neq.' + encodeURIComponent('{}');

const HEADERS = {
  apikey: SUPABASE_ANON,
  Authorization: `Bearer ${SUPABASE_ANON}`,
  Accept: 'application/json'
};

export async function sbSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// Pages through a query until the rows run out. `path` MUST carry a deterministic
// order (e.g. order=id.asc) or rows can repeat/skip between pages.
export async function sbSelectAll(path, max = 50000) {
  const out = [];
  for (let off = 0; off < max; off += PAGE_SIZE) {
    const rows = await sbSelect(`${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_SIZE}&offset=${off}`);
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

// Exact row count for a filtered query, via the Content-Range header.
export async function sbCount(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}${path.includes('?') ? '&' : '?'}select=id&limit=1`, {
    headers: { ...HEADERS, Prefer: 'count=exact', Range: '0-0' }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return parseInt((res.headers.get('content-range') || '').split('/')[1] || '0', 10) || 0;
}

export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function slugify(v) {
  return String(v || '')
    .toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}

// ---------------------------------------------------------------------------
// Make normalisation. Seller feeds store makes inconsistently ("Mercedes",
// "Mercedes-Benz", "MERCEDES BENZ"; model names or "A | B" pairs in the make
// field). We fold them into one canonical brand in code so the database is
// untouched and the mapping is easy to extend.
// ---------------------------------------------------------------------------
export function makeKey(v) {
  return String(v || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

const MAKE_ALIASES = {
  'mercedes': 'Mercedes-Benz',
  'mercedes benz': 'Mercedes-Benz',
  'mini mini cooper': 'Mini',
  'mini cooper': 'Mini',
  'honda honda jazz': 'Honda',
  'land rover range rover': 'Land Rover',
  'range rover': 'Land Rover',
  'mahindra bolero': 'Mahindra',
  'daihatsu gran max': 'Daihatsu',
  'daewoo nubira': 'Daewoo',
  'captur 2017 2020': 'Renault',
  'kiger 2021': 'Renault',
  'megane 2012 2016': 'Renault'
};
const NOT_A_MAKE = new Set(['', 'other', 'car parts', 'various']);
const KEEP_UPPER = new Set(['bmw', 'gwm', 'mg', 'jac', 'bak']);

// Old slugs that were indexed under the messy names 301 to the canonical brand.
export const BRAND_SLUG_REDIRECTS = Object.fromEntries(
  Object.entries(MAKE_ALIASES).map(([k, v]) => [slugify(k), slugify(v)])
);

export function canonMake(raw) {
  const k = makeKey(raw);
  if (NOT_A_MAKE.has(k)) return null;
  if (MAKE_ALIASES[k]) return MAKE_ALIASES[k];
  const s = String(raw).trim().replace(/\s+/g, ' ');
  if (s !== s.toUpperCase() && s !== s.toLowerCase()) return s; // already mixed case
  if (KEEP_UPPER.has(k)) return k.toUpperCase();
  return s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
}

// slug -> { slug, name, count, variants:Set<raw make strings> }, cached per warm instance.
let _makeIdx = null, _makeIdxAt = 0;
export async function getMakeIndex() {
  if (_makeIdx && Date.now() - _makeIdxAt < 10 * 60 * 1000) return _makeIdx;
  const rows = await sbSelectAll('listings?status=eq.active&select=make&order=id.asc');
  const map = new Map();
  for (const r of rows) {
    const raw = String(r.make || '').trim();
    const name = canonMake(raw);
    if (!name) continue;
    const slug = slugify(name);
    if (!slug) continue;
    let e = map.get(slug);
    if (!e) { e = { slug, name, count: 0, variants: new Set() }; map.set(slug, e); }
    e.count++;
    e.variants.add(raw);
  }
  _makeIdx = map; _makeIdxAt = Date.now();
  return map;
}

// PostgREST in.() list for a set of raw make strings.
export function makeInList(variants) {
  return '(' + [...variants].map(v => '"' + String(v).replace(/"/g, '') + '"').join(',') + ')';
}

// A part's canonical URL: readable slug plus the id, so the slug can change freely.
// NOTE: keep this stable. Changing it re-slugs every indexed part URL.
export function partUrl(p) {
  const slug = slugify([p.make, p.model, p.name].filter(Boolean).join(' '));
  return `${SITE}/part/${slug ? slug + '-' : ''}${p.id}`;
}

export function idFromSlug(slug) {
  const s = String(slug || '');
  const uuid = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return uuid ? uuid[0] : null;
}

export function hasPrice(p) {
  return Number(p && p.price) > 0;
}

export function hasImages(p) {
  return Array.isArray(p && p.images) && p.images.some(Boolean);
}

export function money(p) {
  return hasPrice(p) ? 'R ' + Number(p.price).toLocaleString('en-ZA') : 'Enquire for price';
}

// Google wants "new" / "used" / "refurbished"
export function gCondition(c) {
  const t = String(c || '').toLowerCase();
  if (t.includes('new')) return 'new';
  if (t.includes('refurb') || t.includes('recon')) return 'refurbished';
  return 'used';
}

// Seller descriptions arrive as raw HTML from WooCommerce/SEO plugins and often
// carry their own (malformed) JSON-LD <script> blocks. Those must never reach the
// page: duplicate or invalid structured data is worse than none.
const ALLOWED = /^(p|br|ul|ol|li|strong|b|em|i|h2|h3|h4)$/i;

export function sanitizeHtml(raw) {
  if (!raw) return '';
  let s = String(raw);
  // kill script/style/iframe blocks outright, tags and contents
  s = s.replace(/<(script|style|iframe|object|embed|noscript)\b[\s\S]*?<\/\1\s*>/gi, '');
  s = s.replace(/<(script|style|iframe|object|embed|noscript)\b[^>]*>/gi, '');
  // drop any tag not on the allowlist, and strip all attributes from those kept
  s = s.replace(/<\/?([a-z0-9]+)\b[^>]*>/gi, (m, tag) => {
    if (!ALLOWED.test(tag)) return '';
    return m[1] === '/' ? `</${tag.toLowerCase()}>` : `<${tag.toLowerCase()}>`;
  });
  s = s.replace(/(&nbsp;| )/g, ' ');
  return s.replace(/(\s*<p>\s*<\/p>\s*)+/g, '').trim();
}

export function plainText(raw) {
  if (!raw) return '';
  return String(raw)
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

// Trim to a length on a word boundary (meta descriptions: ~155 chars shows in full).
export function clip(text, max = 155) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.replace(/\s+\S*$/, '') + '…';
}

// Safe for embedding inside <script type="application/ld+json">.
export function jsonLd(obj) {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}

// ---------------------------------------------------------------------------
// Shared server-rendered page shell for brand and shop pages.
// ---------------------------------------------------------------------------
export const CARD_CSS = `
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px}
.card{border:1px solid var(--border);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;display:block}
.card:hover{border-color:var(--blue)}
.card img{width:100%;height:145px;object-fit:cover;display:block;background:var(--bg2)}
.card .b{padding:.7rem .8rem}
.card .n{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14.5px;text-transform:uppercase;line-height:1.2}
.card .m{font-size:11.5px;color:var(--text3);margin-top:3px}
.card .p{color:var(--blue);font-weight:700;font-size:14px;margin-top:6px}`;

export const BASE_CSS = `
:root{--blue:#1e5bb0;--red:#e31e24;--text:#0f1f38;--text2:#4a5b74;--text3:#8595ab;--border:#e3e8ef;--bg2:#f4f7fb}
*{box-sizing:border-box}
body{margin:0;font-family:Barlow,system-ui,sans-serif;color:var(--text);line-height:1.55;background:#fff}
header{background:var(--blue);padding:.85rem 1.2rem}
header a{display:inline-flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:18px;text-transform:uppercase}
header img{width:34px;height:34px;background:#fff;border-radius:6px;padding:4px}
main{max-width:1100px;margin:0 auto;padding:1.5rem 1.2rem 3rem}
nav.bc{font-size:12.5px;color:var(--text3);margin-bottom:1rem}
nav.bc a{color:var(--blue);text-decoration:none}
h1{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:900;text-transform:uppercase;margin:.3rem 0 .4rem}
.lede{font-size:14px;color:var(--text2);max-width:720px;margin-bottom:1.2rem}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1.4rem}
.chips span{background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:4px 11px;font-size:12px;color:var(--text2)}
${CARD_CSS}
.pager{display:flex;gap:8px;align-items:center;justify-content:center;margin:1.6rem 0 0;font-size:14px}
.pager a,.pager span{padding:7px 14px;border:1px solid var(--border);border-radius:8px;text-decoration:none;color:var(--blue)}
.pager span{color:var(--text3)}
.more{margin-top:2rem;border-top:1px solid var(--border);padding-top:1.1rem}
.more h2{font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin:0 0 .7rem}
.more a{display:inline-block;margin:0 6px 6px 0;padding:4px 11px;border:1px solid var(--border);border-radius:20px;font-size:12.5px;color:var(--text2);text-decoration:none}
.more a:hover{border-color:var(--blue);color:var(--blue)}
footer{border-top:1px solid var(--border);margin-top:2.5rem;padding:1.2rem;text-align:center;font-size:12px;color:var(--text3)}
footer a{color:var(--blue)}`;

export function partCard(p) {
  const img = (Array.isArray(p.images) && p.images[0]) || `${SITE}/assets/spf-logo.png`;
  const yrs = p.year_start ? `${p.year_start}–${p.year_end || 'on'}` : '';
  return `<a class="card" href="${esc(partUrl(p))}">
  <img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" width="215" height="145">
  <div class="b"><div class="n">${esc(p.name)}</div>
  <div class="m">${esc([p.model, yrs, p.condition].filter(Boolean).join(' · '))}</div>
  <div class="p">${esc(money(p))}</div></div></a>`;
}

export function shell({ title, desc, canonical, robots = 'index,follow,max-image-preview:large', prev, next, ld = [], body, ogImage }) {
  return `<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
${prev ? `<link rel="prev" href="${esc(prev)}">\n` : ''}${next ? `<link rel="next" href="${esc(next)}">\n` : ''}<meta name="robots" content="${esc(robots)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Spare Parts Finder">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="en_ZA">
<meta property="og:image" content="${esc(ogImage || SITE + '/assets/sell-banner.jpg')}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/icons/icon-192.png">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
${ld.map(o => `<script type="application/ld+json">${jsonLd(o)}</script>`).join('\n')}
<style>${BASE_CSS}</style>
</head>
<body>
<header><a href="/"><img src="/assets/spf-mark.png" alt="">Spare Parts Finder</a></header>
<main>
${body}
</main>
<footer>© ${new Date().getFullYear()} Spare Parts Finder — Marketplace · <a href="/">Browse all parts</a> · <a href="mailto:info@sparepartsfinder.co.za">info@sparepartsfinder.co.za</a></footer>
</body>
</html>`;
}

export function notFound(res, heading, msg) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=300');
  return res.status(404).send(`<!DOCTYPE html><html lang="en-ZA"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(heading)} | Spare Parts Finder</title>
<meta name="robots" content="noindex,follow">
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:1.5rem;color:#0f1f38;text-align:center}a{color:#1e5bb0}</style></head><body>
<h1>${esc(heading)}</h1>
<p>${esc(msg || '')}</p>
<p><a href="/">Browse the marketplace →</a></p>
</body></html>`);
}
