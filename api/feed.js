import { sbSelect, esc, partUrl, gCondition, plainText, SITE } from './_lib.js';

// Google Shopping RSS 2.0 feed.
// Only listings with a real price and an image are eligible — Merchant Center
// rejects items without a price or a working image_link.
export default async function handler(req, res) {
  try {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=10800, stale-while-revalidate=43200');

    const rows = await sbSelect(
      'listings?status=eq.active&price=gt.0' +
      '&select=id,name,description,make,model,category,condition,price,sku,images,' +
      'year_start,year_end,body_code,engine_code,sellers(business_name)' +
      '&order=created_at.desc&limit=20000'
    );

    const items = rows.filter(p => Array.isArray(p.images) && p.images[0]).map(p => {
      const url = partUrl(p);
      const yrs = p.year_start ? `${p.year_start}-${p.year_end || 'on'}` : '';
      const fitment = [p.make, p.model, yrs].filter(Boolean).join(' ');
      const title = `${p.name}${fitment ? ' - ' + fitment : ''}`.slice(0, 150);
      const desc = (plainText(p.description) || `${p.condition || 'Used'} ${p.name}${fitment ? ' for ' + fitment : ''}. Sold by ${(p.sellers && p.sellers.business_name) || 'a verified seller'} on Spare Parts Finder.`)
        .replace(/\s+/g, ' ').trim().slice(0, 5000);
      const extra = [p.images[1], p.images[2], p.images[3]].filter(Boolean)
        .map(u => `<g:additional_image_link>${esc(u)}</g:additional_image_link>`).join('');
      const mpn = p.sku || p.body_code || p.engine_code || '';

      return `<item>
<g:id>${esc(p.id)}</g:id>
<g:title>${esc(title)}</g:title>
<g:description>${esc(desc)}</g:description>
<g:link>${esc(url)}</g:link>
<g:image_link>${esc(p.images[0])}</g:image_link>${extra}
<g:availability>in_stock</g:availability>
<g:price>${Number(p.price).toFixed(2)} ZAR</g:price>
<g:condition>${gCondition(p.condition)}</g:condition>
<g:brand>${esc(p.make && p.make !== 'Other' ? p.make : 'Spare Parts Finder')}</g:brand>
${mpn ? `<g:mpn>${esc(mpn)}</g:mpn>` : ''}
<g:identifier_exists>no</g:identifier_exists>
<g:product_type>${esc(p.category || 'Vehicle Parts')}</g:product_type>
<g:google_product_category>888</g:google_product_category>
</item>`;
    }).join('');

    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
<channel>
<title>Spare Parts Finder Marketplace</title>
<link>${SITE}</link>
<description>New, used and salvage vehicle spare parts from verified South African sellers.</description>
${items}
</channel>
</rss>`);
  } catch (err) {
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel></channel></rss>');
  }
}
