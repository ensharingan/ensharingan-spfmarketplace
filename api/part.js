import {
  sbSelect, esc, partUrl, idFromSlug, hasPrice, hasImages, money, gCondition, sanitizeHtml, plainText,
  canonMake, slugify, getMakeIndex, makeInList, partCard, clip, jsonLd, notFound, CARD_CSS, SITE
} from './_lib.js';

const SELECT =
  'id,name,description,make,model,category,condition,price,sku,images,' +
  'year_start,year_end,location,shipping_options,body_code,engine_code,status,' +
  'sellers(business_name,slug,seller_type,city,phone,whatsapp_enabled,status)';

export default async function handler(req, res) {
  try {
    const slug = (req.query.slug || '').toString();
    const id = idFromSlug(slug);

    if (!id) {
      res.setHeader('Location', '/');
      return res.status(302).end();
    }

    const rows = await sbSelect(
      `listings?id=eq.${encodeURIComponent(id)}&status=eq.active&select=${encodeURIComponent(SELECT)}&limit=1`
    );
    const p = rows && rows[0];

    if (!p) return notFound(res, 'This part is no longer listed', 'It may have sold, or the link may be out of date.');

    // Keep one canonical URL per part: redirect if the slug has drifted.
    const canonical = partUrl(p);
    const wanted = canonical.split('/part/')[1];
    if (slug !== wanted) {
      res.setHeader('Location', `/part/${wanted}`);
      return res.status(301).end();
    }

    // More from the same brand: gives every part page real outbound links and
    // lets crawlers move sideways through the catalogue. Never blocks the page.
    let related = [];
    let brandSlug = null;
    const makeName = canonMake(p.make);
    if (makeName) {
      brandSlug = slugify(makeName);
      try {
        const entry = (await getMakeIndex()).get(brandSlug);
        if (entry) {
          related = await sbSelect(
            `listings?status=eq.active&id=neq.${encodeURIComponent(p.id)}` +
            `&make=in.${encodeURIComponent(makeInList(entry.variants))}` +
            `&images=not.is.null&images=neq.${encodeURIComponent('{}')}` +
            `&select=id,name,make,model,condition,price,images,year_start,year_end` +
            `&order=created_at.desc,id.asc&limit=8`
          );
        }
      } catch (e) { related = []; }
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).send(renderPart(p, canonical, makeName, brandSlug, related));
  } catch (err) {
    // 503, not a 200/404 page: a transient DB error must not de-index a good part.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', '120');
    return res.status(503).send('<!DOCTYPE html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Temporarily unavailable</title><p>Please try again shortly.</p>');
  }
}

function renderPart(p, canonical, makeName, brandSlug, related) {
  const imgs = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  const img = imgs[0] || `${SITE}/assets/spf-logo.png`;
  const seller = p.sellers || {};
  const years = p.year_start ? `${p.year_start}–${p.year_end || 'on'}` : '';
  const fitment = [makeName, p.model, years].filter(Boolean).join(' ');

  const shortName = clip(p.name, 70);
  const title = `${shortName}${fitment ? ' — ' + fitment : ''} | Spare Parts Finder`;
  const bodyHtml = sanitizeHtml(p.description);
  const descText = plainText(p.description);
  const metaDesc = clip(
    descText.length >= 60
      ? descText
      : `${p.condition || 'Used'} ${p.name} for ${fitment || 'your vehicle'}. ` +
        `${hasPrice(p) ? money(p) : 'Enquire for price'} from ${seller.business_name || 'a verified seller'}` +
        `${p.location ? ' in ' + p.location : ''}. Delivered nationwide or collect.`,
    155);

  // Photo-less listings are thin: keep them out of the index (they're also left
  // out of the sitemap). They become indexable the moment a photo is added.
  const robots = hasImages(p) ? 'index,follow,max-image-preview:large' : 'noindex,follow';

  const cond = gCondition(p.condition) === 'new'
    ? 'https://schema.org/NewCondition'
    : 'https://schema.org/UsedCondition';

  // Google requires a price on Offer. Listings without one ("Enquire for price")
  // get no Offer at all rather than an invalid one.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: metaDesc,
    image: imgs.length ? imgs : [img],
    sku: p.sku || p.id,
    ...(p.sku ? { mpn: p.sku } : {}),
    category: p.category || undefined,
    brand: makeName ? { '@type': 'Brand', name: makeName } : undefined,
    itemCondition: cond,
    ...(hasPrice(p) ? {
      offers: {
        '@type': 'Offer',
        url: canonical,
        priceCurrency: 'ZAR',
        price: Number(p.price).toFixed(2),
        availability: 'https://schema.org/InStock',
        itemCondition: cond,
        seller: { '@type': 'Organization', name: seller.business_name || 'Spare Parts Finder' }
      }
    } : {})
  };

  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Parts', item: SITE },
      brandSlug ? { '@type': 'ListItem', position: 2, name: makeName, item: `${SITE}/brand/${brandSlug}` } : null,
      { '@type': 'ListItem', position: brandSlug ? 3 : 2, name: p.name, item: canonical }
    ].filter(Boolean)
  };

  const specs = [
    ['Make', makeName], ['Model', p.model], ['Years', years],
    ['Condition', p.condition], ['Category', p.category],
    ['Body Code', p.body_code], ['Engine Code', p.engine_code],
    ['SKU', p.sku], ['Location', p.location],
    ['Delivery', (p.shipping_options || []).join(', ')]
  ].filter(r => r[1]);

  return `<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(metaDesc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="${robots}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Spare Parts Finder">
<meta property="og:title" content="${esc(shortName)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="en_ZA">
${hasPrice(p) ? `<meta property="product:price:amount" content="${Number(p.price).toFixed(2)}">
<meta property="product:price:currency" content="ZAR">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" type="image/png" href="/icons/icon-192.png">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">${jsonLd(ld)}</script>
<script type="application/ld+json">${jsonLd(crumbs)}</script>
<style>
:root{--blue:#1e5bb0;--red:#e31e24;--text:#0f1f38;--text2:#4a5b74;--text3:#8595ab;--border:#e3e8ef;--bg2:#f4f7fb}
*{box-sizing:border-box}
body{margin:0;font-family:Barlow,system-ui,sans-serif;color:var(--text);background:#fff;line-height:1.55}
header{background:var(--blue);padding:.85rem 1.2rem}
header a{display:inline-flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:18px;letter-spacing:.02em;text-transform:uppercase}
header img{width:34px;height:34px;background:#fff;border-radius:6px;padding:4px}
main{max-width:1000px;margin:0 auto;padding:1.5rem 1.2rem 3rem}
nav.bc{font-size:12.5px;color:var(--text3);margin-bottom:1rem}
nav.bc a{color:var(--blue);text-decoration:none}
.wrap{display:grid;grid-template-columns:1fr 1fr;gap:1.8rem}
.gal img{width:100%;border-radius:10px;border:1px solid var(--border);display:block}
.thumbs{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
.thumbs img{width:64px;height:52px;object-fit:cover;border-radius:6px;border:1px solid var(--border)}
h1{font-family:'Barlow Condensed',sans-serif;font-size:31px;font-weight:900;text-transform:uppercase;line-height:1.08;margin:.2rem 0 .5rem}
.fit{font-size:13px;color:var(--text2);margin-bottom:.9rem}
.price{font-family:'Barlow Condensed',sans-serif;font-size:34px;font-weight:900;color:var(--blue);margin:.6rem 0}
.tag{display:inline-block;background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:3px 11px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--text2)}
.cta{display:inline-block;background:var(--red);color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:16px;letter-spacing:.06em;text-transform:uppercase;margin-top:.6rem}
.cta.wa{background:#25d366;margin-left:6px}
table{border-collapse:collapse;width:100%;margin-top:1.4rem;font-size:13.5px}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border)}
th{width:38%;color:var(--text3);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.05em}
.desc{margin-top:1.4rem;font-size:14px;color:var(--text2)}
.desc h2,.desc h3,.desc h4{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;color:var(--text);margin:1.1rem 0 .4rem;font-size:17px}
.desc ul{padding-left:1.1rem}
.desc li{margin:.2rem 0}
.rel{margin-top:2.4rem;border-top:1px solid var(--border);padding-top:1.2rem}
.rel h2{font-family:'Barlow Condensed',sans-serif;font-size:20px;font-weight:900;text-transform:uppercase;margin:0 0 .8rem}
.rel .all{display:inline-block;margin-top:1rem;color:var(--blue);font-weight:600;text-decoration:none;font-size:14px}
${CARD_CSS}
footer{border-top:1px solid var(--border);margin-top:2.5rem;padding:1.2rem;text-align:center;font-size:12px;color:var(--text3)}
footer a{color:var(--blue)}
@media(max-width:760px){.wrap{grid-template-columns:1fr}h1{font-size:25px}}
</style>
</head>
<body>
<header><a href="/"><img src="/assets/spf-mark.png" alt="">Spare Parts Finder</a></header>
<main>
<nav class="bc" aria-label="Breadcrumb"><a href="/">Parts</a>${brandSlug ? ` › <a href="/brand/${esc(brandSlug)}">${esc(makeName)}</a>` : ''} › ${esc(p.name)}</nav>
<div class="wrap">
  <div class="gal">
    <img src="${esc(img)}" alt="${esc(p.name)}${fitment ? ' for ' + esc(fitment) : ''}" width="600" height="450" fetchpriority="high">
    ${imgs.length > 1 ? `<div class="thumbs">${imgs.slice(1, 7).map(u => `<img src="${esc(u)}" alt="${esc(p.name)}" loading="lazy">`).join('')}</div>` : ''}
  </div>
  <div>
    ${p.condition ? `<span class="tag">${esc(p.condition)}</span>` : ''}
    <h1>${esc(p.name)}</h1>
    ${fitment ? `<div class="fit">Fits ${esc(fitment)}</div>` : ''}
    <div class="price">${esc(money(p))}</div>
    <a class="cta" href="/#part-${esc(p.id)}">View on Marketplace</a>
    ${seller.whatsapp_enabled && seller.phone
      ? `<a class="cta wa" rel="nofollow" href="https://wa.me/${esc(String(seller.phone).replace(/\D/g, ''))}?text=${encodeURIComponent('Hi, is this still available? ' + p.name + ' — ' + canonical)}">WhatsApp</a>`
      : ''}
    <table>${specs.map(r => `<tr><th>${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join('')}
    ${seller.business_name ? `<tr><th>Seller</th><td>${seller.seller_type === 'business' && seller.slug
      ? `<a href="/shop/${esc(seller.slug)}">${esc(seller.business_name)}</a>` : esc(seller.business_name)}</td></tr>` : ''}
    </table>
    ${bodyHtml ? `<div class="desc">${bodyHtml}</div>` : ''}
  </div>
</div>
${related.length ? `<section class="rel">
<h2>More ${esc(makeName)} parts</h2>
<div class="grid">
${related.map(partCard).join('\n')}
</div>
<a class="all" href="/brand/${esc(brandSlug)}">Browse all ${esc(makeName)} parts →</a>
</section>` : ''}
</main>
<footer>© ${new Date().getFullYear()} Spare Parts Finder — Marketplace ·
<a href="/">Browse all parts</a> · <a href="mailto:info@sparepartsfinder.co.za">info@sparepartsfinder.co.za</a></footer>
</body>
</html>`;
}
