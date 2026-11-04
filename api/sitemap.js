import { sbSelect, sbCount, esc, partUrl, SITE, PAGE_SIZE, HAS_IMAGES } from './_lib.js';

// Each child sitemap holds PAGE_SIZE URLs (<= Supabase's per-response row cap), so
// the index must be sized with the same number. Paging by a bigger step than the
// cap silently skips listings. Only listings with a photo are included: imageless
// parts are noindex'd on the page itself (see part.js).
const ACTIVE = `listings?status=eq.active&${HAS_IMAGES}`;

export default async function handler(req, res) {
  try {
    const page = parseInt(req.query.page || '0', 10);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

    // /sitemap.xml -> index pointing at the child sitemaps
    if (!page) {
      const total = await sbCount(ACTIVE);
      const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
      const parts = [`<sitemap><loc>${SITE}/sitemap-pages.xml</loc></sitemap>`];
      for (let i = 1; i <= pages; i++) {
        parts.push(`<sitemap><loc>${SITE}/sitemap-parts-${i}.xml</loc></sitemap>`);
      }
      return res.status(200).send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${parts.join('')}</sitemapindex>`
      );
    }

    // /sitemap-parts-N.xml
    const from = (page - 1) * PAGE_SIZE;
    const rows = await sbSelect(
      `${ACTIVE}&select=id,name,make,model,created_at,images` +
      `&order=created_at.desc,id.asc&offset=${from}&limit=${PAGE_SIZE}`
    );

    const urls = rows.map(p => {
      const lastmod = (p.created_at || '').slice(0, 10);
      const img = Array.isArray(p.images) && p.images[0];
      return `<url><loc>${esc(partUrl(p))}</loc>` +
        (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
        (img ? `<image:image><image:loc>${esc(img)}</image:loc><image:title>${esc(p.name)}</image:title></image:image>` : '') +
        `</url>`;
    }).join('');

    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls}</urlset>`
    );
  } catch (err) {
    // A 5xx tells Google to retry later; an empty 200 urlset would tell it the sitemap is empty.
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><error>temporarily unavailable</error>');
  }
}
