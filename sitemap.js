import { sbSelect, esc, partUrl, SUPABASE_URL, SUPABASE_ANON, SITE } from './_lib.js';

const PER_PAGE = 5000; // Google's limit is 50k URLs / 50MB per sitemap

export default async function handler(req, res) {
  try {
    const page = parseInt(req.query.page || '0', 10);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

    // /sitemap.xml -> index pointing at the child sitemaps
    if (!page) {
      let total = 0;
      try {
        const countRes = await fetch(
          `${SUPABASE_URL}/rest/v1/listings?status=eq.active&select=id&limit=1`,
          {
            headers: {
              apikey: SUPABASE_ANON,
              Authorization: `Bearer ${SUPABASE_ANON}`,
              Prefer: 'count=exact',
              Range: '0-0'
            }
          }
        );
        const range = countRes.headers.get('content-range') || '';
        total = parseInt(range.split('/')[1] || '0', 10) || 0;
      } catch (e) { total = 0; }

      const pages = Math.max(1, Math.ceil(total / PER_PAGE));
      const today = new Date().toISOString().slice(0, 10);

      const parts = [`<sitemap><loc>${SITE}/sitemap-pages.xml</loc><lastmod>${today}</lastmod></sitemap>`];
      for (let i = 1; i <= pages; i++) {
        parts.push(`<sitemap><loc>${SITE}/sitemap-parts-${i}.xml</loc><lastmod>${today}</lastmod></sitemap>`);
      }
      return res.status(200).send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${parts.join('')}</sitemapindex>`
      );
    }

    // /sitemap-parts-N.xml
    const from = (page - 1) * PER_PAGE;
    const rows = await sbSelect(
      `listings?status=eq.active&select=id,name,make,model,created_at,images` +
      `&order=created_at.desc&offset=${from}&limit=${PER_PAGE}`
    );

    const urls = rows.map(p => {
      const lastmod = (p.created_at || '').slice(0, 10);
      const img = Array.isArray(p.images) && p.images[0];
      return `<url><loc>${esc(partUrl(p))}</loc>` +
        (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
        `<changefreq>weekly</changefreq><priority>0.7</priority>` +
        (img ? `<image:image><image:loc>${esc(img)}</image:loc><image:title>${esc(p.name)}</image:title></image:image>` : '') +
        `</url>`;
    }).join('');

    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls}</urlset>`
    );
  } catch (err) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
}
