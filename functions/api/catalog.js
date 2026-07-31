/* GET /api/catalog — the same list the shop page imports, for anyone who
   would rather read it as JSON (a price feed, a spreadsheet, a second front
   end). Served from the identical module the checkout prices against, so it
   can never disagree with what an order actually costs. */
import { PRODUCTS, CATEGORIES, GOVERNORATES, imageFor } from '../../public/catalog.js';
import { json, handle } from '../../lib/util.js';
import { shippingFor } from '../../lib/orders.js';

export const onRequestGet = handle(async ({ env }) => {
  return json({
    ok: true,
    currency: 'EGP',
    shipping: shippingFor(env),
    categories: CATEGORIES,
    governorates: GOVERNORATES,
    products: PRODUCTS.map((p) => Object.assign({}, p, { image: imageFor(p) }))
  });
});
