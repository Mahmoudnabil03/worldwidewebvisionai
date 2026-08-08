/* =========================================================================
   Vision Guard — game.js
   The coverage planner.

   Place cameras on a floor plan, see what they would actually cover, and turn
   the result into ONE order containing the whole system — cameras, recorder,
   drive, power supply, cable and connectors.

   Every number the customer sees comes from the real catalogue and from
   game-data.js. Nothing here invents a price or a product: the cameras are
   catalog.js rows filtered to the camera categories, and the order it builds
   goes into the same vg-cart the shop uses, so the checkout, the server-side
   re-pricing and the WhatsApp alert are all the ones that already exist.

   HOW COVERAGE IS COMPUTED
   ------------------------
   By sampling, not by adding up cone areas. The plan is walked on a 0.4m grid
   and each point is asked "can any camera see this?" — which means overlapping
   cameras are counted once rather than twice, and a camera pointed at a wall
   contributes what it really contributes. Summing sector areas is the obvious
   approach and it lies in both directions: it double-counts overlap and it
   credits coverage that is on the far side of a wall.

   Walls block. A camera in the hallway does not see through the flat into the
   bedroom, because every sample is checked against the wall segments in
   game-data.js. That is the difference between a toy and something a customer
   can make a purchase decision on.
   ========================================================================= */
import { $, $$, initChrome, onLang, LANG, t, money, currency, esc, toast } from './site.js?v=31';
import { PRODUCTS as STATIC_PRODUCTS, imageFor } from './catalog.js?v=31';
import { LENS, PROPERTIES, SYSTEM, specFor } from './game-data.js?v=31';

initChrome();

/* Wired cameras record to a DVR; Wi-Fi ones do not. Both are cameras. */
const CAMERA_CATS = ['analog', 'ip', 'wireless'];

let CATALOG = STATIC_PRODUCTS.slice();
const byId = (id) => CATALOG.find((p) => p.id === id);
const cameras = () => CATALOG.filter((p) => CAMERA_CATS.includes(p.cat) && p.active !== 0);

/* =========================================================================
   COPY
   ========================================================================= */
const T = {
  step1:       { ar: 'اختار نوع المكان', en: 'Choose your property' },
  step2:       { ar: 'حط الكاميرات', en: 'Place your cameras' },
  indoor:      { ar: 'داخلي', en: 'Indoor' },
  outdoor:     { ar: 'خارجي', en: 'Outdoor' },
  addCam:      { ar: 'ضيف كاميرا', en: 'Add camera' },
  suggest:     { ar: 'رشّحلي أماكن', en: 'Suggest placement' },
  clear:       { ar: 'امسح الكل', en: 'Clear all' },
  tapPlan:     { ar: 'دوس على الرسمة عشان تحط كاميرا', en: 'Tap the plan to place a camera' },
  noCams:      { ar: 'لسه مافيش كاميرات. دوس على الرسمة أو استخدم «رشّحلي أماكن».', en: 'No cameras yet. Tap the plan, or use “Suggest placement”.' },
  camera:      { ar: 'كاميرا', en: 'Camera' },
  aim:         { ar: 'الاتجاه', en: 'Direction' },
  remove:      { ar: 'شيل', en: 'Remove' },
  coverage:    { ar: 'التغطية', en: 'Coverage' },
  covered:     { ar: 'مساحة مغطاة', en: 'Covered area' },
  ofPlan:      { ar: 'من المساحة', en: 'of the plan' },
  monitored:   { ar: 'الأماكن المغطاة', en: 'Monitored zones' },
  blind:       { ar: 'أماكن مكشوفة', en: 'Not covered' },
  approx:      { ar: 'تقديري — بيحسب الحوائط، بس التركيب الفعلي بيتظبط في المعاينة.', en: 'Approximate — walls are accounted for, but the real install is set at survey.' },
  score:       { ar: 'التقييم', en: 'Score' },
  sysTitle:    { ar: 'النظام الكامل', en: 'The complete system' },
  sysNote:     { ar: 'الكاميرات لوحدها مش نظام. ده كل اللي محتاجه التركيب يشتغل.', en: 'Cameras alone are not a system. This is everything the install needs to work.' },
  total:       { ar: 'الإجمالي', en: 'Total' },
  order:       { ar: 'اطلب النظام ده', en: 'Order this system' },
  print:       { ar: 'اطبع الملخص', en: 'Print summary' },
  qty:         { ar: 'عدد', en: 'Qty' },
  placeFirst:  { ar: 'حط كاميرا واحدة على الأقل الأول.', en: 'Place at least one camera first.' },
  added:       { ar: 'النظام اتحط في السلة — كمّل الطلب.', en: 'System added to your cart — finish the order.' },
  gradeA:      { ar: 'تغطية ممتازة', en: 'Excellent coverage' },
  gradeB:      { ar: 'تغطية كويسة', en: 'Good coverage' },
  gradeC:      { ar: 'تغطية مقبولة', en: 'Basic coverage' },
  gradeD:      { ar: 'لسه فيه فجوات كبيرة', en: 'Big gaps left' },
  lensLabel:   { ar: 'العدسة', en: 'Lens' },
  rangeLabel:  { ar: 'المدى', en: 'Range' },
  fovLabel:    { ar: 'زاوية الرؤية', en: 'Field of view' },
  outdoorOnly: { ar: 'مقاومة للعوامل الجوية', en: 'Weatherproof' },
  wifi:        { ar: 'واي فاي — من غير أسلاك', en: 'Wi-Fi — no cabling' },
  wired:       { ar: 'سلكية — محتاجة DVR', en: 'Wired — needs a recorder' },
  noneOutdoor: { ar: 'مافيش كاميرات خارجية مناسبة في الكتالوج دلوقتي.', en: 'No weatherproof cameras available right now.' }
};

/* =========================================================================
   STATE
   ========================================================================= */
const state = {
  property: null,          // key of PROPERTIES
  mode: 'indoor',          // 'indoor' | 'outdoor'
  cams: [],                // { id, x, y, aim, productId }
  selected: null,
  nextId: 1
};

const plan = () => PROPERTIES[state.property][state.mode];
/* The property is the type; the SCENE is the plan you are currently looking
   at. Geometry always comes from the scene — see the note in game-data.js. */

/* =========================================================================
   GEOMETRY

   Angles are degrees, clockwise from east, matching the SVG coordinate system
   (y grows downward) so nothing has to be flipped at render time.
   ========================================================================= */
const rad = (d) => (d * Math.PI) / 180;

function angleDiff(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

/* Do segments AB and CD cross? Used to ask whether a wall stands between a
   camera and the point it is being asked about. */
function crosses(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/* Distance from a point to a segment — used to let a camera mounted ON a wall
   see past it. Without this, every camera screwed to the outside wall would
   be blinded by the wall it is bolted to. */
function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let tt = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  tt = Math.max(0, Math.min(1, tt));
  const qx = x1 + tt * dx, qy = y1 + tt * dy;
  return Math.hypot(px - qx, py - qy);
}

function blocked(cam, px, py, walls) {
  for (const w of walls) {
    /* A wall the camera is mounted on does not block it. */
    if (distToSeg(cam.x, cam.y, w[0], w[1], w[2], w[3]) < 0.4) continue;
    if (crosses(cam.x, cam.y, px, py, w[0], w[1], w[2], w[3])) return true;
  }
  return false;
}

function sees(cam, px, py, walls) {
  const spec = cam.spec;
  const dx = px - cam.x, dy = py - cam.y;
  const dist = Math.hypot(dx, dy);
  if (dist > spec.range) return false;
  if (dist > 0.001) {
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angleDiff(ang, cam.aim) > spec.fov / 2) return false;
  }
  return !blocked(cam, px, py, walls);
}

/* The whole coverage answer, computed once per change. */
const GRID = 0.4;

function computeCoverage() {
  const p = plan();
  const walls = p.walls;
  const live = state.cams.map((c) => Object.assign({}, c, { spec: specFor(byId(c.productId)) }));

  let total = 0, hit = 0;
  for (let x = GRID / 2; x < p.w; x += GRID) {
    for (let y = GRID / 2; y < p.h; y += GRID) {
      total++;
      for (const c of live) {
        if (sees(c, x, y, walls)) { hit++; break; }
      }
    }
  }

  const zonesCovered = [], zonesBlind = [];
  p.zones.forEach((z) => {
    const seen = live.some((c) => sees(c, z.x, z.y, walls));
    (seen ? zonesCovered : zonesBlind).push(z);
  });

  return {
    pct: total ? Math.round((hit / total) * 100) : 0,
    area: Math.round(hit * GRID * GRID),
    planArea: Math.round(p.w * p.h),
    zonesCovered,
    zonesBlind
  };
}

/* =========================================================================
   THE PLAN, DRAWN

   viewBox is in metres, so every length in game-data.js is literal and a
   camera's range is drawn at exactly the scale of the building.
   ========================================================================= */
function conePath(cam, spec) {
  const r = spec.range;
  /* A 300° PTZ sweep is very nearly a circle; drawing it as one arc keeps the
     path simple and reads correctly. */
  if (spec.fov >= 350) {
    return `M ${cam.x - r} ${cam.y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
  }
  const a1 = rad(cam.aim - spec.fov / 2);
  const a2 = rad(cam.aim + spec.fov / 2);
  const x1 = cam.x + r * Math.cos(a1), y1 = cam.y + r * Math.sin(a1);
  const x2 = cam.x + r * Math.cos(a2), y2 = cam.y + r * Math.sin(a2);
  const large = spec.fov > 180 ? 1 : 0;
  return `M ${cam.x} ${cam.y} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function renderPlan() {
  const svg = $('#planSvg');
  if (!state.property) return;
  const p = plan();
  svg.setAttribute('viewBox', `-0.5 -0.5 ${p.w + 1} ${p.h + 1}`);

  const rooms = p.rooms.map((r) => `
    <rect class="pl-room" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="0.2"/>
    <text class="pl-roomlabel" x="${r.x + r.w / 2}" y="${r.y + r.h / 2}">${esc(t(r))}</text>`).join('');

  const walls = p.walls.map((w) =>
    `<line class="pl-wall" x1="${w[0]}" y1="${w[1]}" x2="${w[2]}" y2="${w[3]}"/>`).join('');

  const cov = state.cams.map((c) => {
    const spec = specFor(byId(c.productId));
    const on = state.selected === c.id;
    return `<path class="pl-cone${on ? ' is-on' : ''}" d="${conePath(c, spec)}"/>`;
  }).join('');

  const zoneDots = p.zones.map((z) => {
    const live = state.cams.map((c) => Object.assign({}, c, { spec: specFor(byId(c.productId)) }));
    const seen = live.some((c) => sees(c, z.x, z.y, p.walls));
    return `<g class="pl-zone${seen ? ' is-seen' : ''}">
      <circle cx="${z.x}" cy="${z.y}" r="0.32"/>
      <text x="${z.x}" y="${z.y - 0.7}">${esc(t(z))}</text>
    </g>`;
  }).join('');

  const cams = state.cams.map((c, i) => {
    const on = state.selected === c.id;
    return `<g class="pl-cam${on ? ' is-on' : ''}" data-cam="${c.id}" transform="translate(${c.x} ${c.y})">
      <circle r="0.75"/>
      <text y="0.28">${i + 1}</text>
    </g>`;
  }).join('');

  svg.innerHTML = rooms + walls + cov + zoneDots + cams;
}

/* =========================================================================
   PANELS
   ========================================================================= */
function renderProperties() {
  $('#propGrid').innerHTML = Object.keys(PROPERTIES).map((k) => {
    const p = PROPERTIES[k];
    const on = state.property === k;
    return `<button class="prop${on ? ' is-on' : ''}" type="button" data-prop="${k}">
      <span class="prop__icon" aria-hidden="true">${p.icon}</span>
      <span class="prop__name">${esc(t(p))}</span>
      <span class="prop__note">${esc(LANG === 'en' ? p.en_note : p.ar_note)}</span>
    </button>`;
  }).join('');
}

function availableCameras() {
  return cameras().filter((p) => {
    const s = specFor(p);
    return state.mode === 'outdoor' ? s.outdoor : true;
  });
}

function renderCamList() {
  const box = $('#camList');
  if (!state.cams.length) {
    box.innerHTML = `<p class="card__note">${esc(t(T.noCams))}</p>`;
    return;
  }
  box.innerHTML = state.cams.map((c, i) => {
    const product = byId(c.productId);
    const spec = specFor(product);
    const opts = availableCameras().map((p) =>
      `<option value="${esc(p.id)}"${p.id === c.productId ? ' selected' : ''}>${esc(p.name)} — ${money(p.price)} ${esc(currency())}</option>`).join('');
    return `<div class="camrow${state.selected === c.id ? ' is-on' : ''}" data-cam="${c.id}">
      <div class="camrow__head">
        <span class="camrow__n">${i + 1}</span>
        <select class="camrow__pick" data-pick="${c.id}" aria-label="${esc(t(T.camera))} ${i + 1}">${opts}</select>
        <button class="camrow__x" type="button" data-del="${c.id}" aria-label="${esc(t(T.remove))}">&times;</button>
      </div>
      <div class="camrow__spec">
        <span>${esc(t(LENS[spec.lens]))}</span>
        <span>${spec.fov}°</span>
        <span>${spec.range} m</span>
        <span class="camrow__tag">${esc(spec.wired ? t(T.wired) : t(T.wifi))}</span>
      </div>
      <label class="camrow__aim">
        <span>${esc(t(T.aim))}</span>
        <input type="range" min="0" max="359" value="${c.aim}" data-aim="${c.id}">
      </label>
    </div>`;
  }).join('');
}

function grade(pct) {
  if (pct >= 80) return t(T.gradeA);
  if (pct >= 60) return t(T.gradeB);
  if (pct >= 35) return t(T.gradeC);
  return t(T.gradeD);
}

function renderSummary(cov) {
  $('#covPct').textContent = cov.pct + '%';
  $('#covBar').style.width = Math.min(100, cov.pct) + '%';
  $('#covBar').className = 'meter__fill' + (cov.pct >= 80 ? ' is-a' : cov.pct >= 60 ? ' is-b' : cov.pct >= 35 ? ' is-c' : '');
  $('#covGrade').textContent = grade(cov.pct);
  $('#covArea').textContent = `${cov.area} / ${cov.planArea} m²`;

  $('#zonesOk').innerHTML = cov.zonesCovered.length
    ? cov.zonesCovered.map((z) => `<li class="zone is-ok">${esc(t(z))}</li>`).join('')
    : `<li class="zone is-none">—</li>`;
  $('#zonesBad').innerHTML = cov.zonesBlind.length
    ? cov.zonesBlind.map((z) => `<li class="zone is-bad">${esc(t(z))}</li>`).join('')
    : `<li class="zone is-none">—</li>`;
}

/* =========================================================================
   THE BILL OF MATERIALS

   The part that makes this one order rather than a list of cameras. Rules
   live in SYSTEM in game-data.js; this only applies them.
   ========================================================================= */
function buildSystem() {
  const lines = [];
  const add = (id, qty, why) => {
    const p = byId(id);
    if (!p || qty <= 0) return;
    const found = lines.find((l) => l.id === id);
    if (found) found.qty += qty;
    else lines.push({ id, qty, name: p.name, price: p.price, why });
  };

  /* 1. The cameras themselves. */
  const counts = {};
  state.cams.forEach((c) => { counts[c.productId] = (counts[c.productId] || 0) + 1; });
  Object.keys(counts).forEach((id) => add(id, counts[id], 'camera'));

  /* 2. Everything the WIRED cameras drag along with them. */
  const wired = state.cams.filter((c) => specFor(byId(c.productId)).wired);
  const n = wired.length;

  if (n) {
    const maxMp = Math.max(...wired.map((c) => specFor(byId(c.productId)).mp));

    const rec = SYSTEM.recorders.find((r) => r.ch >= n && r.maxMp >= maxMp)
             || SYSTEM.recorders.filter((r) => r.ch >= n).pop()
             || SYSTEM.recorders[SYSTEM.recorders.length - 1];
    if (rec) add(rec.id, 1, 'recorder');

    const drive = SYSTEM.drives.find((d) => d.days / n >= SYSTEM.minDays)
               || SYSTEM.drives[SYSTEM.drives.length - 1];
    if (drive) add(drive.id, 1, 'storage');

    const amps = n * SYSTEM.ampsPerCamera;
    const psu = SYSTEM.supplies.find((s) => s.amps >= amps) || SYSTEM.supplies[SYSTEM.supplies.length - 1];
    if (psu) add(psu.id, 1, 'power');

    /* Cable, greedily from the largest roll down — cheaper per metre than
       buying the shortfall in 50m pieces. */
    let need = n * SYSTEM.cablePerCamera;
    SYSTEM.cables.forEach((c) => {
      const whole = Math.floor(need / c.m);
      if (whole > 0) { add(c.id, whole, 'cable'); need -= whole * c.m; }
    });
    if (need > 0) {
      const smallest = SYSTEM.cables[SYSTEM.cables.length - 1];
      add(smallest.id, 1, 'cable');
    }

    SYSTEM.perCamera.forEach((x) => add(x.id, x.qty * n, 'parts'));
  }

  const total = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return { lines, total, wiredCount: n };
}

function renderSystem() {
  const sys = buildSystem();
  const box = $('#sysRows');
  if (!sys.lines.length) {
    box.innerHTML = `<tr><td colspan="3">${esc(t(T.noCams))}</td></tr>`;
    $('#sysTotal').textContent = '—';
    return sys;
  }
  box.innerHTML = sys.lines.map((l) => `
    <tr>
      <td>${esc(l.name)}<div class="att__note" dir="ltr">${esc(l.id)}</div></td>
      <td class="num">${l.qty}</td>
      <td class="num">${money(l.price * l.qty)} ${esc(currency())}</td>
    </tr>`).join('');
  $('#sysTotal').textContent = `${money(sys.total)} ${currency()}`;
  return sys;
}

/* =========================================================================
   REDRAW — one function, called after every change
   ========================================================================= */
/* `keepList` exists for the direction slider.

   renderCamList() replaces the whole list's innerHTML, which destroys and
   recreates the very <input range> being dragged — the element loses focus
   mid-adjustment, so a keyboard user gets exactly one arrow-key press before
   focus is gone, and a mouse drag stops tracking. Nothing in the list depends
   on the aim anyway: the slider already holds the new value. So aim changes
   redraw the plan and the numbers and leave the list alone. */
function redraw(keepList) {
  if (!state.property) return;
  renderPlan();
  if (!keepList) renderCamList();
  const cov = computeCoverage();
  renderSummary(cov);
  renderSystem();
  $('#planner').hidden = false;
  $('#orderBtn').disabled = !state.cams.length;
}

/* =========================================================================
   INTERACTION
   ========================================================================= */
function defaultProduct() {
  const list = availableCameras();
  if (!list.length) return null;
  /* Something mid-priced rather than the cheapest, so the first impression is
     a sensible camera the customer can price down from. */
  const sorted = list.slice().sort((a, b) => a.price - b.price);
  return sorted[Math.floor(sorted.length / 2)].id;
}

/* Which way should a camera dropped HERE face?

   Pointing every new camera the same way is how the planner greets you with a
   camera staring at a wall a metre away and a coverage score of zero — which
   is exactly what a fixed default did on the villa's indoor plan, where the
   centre of the room sits just above a partition. So try twelve directions
   and keep the best one.

   Twelve coarse samples on a 1.2m grid, not the full 0.4m coverage pass: this
   runs once per placement and only has to beat "always 90°", which it does
   comfortably. The user can still turn it afterwards. */
function bestAim(x, y, spec) {
  const p = plan();
  const cam = { x, y, spec };
  let best = 90, bestHits = -1;
  for (let a = 0; a < 360; a += 30) {
    cam.aim = a;
    let hits = 0;
    for (let gx = 0.6; gx < p.w; gx += 1.2) {
      for (let gy = 0.6; gy < p.h; gy += 1.2) {
        if (sees(cam, gx, gy, p.walls)) hits++;
      }
    }
    if (hits > bestHits) { bestHits = hits; best = a; }
  }
  return best;
}

function addCamera(x, y, aim) {
  const pid = defaultProduct();
  if (!pid) { toast(t(T.noneOutdoor), 'bad'); return; }
  const p = plan();
  const cx = Math.max(0.4, Math.min(p.w - 0.4, x));
  const cy = Math.max(0.4, Math.min(p.h - 0.4, y));
  const cam = {
    id: state.nextId++,
    x: cx,
    y: cy,
    aim: aim === undefined ? bestAim(cx, cy, specFor(byId(pid))) : aim,
    productId: pid
  };
  state.cams.push(cam);
  state.selected = cam.id;
  redraw();
}

/* Click-to-place. The SVG viewBox is metres, so the conversion is the ratio
   of the rendered box to the viewBox — no magic numbers. */
$('#planSvg').addEventListener('click', (e) => {
  if (!state.property) return;
  const existing = e.target.closest('.pl-cam');
  if (existing) {
    state.selected = Number(existing.dataset.cam);
    redraw();
    return;
  }
  const svg = $('#planSvg');
  const r = svg.getBoundingClientRect();
  const p = plan();
  const vw = p.w + 1, vh = p.h + 1;
  /* preserveAspectRatio is the default (meet), so the drawing is letterboxed
     inside the box; back that out before converting. */
  const scale = Math.min(r.width / vw, r.height / vh);
  const offX = (r.width - vw * scale) / 2;
  const offY = (r.height - vh * scale) / 2;
  const x = (e.clientX - r.left - offX) / scale - 0.5;
  const y = (e.clientY - r.top - offY) / scale - 0.5;
  if (x < 0 || y < 0 || x > p.w || y > p.h) return;
  addCamera(x, y);
});

$('#propGrid').addEventListener('click', (e) => {
  const b = e.target.closest('[data-prop]');
  if (!b) return;
  state.property = b.dataset.prop;
  state.cams = [];
  state.selected = null;
  renderProperties();
  redraw();
  $('#planner').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$$('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    $$('[data-mode]').forEach((b) => b.classList.toggle('is-on', b === btn));
    /* A camera that is not weatherproof cannot stay outdoors. Swap it for one
       that is, rather than silently leaving it there. */
    if (state.mode === 'outdoor') {
      const ok = availableCameras();
      const fallback = ok.length ? ok[0].id : null;
      state.cams.forEach((c) => {
        if (!specFor(byId(c.productId)).outdoor && fallback) c.productId = fallback;
      });
    }
    /* Plans differ between modes, so pull any camera back inside the new one. */
    const p = plan();
    state.cams.forEach((c) => {
      c.x = Math.max(0.4, Math.min(p.w - 0.4, c.x));
      c.y = Math.max(0.4, Math.min(p.h - 0.4, c.y));
    });
    redraw();
  });
});

$('#camList').addEventListener('change', (e) => {
  const pick = e.target.closest('[data-pick]');
  if (pick) {
    const cam = state.cams.find((c) => c.id === Number(pick.dataset.pick));
    if (cam) { cam.productId = pick.value; state.selected = cam.id; redraw(); }
    return;
  }
  const aim = e.target.closest('[data-aim]');
  if (aim) {
    const cam = state.cams.find((c) => c.id === Number(aim.dataset.aim));
    if (cam) { cam.aim = Number(aim.value); redraw(true); }
  }
});

/* `input` as well as `change`, so dragging the direction slider animates the
   cone instead of jumping when you let go. */
$('#camList').addEventListener('input', (e) => {
  const aim = e.target.closest('[data-aim]');
  if (!aim) return;
  const cam = state.cams.find((c) => c.id === Number(aim.dataset.aim));
  if (!cam) return;
  cam.aim = Number(aim.value);
  state.selected = cam.id;
  /* Same reason as above — keep the list, so the drag is not interrupted. */
  redraw(true);
});

$('#camList').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) {
    state.cams = state.cams.filter((c) => c.id !== Number(del.dataset.del));
    redraw();
    return;
  }
  const row = e.target.closest('[data-cam]');
  if (row) { state.selected = Number(row.dataset.cam); redraw(); }
});

$('#addCam').addEventListener('click', () => {
  /* The next unused mounting point, not the middle of the plan.

     Dropping a camera at the centre put it in mid-air in the middle of a
     room — and on the villa's outdoor plan, the centre is INSIDE the house,
     so the first camera a customer added saw four walls and scored 3%. Real
     cameras go on walls, corners and gateposts, which is exactly what the
     `presets` in game-data.js are. Fall back to the centre only once every
     mounting point is used. */
  const scene = plan();
  const used = (pt) => state.cams.some((c) => Math.hypot(c.x - pt.x, c.y - pt.y) < 1);
  const free = scene.presets.find((pt) => !used(pt));
  if (free) addCamera(free.x, free.y, free.aim);
  else addCamera(scene.w / 2, scene.h / 2);
});

$('#suggest').addEventListener('click', () => {
  const scene = plan();
  state.cams = [];
  state.nextId = 1;
  scene.presets.forEach((pt) => addCamera(pt.x, pt.y, pt.aim));
  redraw();
});

$('#clearCams').addEventListener('click', () => {
  state.cams = [];
  state.selected = null;
  redraw();
});

/* =========================================================================
   ORDER — one cart, one order
   ========================================================================= */
$('#orderBtn').addEventListener('click', () => {
  if (!state.cams.length) { toast(t(T.placeFirst), 'bad'); return; }
  const sys = buildSystem();
  try {
    /* The shop's own cart format: {id, qty} and nothing else. Prices are
       recomputed on the server at checkout, so nothing here can set one. */
    localStorage.setItem('vg-cart', JSON.stringify(sys.lines.map((l) => ({ id: l.id, qty: l.qty }))));
  } catch (e) {
    toast(t({ ar: 'المتصفح مش سامح بالتخزين.', en: 'Your browser blocked storage.' }), 'bad');
    return;
  }
  if (window.vgTrack) {
    window.vgTrack.fire('AddToCart', {
      content_type: 'product',
      content_ids: sys.lines.map((l) => l.id),
      contents: sys.lines.map((l) => ({ id: l.id, quantity: l.qty, item_price: l.price })),
      value: sys.total,
      currency: 'EGP',
      content_name: 'coverage-planner-system'
    });
  }
  toast(t(T.added), 'good');
  setTimeout(() => { location.href = 'shop.html#checkout'; }, 700);
});

$('#printBtn').addEventListener('click', () => window.print());

/* =========================================================================
   BOOT
   ========================================================================= */
onLang(() => {
  renderProperties();
  if (state.property) redraw();
  $$('[data-i18n]').forEach((el) => {
    const k = el.dataset.i18n;
    if (T[k]) el.textContent = t(T[k]);
  });
});

$$('[data-i18n]').forEach((el) => {
  const k = el.dataset.i18n;
  if (T[k]) el.textContent = t(T[k]);
});
renderProperties();

/* Live prices, same as the shop: start from the built-in catalogue so the
   page works immediately, then replace it with the products table. */
(async function () {
  try {
    const res = await fetch('/api/catalog', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.products) || !data.products.length) return;
    CATALOG = data.products;
    if (state.property) redraw();
  } catch (e) { /* built-in prices are last-known-good */ }
})();
