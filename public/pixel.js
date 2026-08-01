/* =========================================================================
   Vision Guard — pixel.js
   Meta Pixel base code.

   This is Meta's own snippet, moved out of the page on purpose.

   The CSP allows exactly one inline <script>, pinned by SHA-256 hash — the
   no-js/js class swap that has to run before first paint. Pasting the pixel
   inline would need a second hash, and that hash breaks on any whitespace
   change, in a way that fails silently: the pixel simply stops loading and
   nothing says so. An external file needs no hash at all, because
   `script-src 'self'` already covers it.

   PIXEL_ID is public. It ships in the page of every site running a pixel and
   identifies the ad account's dataset, nothing more. It is NOT an access
   token: the token belongs in the META_ACCESS_TOKEN secret, is read only by
   lib/meta.js on the server, and must never appear in anything served to a
   browser.

   Purchase events are NOT fired from here. They are sent twice, on purpose:
   once from the browser in shop.js when an order completes, and once from
   the server in functions/api/orders.js through the Conversions API. Meta
   deduplicates them. The server copy is the one that survives ad blockers
   and Safari, which is most of the traffic this shop actually gets.
   ========================================================================= */
(function () {
  'use strict';

  var PIXEL_ID = '2037293923502315';

  /* Meta's loader, verbatim apart from formatting. */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = '2.0';
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');
})();
