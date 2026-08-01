/* =========================================================================
   Vision Guard — catalog.js
   THE single source of truth for products and prices.

   Imported twice:
     • the browser, by shop.js  (<script type="module">)
     • the server, by functions/api/orders.js

   That matters. The server never trusts a price sent by the client — it
   re-prices every line from this file — so a tampered cart cannot buy a
   4,375 EGP recorder for 1 EGP. Because both sides read the same module,
   editing a price here is the whole change; there is no second list to
   forget.

   PRICES — 1 August 2026
   Taken from the "سعر البيع" column of "أسعار سوق الكاميرات new.xlsm",
   which is cost + margin and therefore lands on quarters and halves. Retail
   does not price in quarter-pounds, so each figure is rounded to the nearest
   5 EGP — the same rounding the shop was already doing by hand (the sheet's
   218.75 power supply has always been sold at 220). Two examples of what
   that means in practice: 1,781.25 → 1,780, and 2,187.50 → 2,190.

   The purchase-price column of that sheet is cost data. It is not in this
   file, and it must never be: this module is served to the browser.

   `was` is a display-only "before" price. Every row is 0 — the sheet has no
   such column, and a struck-through number that nothing backs up is a lie
   about a discount.
   ========================================================================= */

/* Every image is a shot of the thing it sells. Rows still waiting on a photo
   carry no `img` and fall back to their category picture — see imageFor().
   That is deliberately visible rather than hidden behind generic stock art
   of a model we do not stock. */
/* `blurb` is the landing page's category-card copy. It lives here rather
   than in index.html for the same reason the prices do: the cards are
   rendered from this list, so adding a category adds a card, and there is no
   second copy of the section to update and forget. */
export const CATEGORIES = [
  {
    id: 'wireless', ar: 'كاميرات Wireless', en: 'Wireless Cameras',
    img: 'assets/products/skyworth-lc2308.jpg',
    blurb: {
      ar: 'متابعة مباشرة من الموبايل، تنبيهات حركة، تركيب سريع بدون DVR. موديلات داخلية وخارجية.',
      en: 'Live view from your phone, motion alerts, quick install with no DVR. Indoor and outdoor models.'
    }
  },
  {
    id: 'analog', ar: 'كاميرات HD (Analog)', en: 'HD Cameras (Analog)',
    img: 'assets/products/hac-hdw1800rp.webp',
    blurb: {
      ar: 'حل اقتصادي وفعّال للمنزل والشركة والمحل. توصيل بكوابل وإشارة ثابتة بدون تقطيع.',
      en: 'An economical, dependable option for home, office and shop. Cabled signal with no dropouts.'
    }
  },
  {
    id: 'ip', ar: 'كاميرات IP', en: 'IP Cameras',
    img: 'assets/products/skyworth-lc2103.jpg',
    blurb: {
      ar: 'دقة أعلى وتحكّم في الحركة عن بُعد، بتشتغل على شبكة وتوصل بكابل شبكة واحد.',
      en: 'Higher resolution and remote pan-tilt control, running over the network on a single data cable.'
    }
  },
  {
    id: 'dvr', ar: 'أجهزة تسجيل DVR — XVR', en: 'DVR / XVR Recorders',
    img: 'assets/products/xvr5108hs-i3.jpg',
    blurb: {
      ar: 'قلب نظام المراقبة: تسجيل وتشغيل ومشاهدة عن بُعد. اختار ٤ أو ٨ أو ١٦ قناة حسب عدد الكاميرات.',
      en: 'The heart of the system: record, play back, and view remotely. Pick 4, 8 or 16 channels.'
    }
  },
  {
    id: 'storage', ar: 'وحدات التخزين', en: 'Storage Devices',
    img: 'assets/products/wd-purple-1tb.jpg',
    blurb: {
      ar: 'هاردات مخصصة لأنظمة المراقبة زي WD Purple و Seagate، وكروت ذاكرة للكاميرات الوايرلس.',
      en: 'Surveillance-rated drives — WD Purple and Seagate — plus memory cards for the Wi-Fi cameras.'
    }
  },
  {
    id: 'power', ar: 'البور سبلاي', en: 'Power Supply',
    img: 'assets/products/psu-12v-10a.jpg',
    blurb: {
      ar: 'تغذية ١٢ فولت ثابتة بالسعة المناسبة لعدد الكاميرات — من ١٠ لـ ٤٠ أمبير.',
      en: 'Stable 12V supply sized to your camera count — from 10A up to 40A.'
    }
  },
  {
    id: 'cable', ar: 'الأسلاك', en: 'Cable',
    img: 'assets/products/psu-12v-10a.jpg',
    blurb: {
      ar: 'سلك كاميرات RG59 و RG60 بالبكرة، وسلك شبكة Cat6 للأنظمة اللي بتشتغل على IP.',
      en: 'RG59 and RG60 camera coax by the roll, and Cat6 network cable for IP systems.'
    }
  },
  {
    id: 'accessory', ar: 'إكسسوارات وتركيبات', en: 'Accessories',
    img: 'assets/products/psu-12v-20a.jpg',
    blurb: {
      ar: 'راك، محولات، علب توصيلات وجاكات BNC و DC — القطع الصغيرة اللي التركيب مش بيكمل من غيرها.',
      en: 'Rack, adaptors, junction boxes and BNC/DC connectors — the small parts an install does not finish without.'
    }
  }
];

/* Naming: the sheet is shorthand kept by someone who already knows the
   stock — "dahwa 8 port 5mb". Where that shorthand maps to a model we can
   name with certainty, it is named (the four Dahua recorders, every Skyworth
   / Tapo / Tenda camera, the drives, the cards). Where it does not, the row
   keeps the sheet's own generic description rather than being dressed up
   with a model number nobody verified. */
export const PRODUCTS = [
  /* ---------------- HD / Analog cameras ---------------- */
  {
    id: 'unv-2mp', cat: 'analog', brand: 'Uniview',
    name: 'Uniview 2MP HD',
    ar: '٢ ميجابكسل · داخلية وخارجية', en: '2MP · indoor and outdoor',
    img: 'assets/products/unv-2mp.jpg',
    price: 440, was: 0
  },
  {
    id: 'unv-2mp-mic', cat: 'analog', brand: 'Uniview',
    name: 'Uniview 2MP HD with Mic',
    ar: '٢ ميجابكسل · مايك مدمج · داخلية وخارجية', en: '2MP · built-in mic · indoor and outdoor',
    img: 'assets/products/unv-2mp-mic.jpg',
    price: 500, was: 0
  },
  {
    id: 'unv-2mp-nv', cat: 'analog', brand: 'Uniview',
    name: 'Uniview 2MP HD Night Vision',
    ar: '٢ ميجابكسل · رؤية ليلية · داخلية وخارجية', en: '2MP · night vision · indoor and outdoor',
    img: 'assets/products/unv-2mp-nv.jpg',
    price: 875, was: 0
  },
  {
    id: 'unv-5mp', cat: 'analog', brand: 'Uniview',
    name: 'Uniview 5MP HD',
    ar: '٥ ميجابكسل · داخلية وخارجية', en: '5MP · indoor and outdoor',
    img: 'assets/products/unv-5mp.jpg',
    price: 1000, was: 0
  },
  {
    id: 'unv-5mp-nv', cat: 'analog', brand: 'Uniview',
    name: 'Uniview 5MP HD Night Vision',
    ar: '٥ ميجابكسل · رؤية ليلية · داخلية وخارجية', en: '5MP · night vision · indoor and outdoor',
    img: 'assets/products/unv-5mp-nv.jpg',
    price: 1250, was: 0
  },
  {
    id: 'dahua-2mp', cat: 'analog', brand: 'Dahua',
    name: 'Dahua 2MP HD',
    ar: '٢ ميجابكسل · داخلية وخارجية', en: '2MP · indoor and outdoor',
    img: 'assets/products/dahua-2mp.jpg',
    price: 500, was: 0
  },
  {
    id: 'dahua-2mp-nv', cat: 'analog', brand: 'Dahua',
    name: 'Dahua 2MP HD Night Vision',
    ar: '٢ ميجابكسل · رؤية ليلية · داخلية', en: '2MP · night vision · indoor',
    img: 'assets/products/hac-t5e20p.webp',
    price: 940, was: 0
  },
  {
    id: 'dahua-5mp', cat: 'analog', brand: 'Dahua',
    name: 'Dahua 5MP HD',
    ar: '٥ ميجابكسل · داخلية وخارجية', en: '5MP · indoor and outdoor',
    img: 'assets/products/dahua-5mp.jpg',
    price: 1125, was: 0
  },
  {
    id: 'dahua-5mp-nv', cat: 'analog', brand: 'Dahua',
    name: 'Dahua 5MP HD Night Vision',
    ar: '٥ ميجابكسل · رؤية ليلية · داخلية وخارجية', en: '5MP · night vision · indoor and outdoor',
    price: 1440, was: 0
  },
  {
    id: 'dahua-8mp', cat: 'analog', brand: 'Dahua',
    name: 'Dahua DH-HAC-HDW1800RP',
    ar: '٨ ميجابكسل · داخلية · رؤية ليلية', en: '8MP · indoor · IR night vision',
    img: 'assets/products/hac-hdw1800rp.webp',
    price: 2190, was: 0
  },

  /* ---------------- IP ---------------- */
  {
    id: 'dahua-ip-pt-3mp', cat: 'ip', brand: 'Dahua',
    name: 'Dahua 3MP IP Pan-Tilt',
    ar: '٣ ميجابكسل · متحركة · خارجية', en: '3MP · pan-tilt · outdoor',
    price: 4375, was: 0
  },

  /* ---------------- Wireless ---------------- */
  {
    id: 'imou-3mp', cat: 'wireless', brand: 'Imou',
    name: 'Imou 3MP Wi-Fi',
    ar: '٣ ميجابكسل · داخلية', en: '3MP · indoor',
    img: 'assets/products/imou-3mp.jpg',
    price: 1190, was: 0
  },
  {
    id: 'imou-5mp', cat: 'wireless', brand: 'Imou',
    name: 'Imou 5MP Wi-Fi',
    ar: '٥ ميجابكسل · داخلية', en: '5MP · indoor',
    img: 'assets/products/imou-5mp.jpg',
    price: 1565, was: 0
  },
  {
    id: 'imou-3mp-color', cat: 'wireless', brand: 'Imou',
    name: 'Imou 3MP Wi-Fi Full Colour',
    ar: '٣ ميجابكسل · ألوان ليلًا · داخلية', en: '3MP · full-colour night · indoor',
    price: 1500, was: 0
  },
  {
    id: 'imou-5mp-color', cat: 'wireless', brand: 'Imou',
    name: 'Imou 5MP Wi-Fi Full Colour',
    ar: '٥ ميجابكسل · ألوان ليلًا · داخلية', en: '5MP · full-colour night · indoor',
    price: 1875, was: 0
  },
  {
    id: 'imou-3mp-cruiser', cat: 'wireless', brand: 'Imou',
    name: 'Imou Cruiser 3MP Wi-Fi',
    ar: '٣ ميجابكسل · متحركة · خارجية', en: '3MP · motorised pan-tilt · outdoor',
    img: 'assets/products/imou-3mp-cruiser.jpg',
    price: 2750, was: 0
  },
  {
    id: 'imou-3mp-fixed', cat: 'wireless', brand: 'Imou',
    name: 'Imou 3MP Wi-Fi Outdoor',
    ar: '٣ ميجابكسل · ثابتة · خارجية', en: '3MP · fixed · outdoor',
    img: 'assets/products/imou-3mp-fixed.jpg',
    price: 2000, was: 0
  },
  {
    id: 'skyworth-h30', cat: 'wireless', brand: 'Skyworth',
    name: 'Skyworth H30 Wi-Fi',
    ar: '٣ ميجابكسل · داخلية', en: '3MP · indoor',
    img: 'assets/products/skyworth-h30.jpg',
    price: 1000, was: 0
  },
  {
    id: 'skyworth-h30p', cat: 'wireless', brand: 'Skyworth',
    name: 'Skyworth H30P Wi-Fi',
    ar: '٣ ميجابكسل · متحركة · داخلية', en: '3MP · pan-tilt · indoor',
    img: 'assets/products/skyworth-h30p.jpg',
    price: 1125, was: 0
  },
  {
    id: 'skyworth-lc2308', cat: 'wireless', brand: 'Skyworth',
    name: 'Skyworth LC2308 Wi-Fi Outdoor',
    ar: '٣ ميجابكسل · خارجية · IP66', en: '3MP · outdoor · IP66',
    img: 'assets/products/skyworth-lc2308.jpg',
    price: 2250, was: 0
  },
  {
    id: 'skyworth-lc2103', cat: 'wireless', brand: 'Skyworth',
    name: 'Skyworth LC2103 Wi-Fi Outdoor',
    ar: '٤ ميجابكسل · إضاءة مزدوجة · صوت ثنائي', en: '4MP · dual-light · 2-way audio',
    img: 'assets/products/skyworth-lc2103.jpg',
    price: 2625, was: 0
  },
  {
    id: 'tapo-c70', cat: 'wireless', brand: 'Tapo',
    name: 'Tapo C70 Wi-Fi',
    ar: '٢ ميجابكسل · داخلية', en: '2MP · indoor',
    img: 'assets/products/tapo-c70.jpg',
    price: 940, was: 0
  },
  {
    id: 'tapo-c200', cat: 'wireless', brand: 'Tapo',
    name: 'Tapo C200 Wi-Fi',
    ar: '٢ ميجابكسل · متحركة · داخلية', en: '2MP · pan-tilt · indoor',
    img: 'assets/products/tapo-c200.jpg',
    price: 1190, was: 0
  },
  {
    id: 'tapo-c310', cat: 'wireless', brand: 'Tapo',
    name: 'Tapo C310 Wi-Fi Outdoor',
    ar: '٣ ميجابكسل · خارجية · رؤية ليلية', en: '3MP · outdoor · night vision',
    img: 'assets/products/tapo-c310.jpg',
    price: 1875, was: 0
  },
  {
    id: 'tapo-c520ws', cat: 'wireless', brand: 'Tapo',
    name: 'Tapo C520WS Wi-Fi Outdoor',
    ar: '٤ ميجابكسل · متحركة ٣٦٠° · خارجية', en: '4MP · 360° pan-tilt · outdoor',
    img: 'assets/products/tapo-c520ws.jpg',
    price: 3000, was: 0
  },
  {
    id: 'tenda-cp3', cat: 'wireless', brand: 'Tenda',
    name: 'Tenda CP3 Wi-Fi',
    ar: '٣ ميجابكسل · متحركة · خارجية', en: '3MP · pan-tilt · outdoor',
    img: 'assets/products/tenda-cp3.jpg',
    price: 1000, was: 0
  },
  {
    id: 'tenda-ch9', cat: 'wireless', brand: 'Tenda',
    name: 'Tenda CH9 Wi-Fi Outdoor',
    ar: '٦ ميجابكسل · خارجية', en: '6MP · outdoor',
    price: 1815, was: 0
  },

  /* ---------------- DVR / XVR ---------------- */
  {
    id: 'unv-dvr-4ch-2mp', cat: 'dvr', brand: 'Uniview',
    name: 'Uniview 4-Channel DVR',
    ar: '٤ قنوات · ٢ ميجابكسل', en: '4 channels · 2MP',
    img: 'assets/products/unv-xvr301.jpg',
    price: 1500, was: 0
  },
  {
    id: 'unv-dvr-8ch-2mp', cat: 'dvr', brand: 'Uniview',
    name: 'Uniview 8-Channel DVR',
    ar: '٨ قنوات · ٢ ميجابكسل', en: '8 channels · 2MP',
    img: 'assets/products/unv-xvr301.jpg',
    price: 1780, was: 0
  },
  {
    id: 'unv-dvr-4ch-5mp', cat: 'dvr', brand: 'Uniview',
    name: 'Uniview 4-Channel DVR 5MP',
    ar: '٤ قنوات · ٥ ميجابكسل', en: '4 channels · 5MP',
    img: 'assets/products/unv-xvr302.jpg',
    price: 1780, was: 0
  },
  {
    id: 'unv-dvr-8ch-5mp', cat: 'dvr', brand: 'Uniview',
    name: 'Uniview 8-Channel DVR 5MP',
    ar: '٨ قنوات · ٥ ميجابكسل', en: '8 channels · 5MP',
    img: 'assets/products/unv-xvr302.jpg',
    price: 2315, was: 0
  },
  {
    id: 'unv-dvr-16ch-5mp', cat: 'dvr', brand: 'Uniview',
    name: 'Uniview 16-Channel DVR 5MP',
    ar: '١٦ قناة · ٥ ميجابكسل', en: '16 channels · 5MP',
    img: 'assets/products/unv-xvr302-16.jpg',
    price: 4875, was: 0
  },
  {
    id: 'xvr1b04-i-t', cat: 'dvr', brand: 'Dahua',
    name: 'Dahua DH-XVR1B04-I-T',
    ar: '٤ قنوات · ٢ ميجابكسل · WizSense', en: '4 channels · 2MP · WizSense',
    img: 'assets/products/xvr1b04-i-t.jpg',
    price: 1690, was: 0
  },
  {
    id: 'xvr1b08-i-t', cat: 'dvr', brand: 'Dahua',
    name: 'Dahua DH-XVR1B08-I-T',
    ar: '٨ قنوات · ٢ ميجابكسل · WizSense', en: '8 channels · 2MP · WizSense',
    img: 'assets/products/xvr1b08-i-t.jpg',
    price: 2000, was: 0
  },
  {
    id: 'xvr5104hs-i3', cat: 'dvr', brand: 'Dahua',
    name: 'Dahua DH-XVR5104HS-I3',
    ar: '٤ قنوات · ٥ ميجابكسل · SMD Plus', en: '4 channels · 5MP · SMD Plus',
    img: 'assets/products/xvr5104hs-i3.jpg',
    price: 3440, was: 0
  },
  {
    id: 'xvr5108hs-i3', cat: 'dvr', brand: 'Dahua',
    name: 'Dahua DH-XVR5108HS-I3',
    ar: '٨ قنوات · ٥ ميجابكسل · Penta-brid', en: '8 channels · 5MP · Penta-brid',
    img: 'assets/products/xvr5108hs-i3.jpg',
    price: 4375, was: 0
  },

  /* ---------------- Storage ---------------- */
  {
    id: 'seagate-500gb', cat: 'storage', brand: 'Seagate',
    name: 'Seagate 500GB Surveillance',
    ar: 'هارد ديسك · مخصص للعمل ٢٤/٧', en: 'Hard drive · 24/7 rated',
    img: 'assets/products/seagate-500gb.jpg',
    price: 655, was: 0
  },
  {
    id: 'wd-purple-1tb', cat: 'storage', brand: 'WD',
    name: 'WD Purple 1TB Surveillance',
    ar: 'هارد ديسك · مخصص للعمل ٢٤/٧', en: 'Hard drive · 24/7 rated',
    img: 'assets/products/wd-purple-1tb.jpg',
    price: 3125, was: 0
  },
  {
    id: 'wd-purple-2tb', cat: 'storage', brand: 'WD',
    name: 'WD Purple 2TB Surveillance',
    ar: 'هارد ديسك · مخصص للعمل ٢٤/٧', en: 'Hard drive · 24/7 rated',
    price: 3750, was: 0
  },
  {
    id: 'wd-purple-4tb', cat: 'storage', brand: 'WD',
    name: 'WD Purple 4TB Surveillance',
    ar: 'هارد ديسك · مخصص للعمل ٢٤/٧', en: 'Hard drive · 24/7 rated',
    price: 5625, was: 0
  },
  {
    id: 'skyworth-64gb', cat: 'storage', brand: 'Skyworth',
    name: 'Skyworth 64GB Surveillance',
    ar: 'كارت ذاكرة MicroSD / TF', en: 'MicroSD / TF card',
    img: 'assets/products/skyworth-64gb.jpg',
    price: 565, was: 0
  },
  {
    id: 'skyworth-t128', cat: 'storage', brand: 'Skyworth',
    name: 'Skyworth SKY-T128 128GB',
    ar: 'كارت ذاكرة MicroSD / TF · U1 A1', en: 'MicroSD / TF · U1 A1',
    img: 'assets/products/skyworth-t128.webp',
    price: 875, was: 0
  },
  {
    id: 'evo-64gb', cat: 'storage', brand: 'Samsung EVO',
    name: 'Samsung EVO 64GB',
    ar: 'كارت ذاكرة MicroSD / TF', en: 'MicroSD / TF card',
    price: 500, was: 0
  },
  {
    id: 'evo-128gb', cat: 'storage', brand: 'Samsung EVO',
    name: 'Samsung EVO 128GB',
    ar: 'كارت ذاكرة MicroSD / TF', en: 'MicroSD / TF card',
    price: 750, was: 0
  },

  /* ---------------- Power ---------------- */
  {
    id: 'psu-12v-10a', cat: 'power', brand: 'ElectroTech',
    name: 'Power Supply 12V 10A',
    ar: '١٢ فولت · ١٠ أمبير', en: '12V · 10A',
    img: 'assets/products/psu-12v-10a.jpg',
    price: 220, was: 0
  },
  {
    id: 'psu-12v-20a', cat: 'power', brand: 'Professional Security',
    name: 'Power Supply 12V 20A',
    ar: '١٢ فولت · ٢٠ أمبير', en: '12V · 20A',
    img: 'assets/products/psu-12v-20a.jpg',
    price: 375, was: 0
  },
  /* The sheet prices 20A and 30A identically at 375. Left as written — it is
     the sheet's figure, not a transcription slip on this side. */
  {
    id: 'psu-12v-30a', cat: 'power', brand: 'Professional Security',
    name: 'Power Supply 12V 30A',
    ar: '١٢ فولت · ٣٠ أمبير', en: '12V · 30A',
    price: 375, was: 0
  },
  {
    id: 'psu-12v-40a', cat: 'power', brand: 'Professional Security',
    name: 'Power Supply 12V 40A',
    ar: '١٢ فولت · ٤٠ أمبير', en: '12V · 40A',
    price: 440, was: 0
  },

  /* ---------------- Cable ---------------- */
  {
    id: 'rg59-50m', cat: 'cable', brand: 'RG59',
    name: 'RG59 Coax 50m',
    ar: 'سلك كاميرات · ٥٠ متر', en: 'Camera coax · 50 m roll',
    price: 440, was: 0
  },
  {
    id: 'rg59-200m', cat: 'cable', brand: 'RG59',
    name: 'RG59 Coax 200m',
    ar: 'سلك كاميرات · ٢٠٠ متر', en: 'Camera coax · 200 m roll',
    price: 1625, was: 0
  },
  {
    id: 'rg59-300m', cat: 'cable', brand: 'RG59',
    name: 'RG59 Coax 300m',
    ar: 'سلك كاميرات · ٣٠٠ متر', en: 'Camera coax · 300 m roll',
    price: 2000, was: 0
  },
  {
    id: 'rg60-50m', cat: 'cable', brand: 'RG60',
    name: 'RG60 Coax 50m',
    ar: 'سلك كاميرات · ٥٠ متر', en: 'Camera coax · 50 m roll',
    price: 440, was: 0
  },
  {
    id: 'rg60-100m', cat: 'cable', brand: 'RG60',
    name: 'RG60 Coax 100m',
    ar: 'سلك كاميرات · ١٠٠ متر', en: 'Camera coax · 100 m roll',
    price: 750, was: 0
  },
  {
    id: 'rg60-300m', cat: 'cable', brand: 'RG60',
    name: 'RG60 Coax 300m',
    ar: 'سلك كاميرات · ٣٠٠ متر', en: 'Camera coax · 300 m roll',
    price: 2500, was: 0
  },
  {
    id: 'cat6-305m', cat: 'cable', brand: 'Premium Line',
    name: 'Premium Line Cat6 UTP 305m',
    ar: 'سلك شبكة Cat6 · ٣٠٥ متر · ٢٧ ج.م للمتر', en: 'Cat6 network cable · 305 m box · 27 EGP per metre',
    price: 8125, was: 0
  },

  /* ---------------- Accessories ---------------- */
  {
    id: 'rack-12u', cat: 'accessory', brand: 'APLUS',
    name: 'APLUS 12U Rack',
    ar: 'راك ١٢ يونت', en: '12U wall rack',
    price: 2750, was: 0
  },
  {
    id: 'adaptor-12v-2a', cat: 'accessory', brand: 'Vision Guard',
    name: 'Adaptor 12V 2A',
    ar: 'محول ١٢ فولت · ٢ أمبير · أصلي', en: '12V · 2A · original',
    price: 75, was: 0
  },
  {
    id: 'junction-box', cat: 'accessory', brand: 'Vision Guard',
    name: 'Junction Box 10×10',
    ar: 'علبة توصيلات ١٠×١٠', en: 'Junction box · 10 × 10 cm',
    price: 25, was: 0
  },
  {
    id: 'connector-bnc', cat: 'accessory', brand: 'Vision Guard',
    name: 'BNC Connector',
    ar: 'جاك BNC', en: 'BNC connector',
    price: 10, was: 0
  },
  {
    id: 'connector-dc', cat: 'accessory', brand: 'Vision Guard',
    name: 'DC Connector',
    ar: 'جاك DC', en: 'DC power connector',
    price: 5, was: 0
  }
];

/* A product carries its own shot when there is one. The category picture is
   the fallback for a row still waiting on a photo — showing the right
   category beats showing the logo — and the logo is the last resort. */
const CAT_IMG = CATEGORIES.reduce(function (m, c) { m[c.id] = c.img; return m; }, {});

export function imageFor(product) {
  return product.img || CAT_IMG[product.cat] || 'assets/logo-trim.png';
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
