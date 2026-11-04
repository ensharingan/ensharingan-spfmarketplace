import {
  sbSelect, sbCount, esc, partUrl, partCard, shell, notFound, plainText, clip, SITE
} from './_lib.js';

// Server-rendered seller storefront at /shop/:slug. The SPA never handled this URL,
// so it used to fall through to index.html and look like a duplicate of the homepage.
// Only public, non-contact fields are selected (no phone / email).
const PER_PAGE = 48;

export default async function handler(req, res) {
  try {
    const slug = (req.query.slug || '').toString().trim().toLowerCase();
    if (!/^[a-z0-9-]{1,90}$/.test(slug)) return notFound(res, 'Shop not found', 'This shop link is not valid.');

    const sellers = await sbSelect(
      `sellers?slug=eq.${encodeURIComponent(slug)}&status=eq.approved&seller_type=eq.business` +
      `&select=id,business_name,slug,city,about,logo_url&limit=1`
    );
    const s = sellers && sellers[0];
    if (!s) return notFound(res, 'Shop not found', 'This shop may have moved or closed.');

    const where = `listings?seller_id=eq.${encodeURIComponent(s.id)}&status=eq.active`;
    const total = await sbCount(where);
    const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));
    let page = parseInt((req.query.page || '1').toString(), 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > totalPages) {
      res.setHeader('Location', totalPages > 1 ? `/shop/${slug}?page=${totalPages}` : `/shop/${slug}`);
      return res.status(301).end();
    }

    const rows = total
      ? await sbSelect(
          `${where}&select=id,name,make,model,category,condition,price,images,year_start,year_end` +
          `&order=created_at.desc,id.asc&limit=${PER_PAGE}&offset=${(page - 1) * PER_PAGE}`)
      : [];

    const name = s.business_name;
    const about = plainText(s.about);
    const base = `${SITE}/shop/${slug}`;
    const canonical = page > 1 ? `${base}?page=${page}` : base;
    const where_ = s.city ? ` in ${s.city}` : '';
    const title = `${name}${where_ ? ' —' + where_ : ''} | Spare Parts Finder`;
    const desc = clip(
      about.length >= 60
        ? about
        : `${name}${where_} sells new, used and salvage vehicle spare parts on Spare Parts Finder. ` +
          `${total} part${total === 1 ? '' : 's'} listed. Delivered nationwide or collect.`, 155);

    // A shop with nothing listed is an empty page: keep it out of the index.
    const robots = total === 0 ? 'noindex,follow' : 'index,follow,max-image-preview:large';

    const ld = [
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name,
        url: base,
        ...(s.logo_url ? { logo: s.logo_url } : {}),
        areaServed: { '@type': 'Country', name: 'South Africa' }
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Parts', item: SITE },
          { '@type': 'ListItem', position: 2, name, item: base }
        ]
      },
      ...(rows.length ? [{
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        numberOfItems: total,
        itemListElement: rows.map((p, i) => ({
          '@type': 'ListItem', position: (page - 1) * PER_PAGE + i + 1, url: partUrl(p), name: p.name
        }))
      }] : [])
    ];

    const pager = totalPages > 1 ? `<nav class="pager" aria-label="Pagination">
${page > 1 ? `<a rel="prev" href="${esc(page === 2 ? base : `${base}?page=${page - 1}`)}">← Previous</a>` : ''}
<span>Page ${page} of ${totalPages}</span>
${page < totalPages ? `<a rel="next" href="${esc(`${base}?page=${page + 1}`)}">Next →</a>` : ''}
</nav>` : '';

    const body = `<nav class="bc" aria-label="Breadcrumb"><a href="/">Parts</a> › ${esc(name)}</nav>
<h1>${esc(name)}</h1>
<p class="lede">${s.city ? esc(s.city) + ' · ' : ''}${esc(total)} part${total === 1 ? '' : 's'} listed on Spare Parts Finder.${about ? ' ' + esc(clip(about, 400)) : ''}</p>
${rows.length ? `<div class="grid">\n${rows.map(partCard).join('\n')}\n</div>` : '<p class="lede">This shop has no parts listed right now.</p>'}
${pager}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).send(shell({
      title, desc, canonical, robots, ld, body,
      prev: page > 1 ? (page === 2 ? base : `${base}?page=${page - 1}`) : undefined,
      next: page < totalPages ? `${base}?page=${page + 1}` : undefined,
      ogImage: (rows[0] && rows[0].images && rows[0].images[0]) || s.logo_url || undefined
    }));
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '120');
    return res.status(503).send('<!DOCTYPE html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Temporarily unavailable</title><p>Please try again shortly.</p>');
  }
}
