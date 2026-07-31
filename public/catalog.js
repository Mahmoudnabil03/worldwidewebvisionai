/* =========================================================================
   Vision Guard — catalog.js
   THE single source of truth for products and prices.

   Imported twice:
     • the browser, by shop.js  (<script type="module">)
     • the server, by functions/api/orders.js

   That matters. The server never trusts a price sent by the client — it
   re-prices every line from this file — so a tampered cart cannot buy a
   3,800 EGP recorder for 1 EGP. Because both sides read the same module,
   editing a price here is the whole change; there is no second list to
   forget.

   Figures are the ones already published on the site (index.html) as of
   31 July 2026. `was` is the pre-discount price and is display-only.
   ========================================================================= */

export const CATEGORIES = [
  { id: 'wireless', ar: 'كاميرات Wireless',        en: 'Wireless Cameras',    img: 'assets/cat-wireless.jpg' },
  { id: 'analog',   ar: 'كاميرات HD (Analog)',     en: 'HD Cameras (Analog)', img: 'assets/cat-analog.jpg'   },
  { id: 'dvr',      ar: 'أجهزة تسجيل DVR — XVR',   en: 'DVR / XVR Recorders', img: 'assets/cat-dvr.webp'     },
  { id: 'storage',  ar: 'وحدات التخزين',           en: 'Storage Devices',     img: 'assets/cat-storage.jpg'  },
  { id: 'power',    ar: 'البور سبلاي',             en: 'Power Supply',        img: 'assets/cat-power.jpg'    }
];

export const PRODUCTS = [
  /* ---------------- DVR / XVR ---------------- */
  {
    id: 'xvr1b04-i-t', cat: 'dvr', brand: 'Dahua',
    name: 'Dahua DH-XVR1B04-I-T',
    ar: '٤ قنوات · WizSense', en: '4 channels · WizSense',
    price: 1550, was: 1600
  },
  {
    id: 'xvr1b08-i-t', cat: 'dvr', brand: 'Dahua',
    name: 'Dahua DH-XVR1B08-I-T',
    ar: '٨ قنوات · WizSense', en: '8 channels · WizSense',
    price: 2000, was: 2050
  },
  {
    id: 'xvr5104hs-i3', cat: 'dvr', brand: 'Dahua',
    name: 'Dahua DH-XVR5104HS-I3',
    ar: '٤ قنوات · WizSense · SMD Plus', en: '4 channels · WizSense · SMD Plus',
    price: 3100, was: 3150
  },
  {
    id: 'xvr5108hs-i3', cat: 'dvr', brand: 'Dahua',
    name: 'Dahua DH-XVR5108HS-I3',
    ar: '٨ قنوات · Penta-brid · AI Coding', en: '8 channels · Penta-brid · AI Coding',
    price: 3800, was: 4000
  },

  /* ---------------- Wireless ---------------- */
  {
    id: 'tapo-c310', cat: 'wireless', brand: 'Tapo',
    name: 'Tapo C310 Wi-Fi Outdoor',
    ar: '٣ ميجابكسل · خارجية · رؤية ليلية', en: '3MP · outdoor · night vision',
    price: 1690, was: 0
  },
  {
    id: 'skyworth-lc2308', cat: 'wireless', brand: 'Skyworth',
    name: 'Skyworth LC2308 Wi-Fi Outdoor',
    ar: '٣ ميجابكسل · خارجية · IP66', en: '3MP · outdoor · IP66',
    price: 1910, was: 0
  },
  {
    id: 'skyworth-lc2103', cat: 'wireless', brand: 'Skyworth',
    name: 'Skyworth LC2103 Wi-Fi Outdoor',
    ar: '٤ ميجابكسل · إضاءة مزدوجة · صوت ثنائي', en: '4MP · dual-light · 2-way audio',
    price: 2440, was: 0
  },

  /* ---------------- Analog ---------------- */
  {
    id: 'hac-t5e20p-in', cat: 'analog', brand: 'Dahua',
    name: 'Dahua DH-HAC-T5E20P',
    ar: '٢ ميجابكسل · داخلية', en: '2MP · indoor',
    price: 450, was: 475
  },
  {
    id: 'hac-t5e20p-out', cat: 'analog', brand: 'Dahua',
    name: 'Dahua DH-HAC-T5E20P',
    ar: '٢ ميجابكسل · خارجية', en: '2MP · outdoor',
    price: 450, was: 475
  },
  {
    id: 'hac-hdw1800rp', cat: 'analog', brand: 'Dahua',
    name: 'Dahua DH-HAC-HDW1800RP',
    ar: '٨ ميجابكسل · داخلية · رؤية ليلية', en: '8MP · indoor · IR night vision',
    price: 1050, was: 1100
  },

  /* ---------------- Storage ---------------- */
  {
    id: 'skyworth-64gb', cat: 'storage', brand: 'Skyworth',
    name: 'Skyworth 64GB Surveillance',
    ar: 'كارت ذاكرة MicroSD / TF', en: 'MicroSD / TF card',
    price: 610, was: 0
  },
  {
    id: 'skyworth-t128', cat: 'storage', brand: 'Skyworth',
    name: 'Skyworth SKY-T128 128GB',
    ar: 'كارت ذاكرة MicroSD / TF · U1 A1', en: 'MicroSD / TF · U1 A1',
    price: 960, was: 0
  },
  {
    id: 'seagate-500gb', cat: 'storage', brand: 'Seagate',
    name: 'Seagate 500GB Surveillance',
    ar: 'هارد ديسك · مخصص للعمل ٢٤/٧', en: 'Hard drive · 24/7 rated',
    price: 625, was: 650
  },
  {
    id: 'wd-purple-1tb', cat: 'storage', brand: 'WD',
    name: 'WD Purple 1TB Surveillance',
    ar: 'هارد ديسك · مخصص للعمل ٢٤/٧', en: 'Hard drive · 24/7 rated',
    price: 1800, was: 1820
  },

  /* ---------------- Power ---------------- */
  {
    id: 'psu-12v-10a', cat: 'power', brand: 'ElectroTech',
    name: 'ElectroTech Power Supply',
    ar: '١٢ فولت · ١٠ أمبير', en: '12V · 10A',
    price: 220, was: 250
  },
  {
    id: 'psu-12v-20a', cat: 'power', brand: 'Professional Security',
    name: 'Professional Security Power Supply',
    ar: '١٢ فولت · ٢٠ أمبير', en: '12V · 20A',
    price: 300, was: 320
  }
];

/* Category image doubles as the product image: the store has one studio shot
   per collection, not per SKU. Inventing per-product art would be worse than
   reusing the real one. */
const CAT_IMG = CATEGORIES.reduce(function (m, c) { m[c.id] = c.img; return m; }, {});

export function imageFor(product) {
  return CAT_IMG[product.cat] || 'assets/logo-trim.png';
}

const BY_ID = PRODUCTS.reduce(function (m, p) { m[p.id] = p; return m; }, {});

export function findProduct(id) {
  return Object.prototype.hasOwnProperty.call(BY_ID, id) ? BY_ID[id] : null;
}

/* The 27 governorates, for the delivery address. Shipping is quoted on
   confirmation rather than guessed here — see README. */
export const GOVERNORATES = [
  { ar: 'القاهرة', en: 'Cairo' },
  { ar: 'الجيزة', en: 'Giza' },
  { ar: 'الإسكندرية', en: 'Alexandria' },
  { ar: 'القليوبية', en: 'Qalyubia' },
  { ar: 'الشرقية', en: 'Sharqia' },
  { ar: 'الدقهلية', en: 'Dakahlia' },
  { ar: 'البحيرة', en: 'Beheira' },
  { ar: 'المنوفية', en: 'Monufia' },
  { ar: 'الغربية', en: 'Gharbia' },
  { ar: 'كفر الشيخ', en: 'Kafr El Sheikh' },
  { ar: 'دمياط', en: 'Damietta' },
  { ar: 'بورسعيد', en: 'Port Said' },
  { ar: 'الإسماعيلية', en: 'Ismailia' },
  { ar: 'السويس', en: 'Suez' },
  { ar: 'شمال سيناء', en: 'North Sinai' },
  { ar: 'جنوب سيناء', en: 'South Sinai' },
  { ar: 'الفيوم', en: 'Faiyum' },
  { ar: 'بني سويف', en: 'Beni Suef' },
  { ar: 'المنيا', en: 'Minya' },
  { ar: 'أسيوط', en: 'Asyut' },
  { ar: 'سوهاج', en: 'Sohag' },
  { ar: 'قنا', en: 'Qena' },
  { ar: 'الأقصر', en: 'Luxor' },
  { ar: 'أسوان', en: 'Aswan' },
  { ar: 'البحر الأحمر', en: 'Red Sea' },
  { ar: 'الوادي الجديد', en: 'New Valley' },
  { ar: 'مطروح', en: 'Matrouh' }
];
