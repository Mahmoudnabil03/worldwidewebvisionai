/* =========================================================================
   Vision Guard — game-data.js
   EVERYTHING THE COVERAGE PLANNER GETS WRONG IS PROBABLY IN THIS FILE.

   This is the tuning file. It holds the optics, the floor plans, the zone
   names and the system-building rules, deliberately separated from
   game.js — which is only maths and rendering and should not need editing to
   correct a number.

   The four things you will want to change, in the order you will want them:

     1. LENS          field of view and range per lens type
     2. CAMERA_SPECS  which lens a given catalogue product has
     3. PROPERTIES    floor plans, walls and the named zones on them
     4. SYSTEM        the rules that turn N cameras into a full order

   Distances are METRES and angles are DEGREES throughout. Floor plans are
   drawn in metres too — the SVG viewBox is the room, so a wall from (0,0) to
   (12,0) is twelve metres long and a camera with a 15m range reaches exactly
   as far across the plan as it would across the building.
   ========================================================================= */

/* -------------------------------------------------------------------------
   1. LENS TYPES

   `fov` is the horizontal angle the camera sees. `range` is the useful
   identification distance — not the absolute maximum the sensor can register
   something, which is always a bigger and less honest number. If you want the
   planner to promise more, raise these; they are what the coverage percentage
   is computed from.
   ------------------------------------------------------------------------- */
export const LENS = {
  fixed:     { id: 'fixed',     fov: 72,  range: 15, ar: 'عدسة ثابتة',      en: 'Fixed lens' },
  wide:      { id: 'wide',      fov: 110, range: 9,  ar: 'زاوية واسعة',      en: 'Wide angle' },
  varifocal: { id: 'varifocal', fov: 90,  range: 22, ar: 'عدسة متغيرة',      en: 'Vari-focal' },
  ptz:       { id: 'ptz',       fov: 300, range: 18, ar: 'دوّارة PTZ',       en: 'PTZ (rotating)' }
};

/* -------------------------------------------------------------------------
   2. CAMERA SPECS, per catalogue product

   Only the exceptions are listed. Everything else is derived from the product
   itself by specFor() below — resolution drives range, the category and the
   product name drive the lens and whether it is weatherproof — so adding a
   new camera to the shop makes it appear here automatically with a sensible
   guess. Override it only when the guess is wrong.

   `outdoor: true` means weather-rated, and it is the ONLY thing that decides
   whether a camera is offered in Outdoor mode. Get it wrong and the planner
   will happily put an indoor camera in the rain.
   ------------------------------------------------------------------------- */
export const CAMERA_SPECS = {
  /* Genuinely rotating heads — these sweep rather than stare. */
  'dahua-ip-pt-3mp':  { lens: 'ptz', outdoor: true },
  'imou-3mp-cruiser': { lens: 'ptz', outdoor: true },
  'tapo-c200':        { lens: 'ptz', outdoor: false },
  'tenda-cp3':        { lens: 'ptz', outdoor: false },
  'skyworth-h30p':    { lens: 'ptz', outdoor: false },

  /* Long, narrow views — the 8MP bullet is the one that actually reaches. */
  'dahua-8mp':        { lens: 'varifocal', outdoor: true, range: 30 },
  'unv-5mp-nv':       { lens: 'varifocal', outdoor: true },
  'dahua-5mp-nv':     { lens: 'varifocal', outdoor: true },

  /* Indoor Wi-Fi that is genuinely indoor-only. */
  'tapo-c70':         { lens: 'wide', outdoor: false },
  'skyworth-h30':     { lens: 'wide', outdoor: false },
  'imou-3mp':         { lens: 'wide', outdoor: false },
  'imou-5mp':         { lens: 'wide', outdoor: false },
  'imou-3mp-color':   { lens: 'wide', outdoor: false },
  'imou-5mp-color':   { lens: 'wide', outdoor: false }
};

/* Resolution -> useful range multiplier. More pixels on the same scene means
   a face is still identifiable further away, which is the whole reason to pay
   for 5MP over 2MP. */
const MP_RANGE = { 2: 1.0, 3: 1.15, 4: 1.25, 5: 1.4, 8: 1.75 };

export function megapixelsOf(product) {
  const m = /(\d+)\s*MP/i.exec(product.name || '');
  return m ? Number(m[1]) : 2;
}

/* The one function that turns a catalogue row into optics. */
export function specFor(product) {
  const override = CAMERA_SPECS[product.id] || {};
  const name = (product.name || '') + ' ' + (product.en || '');

  let lens = override.lens;
  if (!lens) {
    if (/pan[- ]?tilt|cruiser|ptz/i.test(name)) lens = 'ptz';
    else if (product.cat === 'wireless') lens = /outdoor/i.test(name) ? 'fixed' : 'wide';
    else lens = 'fixed';
  }

  let outdoor = override.outdoor;
  if (outdoor === undefined) {
    /* Analog and IP bullets/domes in this catalogue are weather-rated; Wi-Fi
       units are indoor unless the model name says otherwise. */
    outdoor = product.cat === 'wireless' ? /outdoor/i.test(name) : true;
  }

  const base = LENS[lens];
  const mp = megapixelsOf(product);
  const range = override.range !== undefined
    ? override.range
    : Math.round(base.range * (MP_RANGE[mp] || 1) * 10) / 10;

  return {
    lens,
    fov: override.fov !== undefined ? override.fov : base.fov,
    range,
    outdoor,
    mp,
    /* Wi-Fi cameras record to a card and need no recorder, cable or PSU.
       Everything else is wired and drives the rest of the bill of materials. */
    wired: product.cat !== 'wireless'
  };
}

/* -------------------------------------------------------------------------
   3. PROPERTIES

   Every property has TWO SCENES, indoor and outdoor, and each scene is a
   complete, self-contained plan: its own extents, its own walls, its own
   rooms and its own named zones.

   That separation is not tidiness, it is correctness. The first version
   shared one set of walls between both scenes while letting the extents
   differ, and the result was a villa whose 18×12 indoor plan was being
   blocked by the walls of its 26×20 grounds — a camera dropped in the garden
   found itself sealed inside a phantom room, and coverage sat at 4% no matter
   which way it was pointed. A wall list only means anything against the plan
   it was drawn for.

   Each scene:
     w, h     extents in metres — the SVG viewBox, so everything else is literal
     walls    [x1,y1,x2,y2] segments that BLOCK a camera's view
     rooms    cosmetic rectangles with a label, drawn underneath
     zones    the named places the summary reports on; a zone counts as covered
              when its anchor point falls inside some camera's cone, so put the
              anchor where a person would actually stand
     presets  where "Suggest placement" drops cameras, with an aim in degrees
              (0 = east, 90 = south, clockwise — the SVG convention)

   To add a floor plan: copy a scene, keep everything in metres, and make sure
   the walls describe the same rectangle as w and h.
   ------------------------------------------------------------------------- */
export const PROPERTIES = {
  apartment: {
    id: 'apartment',
    ar: 'شقة', en: 'Apartment',
    icon: '🏢',
    ar_note: 'باب، صالة، ممر ودرج',
    en_note: 'Door, living room, hallway and stairs',

    /* Inside the flat. */
    indoor: {
      w: 14, h: 10,
      rooms: [
        { x: 0, y: 0, w: 8, h: 6, ar: 'الصالة', en: 'Living room' },
        { x: 8, y: 0, w: 6, h: 6, ar: 'غرفة نوم', en: 'Bedroom' },
        { x: 0, y: 6, w: 5, h: 4, ar: 'المطبخ', en: 'Kitchen' },
        { x: 5, y: 6, w: 4, h: 4, ar: 'الممر', en: 'Hallway' },
        { x: 9, y: 6, w: 5, h: 4, ar: 'المدخل', en: 'Entrance' }
      ],
      walls: [
        [0,0,14,0],[14,0,14,10],[14,10,0,10],[0,10,0,0],
        [8,0,8,4.5],[0,6,3.5,6],[5,6,5,8.5],[9,6,9,8.5],[5,6,9,6]
      ],
      zones: [
        { id: 'door',    x: 12.8, y: 9.2, ar: 'باب الشقة',  en: 'Apartment door' },
        { id: 'hall',    x: 7,    y: 8,   ar: 'الممر',       en: 'Hallway' },
        { id: 'living',  x: 4,    y: 3,   ar: 'الصالة',      en: 'Living room' },
        { id: 'kitchen', x: 2.5,  y: 8,   ar: 'المطبخ',      en: 'Kitchen' },
        { id: 'bedroom', x: 11,   y: 3,   ar: 'غرفة النوم',  en: 'Bedroom' },
        { id: 'entry',   x: 11.5, y: 7.5, ar: 'المدخل',      en: 'Entrance' }
      ],
      presets: [
        { x: 9.4, y: 9.5, aim: 340 },
        { x: 0.5, y: 0.5, aim: 45 },
        { x: 5.4, y: 6.4, aim: 90 }
      ]
    },

    /* The landing outside it — the door, the stairs, the lift. */
    outdoor: {
      w: 16, h: 11,
      rooms: [
        { x: 0,  y: 0, w: 16, h: 4, ar: 'مواقف العمارة', en: 'Building parking' },
        { x: 1,  y: 6, w: 6,  h: 5, ar: 'المدخل',        en: 'Lobby' },
        { x: 9,  y: 6, w: 6,  h: 5, ar: 'السلم والأسانسير', en: 'Stairs & lift' }
      ],
      walls: [
        [0,0,16,0],[16,0,16,11],[16,11,0,11],[0,11,0,0],
        [1,6,7,6],[7,6,7,11],[9,6,9,11],[9,6,15,6]
      ],
      zones: [
        { id: 'gate',    x: 8,    y: 0.8,  ar: 'مدخل العمارة',  en: 'Building entrance' },
        { id: 'parking', x: 3,    y: 2,    ar: 'المواقف',       en: 'Parking' },
        { id: 'lobby',   x: 4,    y: 8.5,  ar: 'الاستقبال',     en: 'Lobby' },
        { id: 'stairs',  x: 12,   y: 8.5,  ar: 'السلم',         en: 'Stairs' },
        { id: 'lift',    x: 14.5, y: 8.5,  ar: 'الأسانسير',     en: 'Lift' },
        { id: 'flatdoor',x: 8,    y: 10.4, ar: 'باب الشقة',     en: 'Flat door' }
      ],
      presets: [
        { x: 8,   y: 5.2,  aim: 90 },
        { x: 0.6, y: 0.6,  aim: 45 },
        { x: 15.4,y: 6.4,  aim: 135 }
      ]
    }
  },

  villa: {
    id: 'villa',
    ar: 'فيلا', en: 'Villa',
    icon: '🏡',
    ar_note: 'بوابة، جنينة، مدخل وجراج',
    en_note: 'Gate, garden, entrance and garage',

    /* The ground floor. */
    indoor: {
      w: 18, h: 12,
      rooms: [
        { x: 0,  y: 0, w: 10, h: 7,  ar: 'الريسبشن', en: 'Reception' },
        { x: 10, y: 0, w: 8,  h: 7,  ar: 'السفرة',   en: 'Dining' },
        { x: 0,  y: 7, w: 6,  h: 5,  ar: 'المطبخ',   en: 'Kitchen' },
        { x: 6,  y: 7, w: 5,  h: 5,  ar: 'الصالة',   en: 'Hall' },
        { x: 11, y: 7, w: 7,  h: 5,  ar: 'المدخل',   en: 'Entrance' }
      ],
      walls: [
        [0,0,18,0],[18,0,18,12],[18,12,0,12],[0,12,0,0],
        [10,0,10,4.5],[0,7,4,7],[6,7,6,10],[11,7,11,10],[6,7,11,7]
      ],
      zones: [
        { id: 'frontdoor', x: 16,  y: 11.3, ar: 'باب الفيلا',  en: 'Front door' },
        { id: 'hall',      x: 8.5, y: 9.5,  ar: 'الصالة',      en: 'Hall' },
        { id: 'stairs',    x: 13,  y: 8.5,  ar: 'السلم',       en: 'Stairs' },
        { id: 'reception', x: 5,   y: 3.5,  ar: 'الريسبشن',    en: 'Reception' },
        { id: 'kitchen',   x: 3,   y: 9.5,  ar: 'المطبخ',      en: 'Kitchen' },
        { id: 'dining',    x: 14,  y: 3.5,  ar: 'السفرة',      en: 'Dining' }
      ],
      presets: [
        { x: 11.4, y: 11.4, aim: 200 },
        { x: 0.5,  y: 0.5,  aim: 45 },
        { x: 6.4,  y: 7.4,  aim: 60 }
      ]
    },

    /* The grounds — gate, drive, garden, perimeter. */
    outdoor: {
      w: 26, h: 20,
      rooms: [
        { x: 7, y: 6, w: 12, h: 9, ar: 'المبنى',        en: 'House' },
        { x: 2, y: 1, w: 22, h: 4, ar: 'الجنينة الأمامية', en: 'Front garden' }
      ],
      walls: [
        [0,0,26,0],[26,0,26,20],[26,20,0,20],[0,20,0,0],
        [7,6,19,6],[19,6,19,15],[19,15,7,15],[7,15,7,6]
      ],
      zones: [
        { id: 'gate',     x: 13,  y: 1.2,  ar: 'البوابة',       en: 'Main gate' },
        { id: 'drive',    x: 13,  y: 4,    ar: 'المدخل',        en: 'Driveway' },
        { id: 'frontdoor',x: 13,  y: 5.4,  ar: 'باب الفيلا',    en: 'Front door' },
        { id: 'garage',   x: 3,   y: 8,    ar: 'الجراج',        en: 'Garage' },
        { id: 'garden',   x: 22.5,y: 10,   ar: 'الجنينة',       en: 'Garden' },
        { id: 'backgate', x: 13,  y: 18.8, ar: 'الباب الخلفي',  en: 'Back gate' },
        { id: 'sideA',    x: 3,   y: 17,   ar: 'الجنب الشمال',  en: 'Left side' },
        { id: 'sideB',    x: 23,  y: 17,   ar: 'الجنب اليمين',  en: 'Right side' }
      ],
      presets: [
        { x: 13,   y: 3,    aim: 270 },
        { x: 0.6,  y: 0.6,  aim: 45 },
        { x: 25.4, y: 0.6,  aim: 135 },
        { x: 13,   y: 17.5, aim: 90 }
      ]
    }
  },

  company: {
    id: 'company',
    ar: 'شركة', en: 'Company',
    icon: '🏬',
    ar_note: 'استقبال، مكاتب، ممرات وجراج',
    en_note: 'Reception, offices, corridors and parking',

    indoor: {
      w: 24, h: 16,
      rooms: [
        { x: 0,  y: 0,  w: 9,  h: 7,  ar: 'الاستقبال', en: 'Reception' },
        { x: 9,  y: 0,  w: 15, h: 7,  ar: 'المكاتب',   en: 'Open office' },
        { x: 0,  y: 9,  w: 10, h: 7,  ar: 'اجتماعات',  en: 'Meeting room' },
        { x: 10, y: 9,  w: 14, h: 7,  ar: 'المخزن',    en: 'Store room' }
      ],
      walls: [
        [0,0,24,0],[24,0,24,16],[24,16,0,16],[0,16,0,0],
        [9,0,9,5],[0,7,10,7],[13,7,24,7],[10,9,10,16],[0,9,7,9],[10,9,24,9]
      ],
      zones: [
        { id: 'entrance', x: 4.5,  y: 0.9,  ar: 'المدخل',        en: 'Main entrance' },
        { id: 'reception',x: 4.5,  y: 4,    ar: 'الاستقبال',     en: 'Reception desk' },
        { id: 'office',   x: 16,   y: 3.5,  ar: 'المكاتب',       en: 'Open office' },
        { id: 'corridor', x: 11.5, y: 8,    ar: 'الممر',         en: 'Corridor' },
        { id: 'meeting',  x: 5,    y: 12.5, ar: 'غرفة اجتماعات', en: 'Meeting room' },
        { id: 'store',    x: 17,   y: 12.5, ar: 'المخزن',        en: 'Store room' },
        { id: 'backdoor', x: 23,   y: 15.2, ar: 'الباب الخلفي',  en: 'Back door' }
      ],
      presets: [
        { x: 4.5,  y: 1.2,  aim: 270 },
        { x: 23.4, y: 0.6,  aim: 200 },
        { x: 11.5, y: 8,    aim: 180 },
        { x: 23.4, y: 15.4, aim: 160 }
      ]
    },

    /* The yard — where the cars, the deliveries and the back door are. */
    outdoor: {
      w: 28, h: 18,
      rooms: [
        { x: 8,  y: 9, w: 20, h: 9, ar: 'المبنى',   en: 'Building' },
        { x: 0,  y: 2, w: 26, h: 5, ar: 'الجراج',   en: 'Parking' }
      ],
      walls: [
        [0,0,28,0],[28,0,28,18],[28,18,0,18],[0,18,0,0],
        [8,9,28,9]
      ],
      zones: [
        { id: 'gate',     x: 14,  y: 0.8,  ar: 'بوابة الدخول',  en: 'Vehicle gate' },
        { id: 'parking',  x: 6,   y: 4.5,  ar: 'المواقف',       en: 'Parking' },
        { id: 'entrance', x: 18,  y: 8.2,  ar: 'المدخل الرئيسي',en: 'Main entrance' },
        { id: 'loading',  x: 3,   y: 12,   ar: 'منطقة التحميل', en: 'Loading bay' },
        { id: 'backdoor', x: 26,  y: 8.2,  ar: 'الباب الخلفي',  en: 'Back door' },
        { id: 'fence',    x: 27,  y: 2,    ar: 'السور',         en: 'Perimeter fence' }
      ],
      presets: [
        { x: 14,   y: 1.6,  aim: 90 },
        { x: 0.6,  y: 0.6,  aim: 45 },
        { x: 27.4, y: 0.6,  aim: 135 },
        { x: 18,   y: 9.4,  aim: 270 }
      ]
    }
  },

  compound: {
    id: 'compound',
    ar: 'كمبوند', en: 'Compound',
    icon: '🏘️',
    ar_note: 'سور، بوابات، شوارع داخلية',
    en_note: 'Perimeter, gates and internal roads',

    /* A compound's indoor scene is the block lobby, not the site. */
    indoor: {
      w: 20, h: 12,
      rooms: [
        { x: 0,  y: 0, w: 20, h: 5, ar: 'مدخل المبنى', en: 'Block lobby' },
        { x: 0,  y: 7, w: 9,  h: 5, ar: 'السلم',       en: 'Stairs' },
        { x: 11, y: 7, w: 9,  h: 5, ar: 'الجراج',      en: 'Basement' }
      ],
      walls: [
        [0,0,20,0],[20,0,20,12],[20,12,0,12],[0,12,0,0],
        [0,5,7,5],[13,5,20,5],[9,7,9,12],[11,7,11,12]
      ],
      zones: [
        { id: 'lobby',   x: 10,  y: 2.5,  ar: 'الاستقبال',    en: 'Lobby' },
        { id: 'door',    x: 10,  y: 0.8,  ar: 'باب المبنى',   en: 'Block door' },
        { id: 'stairs',  x: 4.5, y: 9.5,  ar: 'السلم',        en: 'Stairs' },
        { id: 'lift',    x: 10,  y: 6,    ar: 'الأسانسير',    en: 'Lift' },
        { id: 'basement',x: 15.5,y: 9.5,  ar: 'الجراج',       en: 'Basement' }
      ],
      presets: [
        { x: 10,   y: 4.6,  aim: 90 },
        { x: 0.6,  y: 0.6,  aim: 45 },
        { x: 19.4, y: 11.4, aim: 225 }
      ]
    },

    /* The site. */
    outdoor: {
      w: 40, h: 30,
      rooms: [
        { x: 5,  y: 6,  w: 12, h: 9, ar: 'مبنى أ', en: 'Block A' },
        { x: 23, y: 6,  w: 12, h: 9, ar: 'مبنى ب', en: 'Block B' },
        { x: 5,  y: 19, w: 12, h: 8, ar: 'مبنى ج', en: 'Block C' },
        { x: 23, y: 19, w: 12, h: 8, ar: 'مبنى د', en: 'Block D' }
      ],
      walls: [
        [0,0,40,0],[40,0,40,30],[40,30,0,30],[0,30,0,0],
        [5,6,17,6],[17,6,17,15],[17,15,5,15],[5,15,5,6],
        [23,6,35,6],[35,6,35,15],[35,15,23,15],[23,15,23,6],
        [5,19,17,19],[17,19,17,27],[17,27,5,27],[5,27,5,19],
        [23,19,35,19],[35,19,35,27],[35,27,23,27],[23,27,23,19]
      ],
      zones: [
        { id: 'maingate', x: 20,   y: 1,    ar: 'البوابة الرئيسية', en: 'Main gate' },
        { id: 'exitgate', x: 20,   y: 29,   ar: 'بوابة الخروج',     en: 'Exit gate' },
        { id: 'road',     x: 20,   y: 17,   ar: 'الشارع الداخلي',   en: 'Internal road' },
        { id: 'parking',  x: 20,   y: 10,   ar: 'الجراج',           en: 'Parking' },
        { id: 'perimN',   x: 2,    y: 2,    ar: 'السور الشمالي',    en: 'North perimeter' },
        { id: 'perimS',   x: 38,   y: 28,   ar: 'السور الجنوبي',    en: 'South perimeter' },
        { id: 'perimE',   x: 38,   y: 2,    ar: 'السور الشرقي',     en: 'East perimeter' },
        { id: 'perimW',   x: 2,    y: 28,   ar: 'السور الغربي',     en: 'West perimeter' },
        { id: 'blockA',   x: 11,   y: 16.5, ar: 'مدخل مبنى أ',      en: 'Block A entrance' },
        { id: 'blockB',   x: 29,   y: 16.5, ar: 'مدخل مبنى ب',      en: 'Block B entrance' }
      ],
      presets: [
        { x: 20,   y: 2,    aim: 90 },
        { x: 0.6,  y: 0.6,  aim: 45 },
        { x: 39.4, y: 0.6,  aim: 135 },
        { x: 0.6,  y: 29.4, aim: 315 },
        { x: 39.4, y: 29.4, aim: 225 }
      ]
    }
  }
};

/* -------------------------------------------------------------------------
   4. SYSTEM RULES

   What a pile of cameras needs to become a working installation. This is what
   turns the planner into one order the workshop can actually fulfil, instead
   of a list of cameras that arrives without a recorder.

   Only WIRED cameras (analog and IP) drive any of this. Wi-Fi cameras record
   to their own card and are sold on their own.
   ------------------------------------------------------------------------- */
export const SYSTEM = {
  /* Metres of coax per wired camera, before rounding up to whole rolls. A run
     is never the straight-line distance — it goes up walls and around them. */
  cablePerCamera: 25,

  /* One 12V line per wired camera. Amps each, so the planner can pick a
     supply that is not running at its limit. */
  ampsPerCamera: 1,

  /* Recorders, smallest first. `ch` is channels; the planner picks the first
     that fits and prefers one matching the highest camera resolution. */
  recorders: [
    { id: 'unv-dvr-4ch-2mp',  ch: 4,  maxMp: 2 },
    { id: 'xvr1b04-i-t',      ch: 4,  maxMp: 5 },
    { id: 'unv-dvr-4ch-5mp',  ch: 4,  maxMp: 5 },
    { id: 'unv-dvr-8ch-2mp',  ch: 8,  maxMp: 2 },
    { id: 'xvr1b08-i-t',      ch: 8,  maxMp: 5 },
    { id: 'unv-dvr-8ch-5mp',  ch: 8,  maxMp: 5 },
    { id: 'xvr5108hs-i3',     ch: 8,  maxMp: 8 },
    { id: 'unv-dvr-16ch-5mp', ch: 16, maxMp: 5 }
  ],

  /* Storage, smallest first. `days` is roughly how long that drive holds
     continuous recording for ONE camera at 2MP; the planner divides by the
     camera count and picks the first drive that still clears `minDays`. */
  drives: [
    { id: 'seagate-500gb',  days: 60 },
    { id: 'wd-purple-1tb',  days: 120 },
    { id: 'wd-purple-2tb',  days: 240 },
    { id: 'wd-purple-4tb',  days: 480 }
  ],
  minDays: 14,

  /* Power supplies, smallest first, with the amps each can carry. */
  supplies: [
    { id: 'psu-12v-10a', amps: 10 },
    { id: 'psu-12v-20a', amps: 20 },
    { id: 'psu-12v-30a', amps: 30 },
    { id: 'psu-12v-40a', amps: 40 }
  ],

  /* Coax rolls, longest first so the planner uses whole big rolls before
     topping up with small ones. */
  cables: [
    { id: 'rg59-300m', m: 300 },
    { id: 'rg59-200m', m: 200 },
    { id: 'rg59-50m',  m: 50 }
  ],

  /* Per wired camera. Two BNC ends and a DC end per run, plus a box. */
  perCamera: [
    { id: 'connector-bnc', qty: 2 },
    { id: 'connector-dc',  qty: 1 },
    { id: 'junction-box',  qty: 1 }
  ]
};
