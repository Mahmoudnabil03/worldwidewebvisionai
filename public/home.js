/* =========================================================================
   Vision Guard — home.js
   Renders the landing page's two catalogue-driven sections — the category
   cards and the price list — from catalog.js.

   Both used to be hand-written markup. With fifteen products in five
   categories that was merely tedious; at sixty in eight it is a guarantee
   that the front page and the shop will eventually quote different prices
   for the same recorder, which is the one bug a price list must not have.

   Kept separate from main.js because this is the only part of the landing
   page that needs to be a module (catalog.js is one), and because main.js
   owns behaviour while this owns content.
   ========================================================================= */
import { CATEGORIES, PRODUCTS } from './catalog.js?v=31';

const cats  = document.querySelector('.cats');
const plist = document.querySelector('.plist');
if (cats || plist) {
  const root = document.documentElement;

  function lang() {
    return root.getAttribute('lang') === 'en' ? 'en' : 'ar';
  }
  function t(pair) {
    if (!pair) return '';
    return (lang() === 'en' ? pair.en : pair.ar) || pair.ar || pair.en || '';
  }
  function money(n) {
    return Number(n || 0).toLocaleString('en-US');
  }
  function el(tag, cls) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  /* -----------------------------------------------------------------------
     Category cards

     The old markup alternated two wide cards among three normal ones to fill
     the six-column grid. With eight categories the same trick is: make the
     first and the last wide, so both rows of the 6-col grid come out even
     (3+3 / 2+2+2 …). Rather than encode that per card, the class is applied
     by index — the layout follows the list length instead of the list
     following the layout.
     ----------------------------------------------------------------------- */
  function renderCats() {
    if (!cats) return;
    cats.textContent = '';
    CATEGORIES.forEach((c, i) => {
      const a = el('a', 'cat reveal');
      /* two wide cards per eight keeps the 6-column grid square */
      if (i === 0 || i === CATEGORIES.length - 1) a.classList.add('cat--wide');
      a.href = `shop.html?cat=${encodeURIComponent(c.id)}`;
      a.style.setProperty('--d', `${i * 70}ms`);

      const plate = el('span', 'cat__plate');
      const img = document.createElement('img');
      img.src = c.img;
      img.alt = '';
      img.loading = 'lazy';
      plate.appendChild(img);

      const meta = el('span', 'cat__meta');
      const idx = el('span', 'cat__idx');
      idx.textContent = String(i + 1).padStart(2, '0');
      const name = el('span', 'cat__name');
      name.textContent = t(c);
      const desc = el('span', 'cat__desc');
      desc.textContent = t(c.blurb);
      meta.append(idx, name, desc);

      a.append(plate, meta);
      cats.appendChild(a);
    });
  }

  /* -----------------------------------------------------------------------
     Price list — one group per category, in catalogue order
     ----------------------------------------------------------------------- */
  function renderList() {
    if (!plist) return;
    plist.textContent = '';
    CATEGORIES.forEach((c) => {
      const rows = PRODUCTS.filter((p) => p.cat === c.id);
      if (!rows.length) return;

      const group = el('div', 'pgroup reveal');
      const h = el('h3', 'pgroup__title');
      const label = document.createElement('span');
      label.textContent = t(c);
      const brands = el('i');
      /* the brands actually present in this category, not a fixed caption */
      brands.textContent = [...new Set(rows.map((p) => p.brand))].join(' · ');
      h.append(label, brands);

      const ul = el('ul', 'prods');
      rows.forEach((p) => {
        const li = el('li', 'prod');
        const nm = el('span', 'prod__name');
        nm.textContent = p.name;
        const spec = el('span', 'prod__spec');
        spec.textContent = lang() === 'en' ? p.en : p.ar;

        const price = el('span', 'prod__price');
        const b = document.createElement('b');
        b.textContent = money(p.price);
        price.appendChild(b);
        if (p.was) {
          const s = document.createElement('s');
          s.textContent = money(p.was);
          price.appendChild(s);
        }
        const em = document.createElement('em');
        em.textContent = lang() === 'en' ? 'EGP' : 'ج.م';
        price.appendChild(em);

        li.append(nm, spec, price);
        ul.appendChild(li);
      });

      group.append(h, ul);
      plist.appendChild(group);
    });
  }

  function renderAll() {
    renderCats();
    renderList();
    /* main.js has already run its IntersectionObserver over the markup that
       was in the document at load, and these nodes were not. Rather than
       reach into its observer, they simply skip the entrance animation —
       they are below the fold either way. */
    document.querySelectorAll('.cats .reveal, .plist .reveal')
      .forEach((n) => n.classList.add('is-in'));
  }

  renderAll();

  /* main.js writes lang on <html> when the language button is used. */
  new MutationObserver(renderAll)
    .observe(root, { attributes: true, attributeFilter: ['lang'] });
}
