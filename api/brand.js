import { sbSelect, esc, partUrl, hasPrice, money, slugify, SITE } from './_lib.js';

export default async function handler(req, res) {
  try {
    const param = decodeURIComponent((req.query.make || '').toString()).trim();
    if (!param) { res.setHeader('Location', '/'); return res.status(302).end(); }

    // One canonical URL form per make. Anything else (%20 spaces, odd casing)
    // is a permanent redirect so crawl budget isn't split across variants.
    const slug = slugify(param);
    if (!slug) { res.setHeader('Location', '/'); return res.status(302).end(); }
    if (param !== slug) {
      res.setHeader('Cache-Control', 'public, s-maxage=86400');
      res.setHeader('Location', `/brand/${slug}`);
      return res.status(301).end();
    }

    // Resolve the slug back to the make values actually stored on listings.
    // Matching on the slug (not the raw string) is what makes hyphenated and
    // multi-word makes — Mercedes-Benz, Land Rover — resolve at all.
    const makeRows = await sbSelect('listings?status=eq.active&select=make&limit=10000');
    const allMakes = [...new Set(
      makeRows.map(r => String(r.make || '').trim()).filter(m => m && m.toLowerCase() !== 'other')
    )];
    const variants = allMakes.filter(m => slugify(m) === slug);

    if (!variants.length) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      return res.status(404).send(`<!DOCTYPE html><html lang="en-ZA"><head><meta charset="utf-8">
<title>No ${esc(param)} parts | Spare Parts Finder</title><meta name="robots" content="noindex,follow">
</head><body><h1>No ${esc(param)} parts listed right now</h1>
<p><a href="/">Browse the marketplace →</a></p></body></html>`);
    }

    const inList = '(' + variants.map(v => '"' + v.replace(/"/g, '') + '"').join(',') + ')';
    const rows = await sbSelect(
      `listings?status=eq.active&make=in.${encodeURIComponent(inList)}` +
      `&select=id,name,make,model,category,condition,price,images,year_start,year_end,location` +
      `&order=created_at.desc&limit=200`
    );

    if (!rows.length) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      return res.status(404).send(`<!DOCTYPE html><html lang="en-ZA"><head><meta charset="utf-8">
<title>No ${esc(param)} parts | Spare Parts Finder</title><meta name="robots" content="noindex,follow">
</head><body><h1>No ${esc(param)} parts listed right now</h1>
<p><a href="/">Browse the marketplace →</a></p></body></html>`);
    }

    const make = rows[0].make;
    // Sibling brands give every brand page real outbound links, so crawlers can
    // walk the catalogue instead of treating each page as an orphan.
    const siblings = allMakes
      .filter(m => slugify(m) !== slug)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 60);
    const models = [...new Set(rows.map(r => String(r.model || '').trim()).filter(m => m && m !== 'Various'))].slice(0, 24);
    const cats = [...new Set(rows.map(r => String(r.category || '').trim()).filter(Boolean))];

    const title = `${make} Spare Parts for Sale in South Africa | Spare Parts Finder`;
    const desc = `New, used and salvage ${make} parts from verified South African sellers. ` +
      `${rows.length} ${make} listings${models.length ? ' covering ' + models.slice(0, 6).join(', ') : ''}. ` +
      `Delivered nationwide or collect.`;
    const canonical = `${SITE}/brand/${slug}`;

    const ld = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: `${make} spare parts`,
      description: desc,
      url: canonical,
      mainEntity: {
        '@type': 'ItemList',
        numberOfItems: rows.length,
        itemListElement: rows.slice(0, 40).map((p, i) => ({
          '@type': 'ListItem', position: i + 1, url: partUrl(p), name: p.name
        }))
      }
    };

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).send(`<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(canonical)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;800;900&family=Barlow:wght@400;500;600&display=swap" rel="stylesheet">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<style>
:root{--blue:#1e5bb0;--red:#e31e24;--text:#0f1f38;--text2:#4a5b74;--text3:#8595ab;--border:#e3e8ef;--bg2:#f4f7fb}
*{box-sizing:border-box}
body{margin:0;font-family:Barlow,system-ui,sans-serif;color:var(--text);line-height:1.55;background:#fff}
header{background:var(--blue);padding:.85rem 1.2rem}
header a{display:inline-flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:18px;text-transform:uppercase}
header img{width:34px;height:34px;background:#fff;border-radius:6px;padding:4px}
main{max-width:1100px;margin:0 auto;padding:1.5rem 1.2rem 3rem}
h1{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:900;text-transform:uppercase;margin:.3rem 0 .4rem}
.lede{font-size:14px;color:var(--text2);max-width:720px;margin-bottom:1.2rem}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:1.4rem}
.chips span{background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:4px 11px;font-size:12px;color:var(--text2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:12px}
.card{border:1px solid var(--border);border-radius:10px;overflow:hidden;text-decoration:none;color:inherit;display:block}
.card:hover{border-color:var(--blue)}
.card img{width:100%;height:145px;object-fit:cover;display:block;background:var(--bg2)}
.card .b{padding:.7rem .8rem}
.card .n{font-family:'Barlow Condensed',sans-serif;font-weight:800;font-size:14.5px;text-transform:uppercase;line-height:1.2}
.card .m{font-size:11.5px;color:var(--text3);margin-top:3px}
.card .p{color:var(--blue);font-weight:700;font-size:14px;margin-top:6px}
footer{border-top:1px solid var(--border);margin-top:2.5rem;padding:1.2rem;text-align:center;font-size:12px;color:var(--text3)}
footer a{color:var(--blue)}
.brands{margin-top:2rem;border-top:1px solid var(--border);padding-top:1.1rem}
.brands h2{font-family:'Barlow Condensed',sans-serif;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text3);margin:0 0 .7rem}
.brands a{display:inline-block;margin:0 6px 6px 0;padding:4px 11px;border:1px solid var(--border);border-radius:20px;font-size:12.5px;color:var(--text2);text-decoration:none}
.brands a:hover{border-color:var(--blue);color:var(--blue)}
</style>
</head>
<body>
<header><a href="/"><img src="/assets/spf-mark.png" alt="">Spare Parts Finder</a></header>
<main>
<h1>${esc(make)} Spare Parts</h1>
<p class="lede">${esc(rows.length)} ${esc(make)} parts listed by verified South African sellers — new, used and salvage. Delivered nationwide or collected in person.</p>
${models.length ? `<div class="chips">${models.map(m => `<span>${esc(m)}</span>`).join('')}</div>` : ''}
<div class="grid">
${rows.slice(0, 120).map(p => {
  const img = (Array.isArray(p.images) && p.images[0]) || '/assets/spf-logo.png';
  const yrs = p.year_start ? `${p.year_start}–${p.year_end || 'on'}` : '';
  return `<a class="card" href="${esc(partUrl(p))}">
  <img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy" width="215" height="145">
  <div class="b"><div class="n">${esc(p.name)}</div>
  <div class="m">${esc([p.model, yrs, p.condition].filter(Boolean).join(' · '))}</div>
  <div class="p">${esc(money(p))}</div></div></a>`;
}).join('')}
</div>
${cats.length ? `<p class="lede" style="margin-top:1.6rem">Categories in stock: ${esc(cats.join(', '))}.</p>` : ''}
${siblings.length ? `<nav class="brands"><h2>Other makes on the marketplace</h2>
${siblings.map(m => `<a href="/brand/${esc(slugify(m))}">${esc(m)}</a>`).join('')}
</nav>` : ''}
</main>
<footer>© ${new Date().getFullYear()} Spare Parts Finder — Marketplace · <a href="/">Browse all parts</a></footer>
</body>
</html>`);
  } catch (err) {
    res.setHeader('Location', '/');
    return res.status(302).end();
  }
}
