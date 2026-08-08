/* GET /assets/products/<product-id>.<ext>

   Serves product images that an administrator uploaded, out of KV, at a URL
   that looks exactly like the static files sitting next to them.

   THIS ROUTE SHADOWS A REAL DIRECTORY, ON PURPOSE
   -----------------------------------------------
   public/assets/products/ holds about forty genuine files that ship with the
   repo. A Pages Function claims its whole path prefix, so this handler now
   sees every request for them too. That is the point: an upload for
   `dahua-2mp` has to win over the committed dahua-2mp.jpg, because replacing
   a product photo is the whole feature.

   Everything KV does not have falls through to context.next(), which serves
   the static asset exactly as before. So the repo's images are untouched and
   keep their immutable one-year cache from public/_headers, and only ids that
   have actually been uploaded are answered from here.

   Deleting an uploaded image therefore un-shadows the committed file, if
   there was one. That is why removing an image in the admin also clears
   products.img rather than only dropping the KV key — see the note in
   functions/api/admin/catalog.js.

   CACHING
   -------
   Uploads are mutable and the filename does not change when one is replaced,
   so these cannot carry the immutable header the static files use — an admin
   who swaps a photo would keep seeing the old one for a year. They get a
   short max-age plus an ETag instead, so a replacement is visible quickly and
   an unchanged image still costs a 304 rather than a download.
*/
import { getImage, typeForExtension } from '../../../lib/images.js';

/* Cloudflare Pages answers a path with no matching asset by serving
   index.html with a 200 — the same behaviour functions/api/[[path]].js exists
   to correct for /api/ URLs. On an image URL it is worse than useless: a
   product whose picture has been removed makes every visitor download 26 KB
   of homepage HTML per <img>, and the browser reports a decode failure rather
   than a missing file, so it looks like a corrupt image instead of an absent
   one. An image request that resolves to HTML did not find an image. */
async function assetOr404(next) {
  const res = await next();
  const type = res.headers.get('content-type') || '';
  if (type.toLowerCase().startsWith('text/html')) {
    return new Response('Not found', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
  return res;
}

/* The filename is `<id>.<ext>`. The id half is matched against the same slug
   rule the admin endpoint validates on write, so a crafted path cannot be
   used to probe unrelated KV keys — anything that does not look like one of
   our ids is handed straight to the static asset server. */
const FILE_RE = /^([a-z0-9][a-z0-9-]{1,63})\.([a-z0-9]{2,4})$/;

export const onRequestGet = async (context) => {
  const { params, env, request, next } = context;

  /* [[path]] gives an array of segments; anything nested is not ours. */
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  if (parts.length !== 1 || !parts[0]) return assetOr404(next);

  const match = FILE_RE.exec(String(parts[0]).toLowerCase());
  if (!match) return assetOr404(next);

  const [, id, ext] = match;

  let stored;
  try {
    stored = await getImage(env, id);
  } catch (err) {
    /* KV unreachable is not a reason to 500 a page full of images — the
       committed file may well be there. */
    console.error('image read failed', id, err && err.message);
    return assetOr404(next);
  }
  if (!stored) return assetOr404(next);

  const meta = stored.metadata || {};
  const contentType = meta.ct || typeForExtension(ext) || 'application/octet-stream';

  /* Weak-ish but sufficient: the stored timestamp changes on every replace,
     which is the only event that changes the bytes. */
  const etag = `"${id}-${meta.updated || meta.bytes || '0'}"`;
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': 'public, max-age=300, must-revalidate' } });
  }

  return new Response(stored.body, {
    headers: {
      'content-type': contentType,
      'cache-control': 'public, max-age=300, must-revalidate',
      etag,
      /* The bytes came from an upload. Even though only administrators can
         write them and SVG is refused, tell the browser not to second-guess
         the type — a sniffed image/* that turns out to be HTML is the whole
         reason this header exists. */
      'x-content-type-options': 'nosniff'
    }
  });
};
