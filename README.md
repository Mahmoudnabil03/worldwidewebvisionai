# Vision Guard — site, shop and staff attendance

Three pages and a small API for the real Vision Guard catalogue. Bilingual
Arabic (RTL, default) / English (LTR), dark by default with a full light theme.

| | |
| --- | --- |
| `/` | The marketing page — scroll-scrubbed hero, categories, price list. |
| `/shop` | Filterable catalogue, cart, checkout. Orders land in the database and push a WhatsApp notification to the shop. |
| `/account` | Sign in / sign up with separate consent boxes, order history, preferences, and an attendance tab for `@visionguardeg.com` addresses. |

**No build step and no front-end framework.** The pages are hand-written HTML,
CSS and ES modules. The back end is Cloudflare Pages Functions over a D1
database — same deploy, same repo, no separate server.

---

## The direction

**Editorial restraint over decoration.** One chromatic colour — the azure lifted
from the logo (`#1B9DD9`). Everything else is near-black, hairline greys and
white. The accent is rationed: primary buttons, active states, price figures,
the live dots, and the hero canvas. Nowhere else.

**A real dark-mode logo.** The supplied logo's "GUARD" wordmark is `#58595B`,
which lands around **1.9:1 contrast** on the near-black background — unreadable.
`assets/logo-dark.png` is the dark-mode variant: every greyscale pixel mapped to
white, every chromatic pixel left alone, alpha preserved so the antialiasing
stays clean. VISION keeps its exact azure; GUARD and the swoosh go white. The
split was done by saturation (`sat < 0.25` → white), which caught 13,756 grey
pixels and left 10,459 blue ones untouched.

**Light plates for catalogue photography only.** Every product shot is on a white
studio ground, so category images sit on a near-white plate (`--plate`) with
`mix-blend-mode: multiply`, which melts their white ground into the plate instead
of showing a hard rectangle. The logo does *not* use a plate.

**Typography does the work.** Cairo for Arabic, Inter for Latin, switched by
`html[lang]`. Arabic is never letter-spaced (it breaks the joining rhythm) and
gets looser leading — both handled in a dedicated block in the stylesheet.
Product model numbers stay in Inter even inside Arabic copy.

**Motion is physical, not ornamental.** Weighted scrolling, a scroll-scrubbed
hero, word-by-word headline reveals. Each one paces the reading rather than
calling attention to itself.

### The hero

Scrolling scrubs a canvas-rendered sensor field through the four layers listed
in the HUD — cameras, recorder, storage, phone. The field is already lit at
rest, so the page has presence before you touch it; scrolling deepens it rather
than switching it on. In Arabic the detection brackets mirror to the opposite
side so they never sit under the headline.

---

## Files

```
public/                     <- served verbatim. Everything here is public.
  index.html  shop.html  account.html
  styles.css  app.css
  main.js  site.js  shop.js  account.js
  catalog.js                <- products + prices. Imported by BOTH sides.
  _headers                  <- Cloudflare Pages security + caching rules
  assets/
functions/                  <- compiled into Pages Functions, served at /api/*
  api/
    catalog.js  orders.js  newsletter.js
    auth/       signup.js  login.js  logout.js  me.js
    account/    preferences.js
    attendance/ index.js   clock.js
lib/                        <- server-only helpers. NOT served.
  util.js  db.js  auth.js  orders.js  attendance.js  whatsapp.js
schema.sql                  <- D1 tables (also applied automatically)
brand/logo-original.png     <- pristine source, kept out of the deploy
wrangler.toml               <- Pages project config + D1 binding
.dev.vars.example           <- the environment variables, documented
```

| File | What it is |
| --- | --- |
| `public/index.html` | Marketing page. Arabic inline, English in `data-en`. |
| `public/shop.html` `shop.js` | Catalogue, cart, checkout, confirmation. |
| `public/account.html` `account.js` | Auth, orders, consent preferences, attendance. |
| `public/catalog.js` | **The prices.** One module, read by the browser *and* by the order endpoint. |
| `public/styles.css` | Tokens, both themes, layout, RTL, responsive, reduced-motion. |
| `public/app.css` | Shop and account surfaces only. The landing page never loads it. |
| `public/main.js` | Landing page: language, theme, smooth scroll, hero canvas, reveals. |
| `public/site.js` | Shared chrome for shop/account: language, theme, API client, toasts. |
| `lib/*.js` | Server-side only. Lives outside `functions/` so it is not routable. |
| `public/assets/logo-dark.png` | Dark-theme logo — white GUARD, azure VISION. |
| `public/assets/logo-trim.png` | Original colours. Light theme, favicon, `og:image`. |
| `brand/logo-original.png` | Exactly as downloaded, untouched. Not served. |
| `.claude/launch.json` | Local dev-server config. Gitignored, not deployed. |

**The site lives in `public/` on purpose.** Cloudflare Pages serves its output
directory verbatim, so a flat layout would publish `README.md` — including the
pricing notes below — at `https://yoursite/README.md`. Keeping the site in a
subdirectory means only the site ships, and it is why `lib/` is safe to keep at
the repo root.

**Why `lib/` is not inside `functions/`.** Every file under `functions/` becomes
a route. A helper placed there would be fetchable at its path. Shared server
code lives outside and is imported by relative path; Wrangler bundles it in.

**Runtime dependencies: none.** No npm packages ship. The only external request
the browser makes is Cairo + Inter from Google Fonts.

### About the logo file

`logo.png` came from your store's own CDN at 500×200. It has 81px of transparent
margin on each side and a 5px vertical divider bar at x=414–418 that is not
present in the version you sent. `logo-trim.png` is that file cropped to the
wordmark only (322×190) — padding and the stray bar removed, colours untouched.
`logo-dark.png` is `logo-trim.png` with the greyscale ink remapped to white for
the dark background.

The favicon and `og:image` deliberately stay on `logo-trim.png`: a white wordmark
would vanish against a light browser tab bar or a light social-card background.

If you have the original vector, drop in two SVGs (light and dark) and swap the
`<img src>` references — three for the dark variant, two in `<head>` for the
light one.

---

## Deploying to Cloudflare Pages

There is no build step. Pick one of the two routes below — but do the one
mandatory setup step first.

### Before the first deploy

1. **Set `SESSION_SECRET`** in **Workers & Pages → visionguard → Settings →
   Variables and Secrets**, as an encrypted secret. Nothing else is required to
   go live, but without this, sign-in and sign-up return a 503 telling you so.
   Generate one with
   `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.
2. **Optionally set a WhatsApp provider** so order alerts reach your phone. See
   *Orders on WhatsApp* below. Without it, orders are still taken and stored —
   you just have to read them with `npm run db:orders`.

The D1 database (`visionguardegdata`) is already created, bound in
`wrangler.toml`, and has its schema applied. If you deploy through the Pages
dashboard rather than Wrangler, confirm the D1 binding is attached to the
project under **Settings → Bindings**; the dashboard does not always inherit it
from `wrangler.toml`.

### Route A — Git integration (recommended)

The repo points at `github.com/Mahmoudnabil03/worldwidewebvisionai`. Push first:

```bash
git add -A && git commit -m "Add Vision Guard site and Cloudflare Pages config" && git push
```

Then set the build configuration in **Workers & Pages → your project → Settings →
Build**:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | *(leave empty)* |
| Deploy command | `npx wrangler pages deploy` |
| Build output directory | `public` |
| Root directory | `/` |

Every push to `main` publishes; every other branch gets a preview URL.

> **The deploy command matters.** The default is `npx wrangler deploy`, which is
> the *Workers* command. Running it against a Pages project fails with
> *"It looks like you've run a Workers-specific command in a Pages project."*
> It must be `wrangler pages **deploy**`. If your project has no "Deploy command"
> field at all, it is a classic Pages project — leave the build command empty and
> just set the output directory to `public`; Cloudflare uploads it directly and
> wrangler is never invoked.

> **`name` in `wrangler.toml` must match the project name.** `wrangler pages
> deploy` takes the target project from that field. If your Cloudflare project is
> not called `visionguard`, either change the `name` in `wrangler.toml` or use
> `npx wrangler pages deploy --project-name=<actual-name>` as the deploy command.
> A mismatch fails with "project not found".

### Route B — Direct upload from this machine

```bash
npm install
npx wrangler login
npm run deploy
```

`npm run deploy` runs `wrangler pages deploy`, which reads both the project name
and the output directory from `wrangler.toml` — no arguments to keep in sync.
Use `npm run deploy:preview` for a preview branch instead of production, and
`npm run dev` to serve locally *through Wrangler* — that is the only local server
that also applies `_headers`.

Wrangler is pinned to `^4.116.0`. The failing build installed `3.114.17` (from an
earlier `^3.90.0` range) and warned it was out of date; that warning is gone now.

### Custom domain

In the Pages project: **Custom domains → Set up a domain**. If `visionguardeg.com`
stays on the EasyOrders store, put this on a subdomain (`www`, `info`, or
`new`) so the storefront keeps working. Cloudflare issues the certificate
automatically.

---

## Headers

`public/_headers` sets caching and security. Two things to know before editing it:

**The CSP allow-lists the one inline script by hash.** `index.html` has a single
inline `<script>` in `<head>` that swaps `no-js` → `js`; it must run before paint,
so it cannot move to an external file without causing a flash of hidden content.
Its hash is pinned in the CSP:

```
'sha256-Kujm0/4azSdOPOSA6aaqqQwa4A5Ur08aglfQkpthXJo='
```

**If you change that script by even one character the hash breaks**, the script is
blocked, and the page loses every reveal animation *and* the pre-paint theme
application — silently, with content still visible. All three pages carry the
script byte for byte identically so they can share one hash; keep it that way.
Recompute with:

```bash
node -e "const c=require('crypto');const f=require('fs').readFileSync('public/index.html','utf8');const m=f.match(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/);console.log('sha256-'+c.createHash('sha256').update(m[1]).digest('base64'))"
```

The policy was verified against the real page: the inline script runs, Cairo and
Inter load from Google Fonts, the canvas paints, the grain `data:` URI resolves,
and the language toggle works — with zero console violations.

**Caching** is deliberately split: HTML revalidates on every request so redeploys
appear immediately; `styles.css` and `main.js` get one hour (they have unhashed
filenames, so they cannot be immutable); `assets/*` gets a year as `immutable`.
**If you change an image, change its filename** — otherwise visitors keep the old
one for up to a year.

---

## Local preview

```bash
npm install && npm run dev
```

That is `wrangler pages dev --port 5173`, and it is now the **only** local
server worth using: it serves the static files, compiles `functions/` so
`/api/*` works, applies `_headers` (so you are testing the real CSP), and
creates a local SQLite database under `.wrangler/` — production data is never
touched.

A plain static server (`python -m http.server`) will still render all three
pages, but every API call fails, so the cart cannot check out and nobody can
sign in.

> **Local caching gotcha.** `_headers` gives CSS and JS a one-hour
> `max-age`, and Wrangler honours it. After editing a stylesheet, a normal
> reload can serve you the old one. Hard-reload (Ctrl+Shift+R) or use
> DevTools → Network → *Disable cache*.

---

## Where the content came from

Everything was pulled from **visionguardeg.com** on 31 July 2026. Nothing on this
page is invented — the previous draft's statistics, street address and monitoring
claims have all been removed.

- **17 products** across 5 collections, with the discounted and pre-discount
  prices as listed.
- **Contact**: phone `01260087815`, WhatsApp `01105006854`, hours 12م–8م with
  Friday closed — taken from the announcement bar that appears on every page of
  the store. Facebook and Instagram from the footer.
- **Category descriptions** are condensed from your own collection pages.

Two notes on this:

1. **No email or street address exists anywhere on the live store**, so neither
   appears here. Send them and I will add them to the contact block and footer.
2. Your `robots.txt` carries Cloudflare's managed AI block list, which includes
   `ClaudeBot: Disallow: /` and `Content-Signal: ai-train=no`. I read the site at
   your explicit direction, as the owner, to move your own content — but if you
   want AI assistants to be able to read the store normally in future, that
   setting is in your Cloudflare dashboard.

### Amazon.eg price check — 31 July 2026

Searched amazon.eg for all 16 line items. **Only 5 had an exact model match.**
Those are updated (floored to the nearest 10, as asked); the rest keep their
visionguardeg.com prices, because substituting a different model's price would
put wrong figures in front of customers.

**Updated — exact model match on amazon.eg:**

| Product | Was | Amazon.eg | Now |
| --- | --- | --- | --- |
| Tapo C310 Wi-Fi Outdoor 3MP | 1,550 | 1,690.00 | **1,690** |
| Skyworth LC2308 Outdoor 3MP | 2,200 | 1,919.00 | **1,910** |
| Skyworth LC2103 Outdoor 4MP | 2,250 | 2,446.00 | **2,440** |
| Skyworth 64GB Surveillance microSD | 550 | 610.00 | **610** |
| Skyworth SKY-T128 128GB microSD | 800 | 960.00 | **960** |

Four of the five go *up*; LC2308 comes down by 290. Updated rows show a single
price — the old strike-through "before discount" figure was a store promotion and
does not apply to an Amazon-sourced price.

**Not updated — no exact match on amazon.eg:**

| Product | Why |
| --- | --- |
| Dahua XVR1B04-I-T | Only plain `DH-XVR1B04 value` (1,899) — different variant |
| Dahua XVR1B08-I-T | Only `XVR1B08-I` without the `-T` (2,999) |
| Dahua XVR5104HS-I3 | No listing at all |
| Dahua XVR5108HS-I3 | Only a third-party `OEM XVR5108H-I3` (3,349), different product |
| Dahua HAC-T5E20P ×2 | `T5E20P` returns zero results; only T1A21P / B1A21P exist |
| Dahua HAC-HDW1800RP | Zero results; nearest is HDW1200TRQ-A, a 2MP part |
| Seagate 500GB Surveillance | No SkyHawk under 8TB; the cheap 500GB hit is a refurbished desktop drive |
| WD Purple 1TB | Only `WD10PURX` at 2,750 — an older revision than `WD10PURZ`, and **+53% over your price** |
| Power supplies ×2 | Generic unbranded parts; amazon.eg spans 199–1,417 for the same rating |

**Worth thinking about before pushing these live:** these are competitor retail
prices, not your cost. Amazon.eg runs a visible markup on surveillance hardware —
the WD Purple gap above is the clearest example. Matching Amazon raises four of
your five verified prices, which may not be what you want commercially.

### Other things to check before launch

- The list is stamped "آخر تحديث للأسعار ٣١ يوليو ٢٠٢٦" in the markup — update
  that line whenever you refresh the figures.
- **Storage and Power Supply** spec lines are minimal; I never reached those
  individual product pages.
- Product rows are **not** individually linked — only three product URLs were
  discoverable, and guessing the other fourteen slugs would have produced broken
  links. Every category card and footer link points at a verified collection URL.

---

## Bilingual system

Arabic is the source of truth in the markup; English lives in `data-en`:

```html
<h2 data-en="Current stock and prices.">المتوفر حاليًا وأسعاره.</h2>
```

On load, `main.js` copies each element's Arabic `innerHTML` into `data-ar`, so
there is no separate dictionary to drift out of sync — **edit the HTML and both
languages stay correct**. The toggle swaps `innerHTML`, flips `lang` and `dir`,
switches the font stack, rebuilds the split-text spans, and persists the choice
to `localStorage`. Modules that own their own strings (the sticky note in "How to
order") listen for the `langchange` event.

To add a translatable string, just add `data-en`. To change the default language,
change the `lang`/`dir` on `<html>` and the fallback in `applyLang`.

---

## Why no GSAP or Lenis

The original brief referenced both. The behaviour is implemented directly:

- **No render-blocking CDN.** ~70 KB gzipped and a third-party point of failure
  on a page whose job is signalling reliability.
- **One rAF loop.** Every scroll-linked effect subscribes to a single scheduler
  (`onFrame`) and returns `true` only while it still needs frames. When they all
  return `false` the loop *stops completely* — no idle battery cost.
- **Composited properties only.** Animations touch `transform` and `opacity`. The
  hero canvas is the only per-frame paint, and it runs only while on screen.

Smooth scrolling lerps the *real* scroll position rather than translating a
wrapper, so `position: sticky`, anchors, the scrollbar and find-in-page keep
working. It is off on touch and coarse pointers, where hijacking native momentum
always feels worse. `onFrame` is the only seam to replace if you later want the
libraries.

---

## Customising

### Accent colour

One line drives hairlines, glows, buttons, price figures *and* the canvas hero,
which reads the value back out of CSS at runtime:

```css
:root { --accent-rgb: 27, 157, 217; }   /* #1B9DD9 */
```

### The light plate

```css
:root { --plate: #F4F6F8; }
```

Used by the logo badge, the boot curtain and every category image.

### Animation feel

| What | Where | Default |
| --- | --- | --- |
| Scroll weight | `main.js` → `smooth.current += diff * .105` | lower = heavier |
| **Hero scrub length** | `styles.css` → `.hero__track { height }` | **`185vh`** (was `340vh`) |
| Word reveal stagger | `main.js` → `splitWords` | `38ms` |
| Word reveal duration | `styles.css` → `.js [data-split] .wi` | `.72s` |
| Boot curtain | `styles.css` → `.boot` animation delay | out at `.52s` |
| Hero copy entrance | `main.js` → `introDelay` | `560ms` |

**On the hero scrub.** The canvas choreography is normalised to 0–1 across the
track, so the track height is the only speed control — every beat (power-on,
scan pass, detection locks, the link to the phone, the frame) compresses
proportionally. It was `340vh`, which meant roughly 2,000px of scrolling before
the page moved on; it is now `185vh` (~730px on a 860px-tall window), a 65% cut.
The responsive and reduced-motion overrides at the bottom of the stylesheet
(`165vh`, `150vh`, `110vh`) must be changed with it or narrow screens will keep
the old pacing.

### Theme

Dark is the default. The light palette is a full second set of tokens in
`styles.css` under `:root[data-theme="light"]` — not a filter — and the accent
hex is identical in both, so the brand colour never shifts. Translucent
overlays are written against `--bg-rgb` / `--ink-rgb` so they flip with the
theme; **if you add a hard-coded `rgba(255,255,255,…)` or `rgba(8,9,11,…)`
anywhere, it will be wrong in one of the two themes.**

The logo swaps with the theme: `logo-dark.png` (white GUARD) on dark,
`logo-trim.png` — the original artwork with the brand's own `#58595B` grey
GUARD — on light. That grey is the whole reason the dark variant exists: it
lands at about 1.9:1 on near-black, and about 6.4:1 on the light background.
The swap is done in JS because it is an `<img src>`, not a background.

The choice persists in `localStorage` and is re-applied by the inline `<head>`
script *before first paint*, so there is no flash of the other theme. The hero
canvas re-reads `--canvas-ink-rgb` on `themechange` — a near-white dot field
would be invisible on a light page.

---

## Accessibility & resilience

- Skip link, focus rings, `aria-expanded` on the menu toggle, `inert` on the
  closed overlay, `lang`/`dir` kept correct in both languages.
- `prefers-reduced-motion` fully honoured: boot curtain removed, hero scrub cut to
  `110vh`, every reveal rendered in its final state.
- Reveals use IntersectionObserver **plus a scroll-idle rescue sweep**. IO never
  fires for content the viewport jumps clean over — a hash landing, browser scroll
  restoration, a hard flick — and without the sweep that content would stay
  invisible permanently. Verified: jumping straight to the footer leaves 0 of 28
  elements stuck.
- The hero canvas derives its visibility from the rect it already measures for
  scroll progress rather than an observer, so there is no observer lifecycle that
  can strand it frozen.
- With JavaScript off, all content renders (reveal styles are scoped to a `.js`
  class) and the page stays Arabic — only motion and the language toggle are lost.

---

## The shop

`/shop` is a normal online shop: filter, search, sort, add to cart, check out.
The cart lives in `localStorage` as `{id, qty}` pairs and survives a reload; a
second tab editing it is picked up through the `storage` event rather than being
silently overwritten.

**Prices are never taken from the browser.** The cart sent at checkout is a list
of ids and quantities. `POST /api/orders` re-prices every line from
`public/catalog.js` — the same module the shop page renders from — and computes
the total itself. Editing `localStorage`, or the request body, changes nothing
about what an order costs. This is verified: a request carrying
`{"id":"xvr5108hs-i3","qty":1,"price":1}` is stored at 3,800.

Also enforced server-side: unknown product ids are rejected, quantities are
whole numbers from 1 to 99, the governorate must be one of the 27 in the list,
the address must be substantial, the terms box must be ticked, and cross-origin
POSTs are refused outright.

**To change a price, edit `public/catalog.js`.** That is the whole change —
there is no second list. The landing page's static price table in `index.html`
is separate and still hand-maintained; keep the two in step.

### Payment

Cash on delivery and bank transfer / e-wallet. **No card details are collected
anywhere on this site** and no payment processor is integrated. Every order is
confirmed by phone before it ships, which is how the shop already works.

Shipping shows as *quoted per governorate at confirmation* rather than a made-up
flat rate, because the store publishes no shipping table. If you want a fixed
fee, set `SHIPPING_FLAT` to a whole number of pounds and it is applied and shown
everywhere automatically.

### What the customer sees

An order number (`VG-260731-K3QX`, drawn from an alphabet with no `0`/`O` or
`1`/`I` because these get read down a phone line), a confirmation, and the order
in their account if they were signed in. **That is deliberately all.** The
WhatsApp notification described below is a back-office alert to you; it is never
shown or offered to the customer, and the message body — which contains their
details and the internal summary — is not returned to the browser at all.

---

## Orders on WhatsApp (back office)

When an order is written, a summary is pushed to the shop's own WhatsApp number.
It is Arabic-first and ordered so the top two lines are what you need on a lock
screen: what it is, and its number.

**It cannot delay or break an order.** The sequence is validate → re-price →
write to D1 → respond to the customer → *then* notify, via `waitUntil`. A dead
token, an expired 24-hour window or a provider outage costs you the alert, not
the order. The outcome is recorded on the order row (`notified`, `notify_error`)
so failures are visible instead of silent.

Four providers are supported; the first one whose credentials you set wins, or
force one with `WHATSAPP_PROVIDER`. All of them are optional.

| Provider | Set | Notes |
| --- | --- | --- |
| `meta` | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID` | Official Cloud API, free tier. Business-initiated messages outside a 24-hour window **must** use an approved template — set `WHATSAPP_TEMPLATE` to a template whose body is a single `{{1}}`. |
| `ultramsg` | `ULTRAMSG_INSTANCE`, `ULTRAMSG_TOKEN` | Bridges a normal WhatsApp account. No template approval, no 24-hour rule. Paid, and not Meta-sanctioned. |
| `twilio` | `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` | Same template rules as Meta. |
| `callmebot` | `CALLMEBOT_KEY` | Free, one recipient, plain text. Fine for "ping my phone". |

**With none of them set, orders are still taken and stored** — you just have to
read them out of the database (`npm run db:orders`) instead of getting a push.
Set one before launch, or you will not know an order arrived.

---

## Accounts, consent and the mailing list

`/account` has sign-in and sign-up. Guest checkout stays fully available —
requiring registration to buy loses orders.

Sign-up has **three separate boxes**, and the separation is the point:

1. **Terms of use + privacy policy** — required. Without it, no account.
2. **Newsletter** — optional. Email only.
3. **Marketing on WhatsApp / SMS** — optional, and separate again.

Bundling marketing into the terms checkbox would make the consent worthless, so
they are never combined. Both optional consents are editable from *Preferences*
at any time, and **unticking the newsletter box stamps `unsub_at` on the mailing
list row** rather than only flipping a flag on the account — withdrawal has to be
as easy as consent was. `/api/newsletter` also exists for a bare subscribe, and
answers identically whether or not the address was already on the list, so it
cannot be used to test who is subscribed.

Export the list with `npm run db:newsletter`.

### How the passwords are stored

PBKDF2-SHA256, per-user salt, iteration count stored inside each hash string,
plus a **server-side pepper**: the password is HMAC'd with `SESSION_SECRET`
before the KDF runs. A stolen `users` table is not attackable offline without
also stealing the secret, which lives in the platform and is never written to
the database.

The default is 25,000 iterations rather than OWASP's 210,000 for one concrete
reason: Pages Functions on the Cloudflare **Free** plan get 10 ms of CPU per
request, and 210k blows straight through it — logins would fail outright, not
just slowly. On the Workers **Paid** plan set `PBKDF2_ITERATIONS=210000`;
existing hashes keep verifying, because each one records the count it was made
with.

Sessions are stateless HMAC-signed cookies (HttpOnly, SameSite=Lax, 30 days) —
no session table, no cleanup job. The trade-off: signing out clears the cookie
on that device only. Rotate `SESSION_SECRET` to invalidate every session
everywhere — but note that also invalidates every stored password hash, so set
it once and leave it alone.

---

## Attendance

The tab appears in `/account` when the signed-in address ends in
`@visionguardeg.com`. **Hiding the tab is presentation, not access control** —
every attendance endpoint re-checks the domain server-side, so an ordinary
customer calling the API directly gets a 403.

- **The contracted day is 6 hours**, set by `WORK_DAY_HOURS`. Every target,
  status and balance is derived from that one number.
- **Times come from the server clock**, never the browser. A device with a wrong
  clock — or one set wrong deliberately — cannot change a shift length. The
  on-screen timer counts locally between actions purely for display, and is
  re-synced from the server on every clock action.
- **Days are Cairo days**, resolved through `Intl` so Egypt's DST is handled per
  instant rather than hard-coded. A shift belongs to the day it *started*, so
  23:00 → 01:00 counts against the day it began.
- **A day can hold several shifts.** A break is a clock-out and a clock-in, and
  the day's total is the sum.
- **A double clock-in is impossible at the storage layer**, not just in the
  handler: a partial unique index (`WHERE clock_out IS NULL`) permits at most one
  open shift per person, so a double-tap or a racing second tab cannot create
  two.
- **A forgotten clock-out is closed automatically** after 16 hours, at exactly
  the contracted day length, and the row is labelled `auto-closed: no clock-out
  recorded` — visible in the table. An estimate that announces itself, rather
  than a silent invention.

Statuses are `complete` / `short` / `overtime` against the 6-hour target with a
five-minute grace either side, plus `open` while a shift is running and `absent`
for a day with nothing recorded. A day with a recorded shift is never `absent`,
even if it rounds to zero — the two must not look the same on a timesheet.

Read the raw records with `npm run db:attendance`.

There is no manager view yet. Corrections are a SQL statement today; a proper
admin page is the obvious next piece of work.

---

## Database

Cloudflare D1, bound as `DB`.

| Name | `visionguardegdata` |
| --- | --- |
| ID | `b538d110-35d6-43bd-b821-233c26e173bd` |

Both are already in `wrangler.toml`, and the schema has been applied. `lib/db.js`
also applies the same `CREATE TABLE IF NOT EXISTS` statements once per isolate,
so a fresh or replaced database heals itself on first request rather than
failing until someone remembers a migration.

Tables: `users`, `orders`, `attendance`, `newsletter`, `rate`. Money is stored as
whole Egyptian pounds in `INTEGER` columns — the catalogue has no piastres, and
integers cannot drift the way floats do.

```bash
npm run db:orders        # last 20 orders, with WhatsApp delivery status
npm run db:attendance    # last 50 shifts, with employee names
npm run db:newsletter    # the mailing list
npm run db:init          # re-apply schema.sql (idempotent)
```

`wrangler pages dev` ignores the ID and uses a local SQLite file under
`.wrangler/`, so **local development can never touch production data.**

---

## Environment variables

Set these under **Workers & Pages → visionguard → Settings → Variables and
Secrets**, as *encrypted secrets* — not plaintext variables. Locally they go in
`.dev.vars`, which is gitignored. `.dev.vars.example` documents every one.

| Variable | Required | What it does |
| --- | --- | --- |
| `SESSION_SECRET` | **Yes** | Signs session cookies and peppers password hashes. 32+ random characters. Without it, sign-in returns a clear 503 rather than running insecurely. |
| `WHATSAPP_TO` | No | Where order alerts go. Defaults to the number published on the site. |
| `WHATSAPP_*` / `ULTRAMSG_*` / `TWILIO_*` / `CALLMEBOT_KEY` | No | Pick one provider — see the table above. |
| `WORK_DAY_HOURS` | No | Contracted day. Default `6`. Already set in `wrangler.toml`. |
| `SHIPPING_FLAT` | No | Flat shipping fee in EGP. Default `0` = quoted at confirmation. |
| `PBKDF2_ITERATIONS` | No | Default `25000`. Raise to `210000` on the Workers Paid plan. |

Generate the secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## API

Everything is same-origin JSON. Mutating requests require a matching `Origin`,
on top of the `SameSite=Lax` cookie. Rate limits are per IP (and per email for
login) in fixed windows, and fail *open* — a misbehaving counter must not lock
customers out of checkout.

| Route | Method | Notes |
| --- | --- | --- |
| `/api/catalog` | GET | Products, categories, governorates as JSON. |
| `/api/orders` | POST | Place an order. Guest or signed in. |
| `/api/orders` | GET | The signed-in customer's own orders. |
| `/api/auth/signup` | POST | Creates the account and signs in. |
| `/api/auth/login` | POST | Same message either way, so it cannot be used to discover registered addresses. |
| `/api/auth/logout` | POST | Clears the cookie on this device. |
| `/api/auth/me` | GET | Returns `user: null` with a 200 when signed out, so a page can boot without treating that as an error. |
| `/api/account/preferences` | POST | Name, phone, and the two consents. |
| `/api/newsletter` | POST | Bare subscribe. |
| `/api/attendance` | GET | Staff only. Days, sessions, totals. |
| `/api/attendance/clock` | POST | Staff only. `{action: "in" \| "out"}`. |

---

## Still to do

- **A manager view for attendance.** Employees can see their own record;
  correcting someone else's is a SQL statement today.
- **Order status changes.** `orders.status` exists (`new` → `confirmed` →
  `shipped` → `done` → `cancelled`) and is shown in the customer's account, but
  nothing moves it yet except SQL.
- **Password reset.** There is no email sender wired up, so a forgotten password
  currently needs you to reset the row.
- **The landing page's static price table** in `index.html` is maintained
  separately from `catalog.js`. Worth generating one from the other.
