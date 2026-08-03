// Shared helpers for the SEO/serverless endpoints.
// Uses the public anon key (already exposed in index.html) over Supabase REST,
// so there are no npm dependencies and no build step.

export const SUPABASE_URL = process.env.SUPABASE_URL
  || 'https://ycoclceordqbeumeujzf.supabase.co';

export const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || '';

export const SITE = process.env.SITE_URL
  || 'https://marketplace.sparepartsfinder.co.za';

export async function sbSelect(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
      Accept: 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

export function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function slugify(v) {
  return String(v || '')
    .toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}

// A part's canonical URL: readable slug plus the id, so the slug can change freely.
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
  s = s.replace(/(&nbsp;|\u00a0)/g, ' ');
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
