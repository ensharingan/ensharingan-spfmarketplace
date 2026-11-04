import { sbSelect, sbSelectAll, esc, getMakeIndex, SITE, MIN_BRAND_LISTINGS } from './_lib.js';

export default async function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');

    // Canonical brands only (Mercedes / Mercedes-Benz / MERCEDES BENZ are one), and
    // only brands with enough stock to be a useful page.
    const makes = [...(await getMakeIndex()).values()]
      .filter(m => m.count >= MIN_BRAND_LISTINGS)
      .sort((a, b) => b.count - a.count);

    // Shops: approved businesses that actually have something listed.
    const shops = await sbSelect(
      'sellers?seller_type=eq.business&status=eq.approved&select=id,slug&limit=1000'
    );
    const listed = await sbSelectAll('listings?status=eq.active&select=seller_id&order=id.asc');
    const withStock = new Set(listed.map(r => r.seller_id));

    const urls = [
      `<url><loc>${SITE}/</loc></url>`,
      ...makes.map(m => `<url><loc>${SITE}/brand/${esc(m.slug)}</loc></url>`),
      ...shops
        .filter(s => s.slug && /^[a-z0-9-]+$/.test(s.slug) && withStock.has(s.id))
        .map(s => `<url><loc>${SITE}/shop/${esc(s.slug)}</loc></url>`)
    ].join('');

    return res.status(200).send(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`
    );
  } catch (err) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).send('<?xml version="1.0" encoding="UTF-8"?><error>temporarily unavailable</error>');
  }
}
