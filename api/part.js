import { sbSelect, esc, partUrl, idFromSlug, hasPrice, money, gCondition, sanitizeHtml, plainText, SITE } from './_lib.js';

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

    if (!p) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(404).send(notFoundPage());
    }

    // Keep one canonical URL per part: redirect if the slug has drifted.
    const canonical = partUrl(p);
    const wanted = canonical.split('/part/')[1];
    if (slug !== wanted) {
      res.setHeader('Location', `/part/${wanted}`);
      return res.status(301).end();
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=3600');
    return res.status(200).send(renderPart(p, canonical));
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(notFoundPage('Something went wrong loading this part.'));
  }
}

function renderPart(p, canonical) {
  const imgs = Array.isArray(p.images) ? p.images.filter(Boolean) : [];
  const img = imgs[0] || `${SITE}/assets/spf-logo.png`;
  const seller = p.sellers || {};
  const years = p.year_start ? `${p.year_start}–${p.year_end || 'on'}` : '';
  const fitment = [p.make, p.model, years].filter(Boolean).join(' ');

  const title = `${p.name}${fitment ? ' — ' + fitment : ''} | Spare Parts Finder`;
  const bodyHtml = sanitizeHtml(p.description);
  const metaDesc = (
    plainText(p.description) ||
    `${p.condition || 'Used'} ${p.name} for ${fitment || 'your vehicle'}. ` +
    `${hasPrice(p) ? money(p) : 'Enquire for price'} from ${seller.business_name || 'a verified seller'}` +
    `${p.location ? ' in ' + p.location : ''}. Delivered nationwide or collect.`
  ).replace(/\s+/g, ' ').trim().slice(0, 300);

  // Google Shopping / rich results need an offer with a real price.
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: p.name,
    description: metaDesc,
    image: imgs.length ? imgs : [img],
    sku: p.sku || p.id,
    category: p.category || undefined,
    brand: p.make ? { '@type': 'Brand', name: p.make } : undefined,
    itemCondition: gCondition(p.condition) === 'new'
      ? 'https://schema.org/NewCondition'
      : 'https://schema.org/UsedCondition',
    offers: {
      '@type': 'Offer',
      url: canonical,
      priceCurrency: 'ZAR',
      availability: 'https://schema.org/InStock',
      itemCondition: gCondition(p.condition) === 'new'
        ? 'https://schema.org/NewCondition'
        : 'https://schema.org/UsedCondition',
      seller: { '@type': 'Organization', name: seller.business_name || 'Spare Parts Finder' },
      ...(hasPrice(p) ? { price: Number(p.price).toFixed(2) } : {})
    }
  };

  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Parts', item: SITE },
      p.make ? { '@type': 'ListItem', position: 2, name: p.make, item: `${SITE}/brand/${encodeURIComponent(String(p.make).toLowerCase())}` } : null,
      { '@type': 'ListItem', position: 3, name: p.name, item: canonical }
    ].filter(Boolean)
  };

  const specs = [
    ['Make', p.make], ['Model', p.model], ['Years', years],
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
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="product">
<meta property="og:site_name" content="Spare Parts Finder">
<meta property="og:title" content="${esc(p.name)}">
<meta property="og:description" content="${esc(metaDesc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:locale" content="en_ZA">
${hasPrice(p) ? `<meta property="product:price:amount" content="${Number(p.price).toFixed(2)}">
<meta property="product:price:currency" content="ZAR">` : ''}
<meta name="twitter:card" content="summary_large_image">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
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
footer{border-top:1px solid var(--border);margin-top:2.5rem;padding:1.2rem;text-align:center;font-size:12px;color:var(--text3)}
footer a{color:var(--blue)}
@media(max-width:760px){.wrap{grid-template-columns:1fr}h1{font-size:25px}}
</style>
</head>
<body>
<header><a href="/"><img src="/assets/spf-mark.png" alt="">Spare Parts Finder</a></header>
<main>
<nav class="bc"><a href="/">Parts</a>${p.make ? ` › <a href="/brand/${esc(String(p.make).toLowerCase())}">${esc(p.make)}</a>` : ''} › ${esc(p.name)}</nav>
<div class="wrap">
  <div class="gal">
    <img src="${esc(img)}" alt="${esc(p.name)}${fitment ? ' for ' + esc(fitment) : ''}" width="600" height="450">
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
</main>
<footer>© ${new Date().getFullYear()} Spare Parts Finder — Marketplace ·
<a href="/">Browse all parts</a> · <a href="mailto:info@sparepartsfinder.co.za">info@sparepartsfinder.co.za</a></footer>
</body>
</html>`;
}

function notFoundPage(msg) {
  return `<!DOCTYPE html><html lang="en-ZA"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Part not found | Spare Parts Finder</title>
<meta name="robots" content="noindex,follow">
<style>body{font-family:system-ui,sans-serif;max-width:560px;margin:12vh auto;padding:1.5rem;color:#0f1f38;text-align:center}
a{color:#1e5bb0}</style></head><body>
<h1>This part is no longer listed</h1>
<p>${esc(msg || 'It may have sold, or the link may be out of date.')}</p>
<p><a href="/">Browse 4,000+ parts on the marketplace →</a></p>
</body></html>`;
}
