import {
  sbSelect, esc, partUrl, partCard, shell, notFound, slugify, jsonLd, clip,
  getMakeIndex, makeInList, BRAND_SLUG_REDIRECTS, MIN_BRAND_LISTINGS, SITE
} from './_lib.js';

const PER_PAGE = 48;

export default async function handler(req, res) {
  try {
    const param = decodeURIComponent((req.query.make || '').toString()).trim();
    if (!param) { res.setHeader('Location', '/'); return res.status(302).end(); }

    // One canonical URL per brand. Odd casing / %20 / old messy names
    // (mercedes, captur-2017-2020, mini-cooper...) are permanent redirects so
    // crawl budget and link equity aren't split across variants.
    const slug = slugify(param);
    if (!slug) { res.setHeader('Location', '/'); return res.status(302).end(); }
    const target = BRAND_SLUG_REDIRECTS[slug] || slug;
    if (param !== target) {
      res.setHeader('Cache-Control', 'public, s-maxage=86400');
      res.setHeader('Location', `/brand/${target}`);
      return res.status(301).end();
    }

    const index = await getMakeIndex();
    const entry = index.get(slug);
    if (!entry) return notFound(res, `No ${param} parts listed right now`, 'Try another make from the marketplace.');

    const make = entry.name;
    const totalPages = Math.max(1, Math.ceil(entry.count / PER_PAGE));
    let page = parseInt((req.query.page || '1').toString(), 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (page > totalPages) {
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      res.setHeader('Location', totalPages > 1 ? `/brand/${slug}?page=${totalPages}` : `/brand/${slug}`);
      return res.status(301).end();
    }

    const rows = await sbSelect(
      `listings?status=eq.active&make=in.${encodeURIComponent(makeInList(entry.variants))}` +
      `&select=id,name,make,model,category,condition,price,images,year_start,year_end,location` +
      `&order=created_at.desc,id.asc&limit=${PER_PAGE}&offset=${(page - 1) * PER_PAGE}`
    );
    if (!rows.length) return notFound(res, `No ${make} parts listed right now`, 'Try another make from the marketplace.');

    // Sibling brands give every brand page real outbound links so crawlers can
    // walk the catalogue instead of treating each page as an orphan.
    const siblings = [...index.values()]
      .filter(m => m.slug !== slug && m.count >= MIN_BRAND_LISTINGS)
      .sort((a, b) => b.count - a.count)
      .slice(0, 40);
    const models = [...new Set(rows.map(r => String(r.model || '').trim()).filter(m => m && m !== 'Various'))].slice(0, 24);
    const cats = [...new Set(rows.map(r => String(r.category || '').trim()).filter(Boolean))].slice(0, 12);

    const base = `${SITE}/brand/${slug}`;
    const canonical = page > 1 ? `${base}?page=${page}` : base;
    const pageTag = page > 1 ? ` – Page ${page}` : '';
    const title = `${make} Spare Parts for Sale in South Africa${pageTag} | Spare Parts Finder`;
    const desc = clip(
      `New, used and salvage ${make} parts from verified South African sellers. ` +
      `${entry.count} ${make} listings${models.length ? ' covering ' + models.slice(0, 5).join(', ') : ''}. ` +
      `Delivered nationwide or collect.`, 155);

    // Thin brand pages (a handful of listings) are kept out of the index.
    const robots = entry.count < MIN_BRAND_LISTINGS ? 'noindex,follow' : 'index,follow,max-image-preview:large';

    const ld = [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: `${make} spare parts`,
        description: desc,
        url: canonical,
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: entry.count,
          itemListElement: rows.map((p, i) => ({
            '@type': 'ListItem', position: (page - 1) * PER_PAGE + i + 1, url: partUrl(p), name: p.name
          }))
        }
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Parts', item: SITE },
          { '@type': 'ListItem', position: 2, name: make, item: base }
        ]
      }
    ];

    const pager = totalPages > 1 ? `<nav class="pager" aria-label="Pagination">
${page > 1 ? `<a rel="prev" href="${esc(page === 2 ? base : `${base}?page=${page - 1}`)}">← Previous</a>` : ''}
<span>Page ${page} of ${totalPages}</span>
${page < totalPages ? `<a rel="next" href="${esc(`${base}?page=${page + 1}`)}">Next →</a>` : ''}
</nav>` : '';

    const body = `<nav class="bc" aria-label="Breadcrumb"><a href="/">Parts</a> › ${esc(make)}</nav>
<h1>${esc(make)} Spare Parts</h1>
<p class="lede">${esc(entry.count)} ${esc(make)} parts listed by verified South African sellers — new, used and salvage. Delivered nationwide or collected in person.</p>
${page === 1 && models.length ? `<div class="chips">${models.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
<div class="grid">
${rows.map(partCard).join('\n')}
</div>
${pager}
${page === 1 && cats.length ? `<p class="lede" style="margin-top:1.6rem">Categories in stock: ${esc(cats.join(', '))}.</p>` : ''}
${siblings.length ? `<nav class="more" aria-label="Other makes"><h2>Other makes on the marketplace</h2>
${siblings.map(m => `<a href="/brand/${esc(m.slug)}">${esc(m.name)}</a>`).join('')}
</nav>` : ''}`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).send(shell({
      title, desc, canonical, robots, ld, body,
      prev: page > 1 ? (page === 2 ? base : `${base}?page=${page - 1}`) : undefined,
      next: page < totalPages ? `${base}?page=${page + 1}` : undefined,
      ogImage: (rows[0].images && rows[0].images[0]) || undefined
    }));
  } catch (err) {
    // Don't 302 to "/" on a transient error: Google reads that as a soft 404 / redirect
    // and drops the brand page. A 503 means "retry later".
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '120');
    return res.status(503).send('<!DOCTYPE html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Temporarily unavailable</title><p>Please try again shortly.</p>');
  }
}
