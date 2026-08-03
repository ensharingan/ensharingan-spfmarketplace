import { sbSelect, esc, partUrl, hasPrice, money, SITE } from './_lib.js';

export default async function handler(req, res) {
  try {
    const raw = decodeURIComponent((req.query.make || '').toString()).replace(/-/g, ' ').trim();
    if (!raw) { res.setHeader('Location', '/'); return res.status(302).end(); }

    const rows = await sbSelect(
      `listings?status=eq.active&make=ilike.${encodeURIComponent(raw)}` +
      `&select=id,name,make,model,category,condition,price,images,year_start,year_end,location` +
      `&order=created_at.desc&limit=200`
    );

    if (!rows.length) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(`<!DOCTYPE html><html lang="en-ZA"><head><meta charset="utf-8">
<title>No ${esc(raw)} parts | Spare Parts Finder</title><meta name="robots" content="noindex,follow">
</head><body><h1>No ${esc(raw)} parts listed right now</h1>
<p><a href="/">Browse the marketplace →</a></p></body></html>`);
    }

    const make = rows[0].make;
    const models = [...new Set(rows.map(r => String(r.model || '').trim()).filter(m => m && m !== 'Various'))].slice(0, 24);
    const cats = [...new Set(rows.map(r => String(r.category || '').trim()).filter(Boolean))];

    const title = `${make} Spare Parts for Sale in South Africa | Spare Parts Finder`;
    const desc = `New, used and salvage ${make} parts from verified South African sellers. ` +
      `${rows.length} ${make} listings${models.length ? ' covering ' + models.slice(0, 6).join(', ') : ''}. ` +
      `Delivered nationwide or collect.`;
    const canonical = `${SITE}/brand/${encodeURIComponent(String(make).toLowerCase())}`;

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
</main>
<footer>© ${new Date().getFullYear()} Spare Parts Finder — Marketplace · <a href="/">Browse all parts</a></footer>
</body>
</html>`);
  } catch (err) {
    res.setHeader('Location', '/');
    return res.status(302).end();
  }
}
