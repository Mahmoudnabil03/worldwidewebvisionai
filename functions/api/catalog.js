/* GET /api/catalog — the same list the shop page imports, for anyone who
   would rather read it as JSON (a price feed, a spreadsheet, a second front
   end). Served from the identical module the checkout prices against, so it
   can never disagree with what an order actually costs. */
import { PRODUCTS, CATEGORIES, GOVERNORATES, imageFor } from '../../public/catalog.js';
import { json, handle } from '../../lib/util.js';
import { shippingFor } from '../../lib/orders.js';
import { db } from '../../lib/db.js';
import { loadCatalog } from '../../lib/products.js';

/* The only endpoint here whose response is identical for every visitor and
   contains nothing personal, so it is the only one that may be cached.
   lib/util.js sends `no-store` on every JSON response by default — correct
   for a cart, a session or an attendance record, and pure waste for a fixed
   price list that changes when someone edits catalog.js and deploys.

   Five minutes, matching the header public/catalog.js already carries in
   _headers, so the JSON feed and the module the browser imports cannot drift
   by more than one cache window. s-maxage lets Cloudflare's edge answer it
   without waking a Function at all; stale-while-revalidate means the one
   request that finds it expired still gets an instant answer while the
   refresh happens behind it. */
export const onRequestGet = handle(async ({ env }) => {
  const catalog = await loadCatalog(await db(env));
  return json({
    ok: true,
    currency: 'EGP',
    shipping: shippingFor(env),
    categories: CATEGORIES,
    governorates: GOVERNORATES,
    source: catalog.source,
    products: catalog.products.map((p) => Object.assign({}, p, { image: imageFor(p) }))
  }, 200, {
    'cache-control': 'public, max-age=0, s-maxage=10, stale-while-revalidate=30'
  });
});
