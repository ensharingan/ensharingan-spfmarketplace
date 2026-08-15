import { sbSelect, esc, slugify, SITE } from './_lib.js';

export default async function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    const today = new Date().toISOString().slice(0, 10);

    const rows = await sbSelect('listings?status=eq.active&select=make&limit=10000');
    // Declare one URL per make, slugified. encodeURIComponent left spaces as %20,
    // which shipped URLs like /brand/cam%20rhino that Google discovered and skipped.
    const makes = [...new Set(
      rows.map(r => slugify(r.make)).filter(m => m && m !== 'other')
    )].sort();

    const shops = await sbSelect("sellers?seller_type=eq.business&select=slug,business_name");

    const urls = [
      `<url><loc>${SITE}/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`,
      ...makes.map(m =>
        `<url><loc>${SITE}/brand/${esc(m)}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`
      ),
      ...shops.filter(s => s.slug).map(s =>
        `<url><loc>${SITE}/shop/${esc(s.slug)}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.6</priority></url>`
      )
    ].join('');

    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`
    );
  } catch (err) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
}
