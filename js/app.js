/* BrokenRoad: app.js
 * UI logic: data loading, filters, KPIs, priority list, detail panel, and syncing with the map.
 */
(function () {
  const FILES = {
    titik: 'data/titik_kerusakan.geojson',
    segmen: 'data/prioritas_segmen.geojson',
    elemen: 'data/elemen_jaringan.geojson',
    fasilitas: 'data/fasilitas_publik.geojson',
    jalur: 'data/jalur_alternatif.geojson',
  };
  const PLACEHOLDER = 'assets/placeholder-road.svg';
  const TINGKAT_CLS = { Berat: 'berat', Sedang: 'sedang', Ringan: 'ringan' };
  const KELAS_CLS = { Tinggi: 'berat', Sedang: 'sedang', Rendah: 'ringan' };
  // Faktor penentu prioritas (k1..k5 di GeoJSON), diurutkan dari yang paling berpengaruh
  const CRIT = [['k1', 'Tingkat kerusakan'], ['k3', 'Kemacetan'], ['k2', 'Panjang jalan yang rusak'],
    ['k4', 'Fasilitas umum di sekitar'], ['k5', 'Sulitnya jalan pengalihan']];
  const LEVEL = ['', 'Rendah', 'Sedang', 'Tinggi'];

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  // GeoJSON can come from outside (a QGIS export), so escape it before writing into innerHTML
  const esc = (v) => String(v ?? '–').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (x, d = 2) => Number(x).toFixed(d).replace('.', ',');

  const state = { arah: '', tingkat: '', wilayah: '', q: '' };
  let D, segById = {}, altBySeg = {}, titikBySeg = {}, current = null;

  // ---------- load ----------
  async function load() {
    BRMap.init(showDetail);
    try {
      const entries = await Promise.all(Object.entries(FILES).map(async ([k, url]) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} (${res.status})`);
        return [k, await res.json()];
      }));
      D = Object.fromEntries(entries);
    } catch (err) {
      const box = $('#map-error');
      box.hidden = false;
      box.innerHTML = `<div><h3>Data GeoJSON gagal dimuat</h3><p>${esc(err.message)}</p>
        <p>Browser memblokir <code>fetch()</code> dari <code>file://</code>. Jalankan lewat server lokal, misalnya<br>
        <code>python -m http.server 8000</code> lalu buka <code>http://localhost:8000</code>, atau pakai ekstensi Live Server di VS Code.</p></div>`;
      return;
    }
    D.segmen.features.forEach((f) => { segById[f.properties.id_segmen] = f.properties; });
    D.jalur.features.forEach((f) => { altBySeg[f.properties.id_segmen] = f.properties; });
    D.titik.features.forEach((f) => { (titikBySeg[f.properties.id_segmen] ||= []).push(f.properties); });
    BRMap.setData(D);
    renderHeroMap();
    bindUI();
    apply();
    window.BRAnim?.dataReady();
  }

  // ---------- peta mini di hero (SVG dari data yang sama) ----------
  function renderHeroMap() {
    const svg = $('#hero-map');
    const road = D.elemen.features.slice().sort((a, b) => a.properties.km - b.properties.km).map((f) => f.geometry.coordinates);
    const all = road.concat(...D.segmen.features.map((f) => f.geometry.coordinates));
    const lons = all.map((c) => c[0]), lats = all.map((c) => c[1]);
    const x0 = Math.min(...lons), x1 = Math.max(...lons), y0 = Math.min(...lats), y1 = Math.max(...lats);
    // shortcut: equirectangular projection without a cos(lat) correction; at ~3°S the distortion is <0.2%
    const W = 420, k = W / (x1 - x0), P = 34, H = (y1 - y0) * k;
    const xy = ([lon, lat]) => [((lon - x0) * k + P).toFixed(1), ((y1 - lat) * k + P).toFixed(1)];
    const pts = (cs) => cs.map((c) => xy(c).join(',')).join(' ');
    const [sx, sy] = xy(road[0]), [ex, ey] = xy(road[road.length - 1]);
    const corner = D.elemen.features.find((f) => /Liang Anggang/.test(f.properties.nama));
    const [cx, cy] = corner ? xy(corner.geometry.coordinates) : [0, 0];
    const kmLen = (5000 / 111320) * k; // panjang 5 km dalam satuan SVG
    const segs = D.segmen.features.slice().sort((a, b) => a.properties.skor_saw - b.properties.skor_saw) // prioritas tinggi digambar paling atas
      .map((f) => `<polyline class="seg" data-seg="${esc(f.properties.id_segmen)}" points="${pts(f.geometry.coordinates)}" stroke="${BRMap.COLOR[f.properties.kelas_prioritas]}" stroke-width="7" stroke-linecap="round" fill="none"><title>${esc(f.properties.ruas)} · Prioritas ${esc(f.properties.kelas_prioritas)}</title></polyline>`).join('');
    svg.setAttribute('viewBox', `0 0 ${W + 2 * P} ${(H + 2 * P).toFixed(0)}`);
    svg.innerHTML = `
      <polyline points="${pts(road)}" stroke="#334155" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
      <polyline points="${pts(road)}" stroke="#F1F5F9" stroke-opacity=".35" stroke-width="1.2" stroke-dasharray="5 6" fill="none"/>
      ${segs}
      <g font-family="JetBrains Mono, monospace" font-size="11" fill="#F1F5F9">
        <circle cx="${sx}" cy="${sy}" r="6" fill="#0B1120" stroke="#F1F5F9" stroke-width="2"/>
        <text x="${+sx + 12}" y="${+sy + 4}">Banjarmasin · Km 0</text>
        <circle cx="${ex}" cy="${ey}" r="6" fill="#F59E0B" stroke="#F1F5F9" stroke-width="2"/>
        <text x="${ex}" y="${+ey - 14}" text-anchor="end">Banjarbaru · Km 36</text>
        ${corner ? `<text x="${+cx + 6}" y="${+cy + 24}" fill="#94A3B8" font-size="10">Liang Anggang</text>` : ''}
      </g>
      <g transform="translate(${W + P - 6} ${P + 4})" fill="#94A3B8" font-family="JetBrains Mono, monospace" font-size="10" text-anchor="middle">
        <path d="M0 -14 L6 4 L0 0 L-6 4 Z" fill="#F1F5F9"/><text y="18">U</text>
      </g>
      <g transform="translate(${P} ${(H + 2 * P - 12).toFixed(0)})" font-family="JetBrains Mono, monospace" font-size="10" fill="#94A3B8">
        <path d="M0 0 H${kmLen.toFixed(1)} M0 -4 V4 M${kmLen.toFixed(1)} -4 V4" stroke="#94A3B8" stroke-width="1.5"/>
        <text x="${(kmLen + 6).toFixed(1)}" y="4">5 km</text>
      </g>`;

    // Penanda berdenyut di tengah ruas dengan skor tertinggi + kartu "Paling mendesak"
    const top = D.segmen.features.reduce((a, b) => (b.properties.skor_saw > a.properties.skor_saw ? b : a));
    const tc = top.geometry.coordinates, [mx, my] = xy(tc[Math.floor(tc.length / 2)]);
    svg.insertAdjacentHTML('beforeend', `<g class="pulse" transform="translate(${mx} ${my})" pointer-events="none">
      <circle r="9" fill="none" stroke="${BRMap.COLOR.Tinggi}" stroke-width="2"/><circle r="4" fill="${BRMap.COLOR.Tinggi}"/></g>`);
    const tp = top.properties;
    $('#hero-top').dataset.seg = tp.id_segmen;
    $('#hero-top-ruas').textContent = tp.ruas;
    $('#hero-top-meta').textContent = `${tp.id_segmen} · ${tp.kecamatan}`;
    $('#hero-top-score').textContent = num(tp.skor_saw);
    $('#hero-top').hidden = false;

    // Kartu sebaran: proporsi titik Berat / Sedang / Ringan
    const cnt = { Berat: 0, Sedang: 0, Ringan: 0 };
    D.titik.features.forEach((f) => { if (f.properties.tingkat_kerusakan in cnt) cnt[f.properties.tingkat_kerusakan]++; });
    const total = D.titik.features.length || 1;
    $('#hero-mix-bar').innerHTML = Object.entries(cnt).map(([k, n]) =>
      `<i class="sw--${TINGKAT_CLS[k]}" style="flex:${n}" title="${k}: ${n}"></i>`).join('');
    $('#hero-mix-legend').innerHTML = Object.entries(cnt).map(([k, n]) =>
      `<span><i class="sw sw--${TINGKAT_CLS[k]}"></i>${k} ${Math.round((n / total) * 100)}%</span>`).join('');
    $('#hero-mix').hidden = false;
  }

  // ---------- filter ----------
  function matchTitik(p) {
    if (state.arah && p.arah !== state.arah) return false;
    if (state.tingkat && p.tingkat_kerusakan !== state.tingkat) return false;
    if (state.wilayah && p.kecamatan !== state.wilayah) return false;
    if (state.q) {
      const hay = `${p.ruas} ${p.id_segmen} ${p.id_kerusakan}`.toLowerCase();
      if (!hay.includes(state.q)) return false;
    }
    return true;
  }

  function apply() {
    const titik = D.titik.features.filter((f) => matchTitik(f.properties));
    const ids = new Set(titik.map((f) => f.properties.id_segmen));
    const segmen = D.segmen.features.filter((f) => ids.has(f.properties.id_segmen));
    BRMap.setFiltered(titik, segmen);

    $('#kpi-titik').textContent = titik.length;
    $('#kpi-tinggi').textContent = segmen.filter((f) => f.properties.kelas_prioritas === 'Tinggi').length;
    renderList(segmen.map((f) => f.properties));
  }

  // ---------- list ----------
  function renderList(segs) {
    segs.sort((a, b) => b.skor_saw - a.skor_saw);
    $('#list-count').textContent = segs.length;
    $('#tab-list').innerHTML = segs.length ? segs.map((s, i) => {
      const n = (titikBySeg[s.id_segmen] || []).filter(matchTitik).length;
      const cls = KELAS_CLS[s.kelas_prioritas];
      return `<button class="seg-card" data-seg="${esc(s.id_segmen)}" style="--c:var(--${cls});--cbg:var(--${cls}-bg)">
        <span class="seg-card__rank">${String(i + 1).padStart(2, '0')}</span>
        <span class="seg-card__body">
          <span class="seg-card__id">${esc(s.id_segmen)} · ${s.arah === 'Pergi' ? 'BJM → BJB' : 'BJB → BJM'}</span>
          <span class="seg-card__ruas">${esc(s.ruas)}</span>
          <span class="seg-card__meta">${esc(s.kecamatan)} · ${n} titik · ${esc(s.tingkat_kerusakan)} · ${esc(s.kemacetan)}</span>
          <span class="seg-card__bar"><i style="width:${((s.skor_saw - 1) / 2) * 100}%"></i></span>
        </span>
        <span class="seg-card__score">${num(s.skor_saw)}<small>${esc(s.kelas_prioritas)}</small></span>
      </button>`;
    }).join('') : '<p class="empty">Tidak ada segmen yang cocok dengan filter.</p>';
    markSelected();
    window.BRAnim?.list();
  }

  function markSelected() {
    $$('.seg-card').forEach((c) => c.classList.toggle('selected', !!current && c.dataset.seg === current.id_segmen));
  }

  // ---------- detail ----------
  function showDetail(kind, p) {
    current = p;
    $('#tab-detail').innerHTML = kind === 'titik' ? titikHTML(p) : segmenHTML(p);
    switchTab('detail');
    markSelected();
    window.BRAnim?.detail();
    const img = $('#tab-detail .photo');
    if (img) img.addEventListener('error', () => { img.src = PLACEHOLDER; }, { once: true });
  }

  const badges = (tingkat, kelas) => `<div class="detail-head">
    <span class="badge badge--${TINGKAT_CLS[tingkat]}">Rusak ${esc(tingkat)}</span>
    <span class="badge badge--${KELAS_CLS[kelas]}">Prioritas ${esc(kelas)}</span></div>`;

  const scoreBox = (seg) => `<div class="score-box">
    <div><div class="score-box__lbl">Skor Prioritas</div><div class="score-box__val" style="color:${BRMap.COLOR[seg.kelas_prioritas]}">${num(seg.skor_saw)} <small class="score-box__lbl">/ 3</small></div></div>
    <span class="badge badge--${KELAS_CLS[seg.kelas_prioritas]}">${esc(seg.kelas_prioritas)}</span></div>`;

  function altBlock(idSeg) {
    const a = altBySeg[idSeg];
    return a
      ? `<button class="btn btn--alt" data-alt="${esc(idSeg)}">Tampilkan Jalur Alternatif</button><div id="alt-info"></div>`
      : '<button class="btn" disabled>Tidak ada jalur alternatif</button>';
  }

  const rows = (pairs) => `<table class="attr"><tbody>${pairs.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</tbody></table>`;

  function titikHTML(p) {
    const seg = segById[p.id_segmen];
    const [lon, lat] = D.titik.features.find((f) => f.properties.id_kerusakan === p.id_kerusakan).geometry.coordinates;
    return `
      <img class="photo" src="${esc(p.foto || PLACEHOLDER)}" alt="Foto dokumentasi survei ${esc(p.id_kerusakan)}">
      <p class="photo-cap">${p.foto ? `Dokumentasi survei · ${esc(p.tanggal_survei)}` : 'Foto dokumentasi belum tersedia'}</p>
      ${badges(p.tingkat_kerusakan, p.kelas_prioritas)}
      <h3 class="detail-title">${esc(p.jenis_kerusakan)} · ${esc(p.ruas)}</h3>
      ${rows([
        ['ID Kerusakan', `<span class="mono">${esc(p.id_kerusakan)}</span>`],
        ['ID Segmen', `<button class="btn-link mono" data-goto-seg="${esc(p.id_segmen)}">${esc(p.id_segmen)}</button>`],
        ['Arah Lintasan', `${esc(p.arah)} (${p.arah === 'Pergi' ? 'BJM → BJB' : 'BJB → BJM'})`],
        ['Wilayah', esc(p.kecamatan)],
        ['Jenis Kerusakan', esc(p.jenis_kerusakan)],
        ['Dimensi (p × l × d)', `<span class="mono">${num(p.panjang_m)} m × ${num(p.lebar_m)} m × ${esc(p.kedalaman_cm)} cm</span>`],
        ['Tingkat Kemacetan', esc(p.kemacetan)],
        ['Elemen Jaringan ≤ 100 m', esc(p.elemen_terdekat || 'Tidak ada')],
        ['Fasilitas Publik ≤ 200 m', esc(p.fasilitas_200m || 'Tidak ada')],
        ['Koordinat (lat, lon)', `<span class="mono">${lat.toFixed(6)}, ${lon.toFixed(6)}</span>`],
        ['Tanggal Survei', `<span class="mono">${esc(p.tanggal_survei)}</span>`],
      ])}
      ${scoreBox(seg)}
      ${altBlock(p.id_segmen)}`;
  }

  function segmenHTML(s) {
    const pts = (titikBySeg[s.id_segmen] || []);
    const bars = CRIT.map(([k, label]) =>
      `<span>${label}</span><span class="bar"><i style="width:${(s[k] / 3) * 100}%"></i></span><span>${LEVEL[s[k]]}</span>`).join('');
    return `
      ${badges(s.tingkat_kerusakan, s.kelas_prioritas)}
      <h3 class="detail-title">${esc(s.ruas)}</h3>
      ${scoreBox(s)}
      <p class="panel__title">Kenapa prioritas ini?</p>
      <div class="crit-bars">${bars}</div>
      ${rows([
        ['ID Segmen', `<span class="mono">${esc(s.id_segmen)}</span>`],
        ['Arah Lintasan', `${esc(s.arah)} (${s.arah === 'Pergi' ? 'BJM → BJB' : 'BJB → BJM'})`],
        ['Wilayah', esc(s.kecamatan)],
        ['Kilometer', `<span class="mono">${num(s.km_awal, 1)} – ${num(s.km_akhir, 1)} km</span>`],
        ['Tingkat Kemacetan', esc(s.kemacetan)],
        ['Panjang Rusak', `<span class="mono">${esc(s.panjang_rusak_m)} m (${Math.round(s.proporsi_rusak * 100)}% dari 500 m)</span>`],
        ['Fasilitas ≤ 200 m', `<span class="mono">${esc(s.jumlah_fasilitas_200m)}</span>`],
        ['Tambahan Jarak Alt.', s.tambahan_jarak_m == null ? 'Tidak ada alternatif' : `<span class="mono">+${esc(s.tambahan_jarak_m)} m</span>`],
      ])}
      <p class="panel__title" style="margin-top:14px">Titik Kerusakan (${pts.length})</p>
      <ul class="mini-list">${pts.map((t) => `<li><i class="sw sw--${TINGKAT_CLS[t.tingkat_kerusakan]}"></i>
        <button class="btn-link mono" data-goto-titik="${esc(t.id_kerusakan)}">${esc(t.id_kerusakan)}</button> ${esc(t.jenis_kerusakan)} · ${esc(t.tingkat_kerusakan)}</li>`).join('')}</ul>
      <div style="margin-top:12px">${altBlock(s.id_segmen)}</div>`;
  }

  // Selecting from the list or a link: focus on the map, then open the detail.
  // If the object is hidden by a filter, reset the filters first so it can be shown.
  function select(kind, id) {
    const group = kind === 'titik' ? 'titik' : 'segmen';
    if (!BRMap.focus(group, id)) { resetFilters(); BRMap.focus(group, id); }
    const p = kind === 'titik' ? D.titik.features.find((f) => f.properties.id_kerusakan === id).properties : segById[id];
    showDetail(kind, p);
  }

  function switchTab(name) {
    $$('.tab').forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle('active', on); t.setAttribute('aria-selected', on); });
    $('#tab-list').hidden = name !== 'list';
    $('#tab-detail').hidden = name !== 'detail';
  }

  function resetFilters() {
    Object.assign(state, { arah: '', tingkat: '', wilayah: '', q: '' });
    $$('.filter-group[data-filter] .pill').forEach((b) => b.classList.toggle('active', b.dataset.value === ''));
    $('#f-wilayah').value = '';
    $('#f-search').value = '';
    apply();
  }

  // ---------- events ----------
  function bindUI() {
    $$('.filter-group[data-filter]').forEach((g) => g.addEventListener('click', (e) => {
      const b = e.target.closest('.pill');
      if (!b) return;
      g.querySelectorAll('.pill').forEach((x) => x.classList.toggle('active', x === b));
      state[g.dataset.filter] = b.dataset.value;
      apply();
    }));
    $('#f-wilayah').addEventListener('change', (e) => { state.wilayah = e.target.value; apply(); });
    let t;
    $('#f-search').addEventListener('input', (e) => {
      clearTimeout(t);
      t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase().replace(/(\d)\.(\d)/g, '$1,$2'); apply(); }, 200);
    });

    $$('[data-layer]').forEach((cb) => cb.addEventListener('change', () => {
      BRMap.toggle(cb.dataset.layer, cb.checked);
      if (cb.dataset.layer === 'elemen') BRMap.setElemenBuffer(cb.checked && $('#buffer-elemen').checked);
    }));
    $('#buffer-elemen').addEventListener('change', (e) => {
      if (e.target.checked && !$('[data-layer="elemen"]').checked) {
        $('[data-layer="elemen"]').checked = true;
        BRMap.toggle('elemen', true);
      }
      BRMap.setElemenBuffer(e.target.checked);
    });
    $$('input[name="basemap"]').forEach((r) => r.addEventListener('change', () => BRMap.setBasemap(r.value)));

    $$('.tab').forEach((t) => t.addEventListener('click', () => switchTab(t.dataset.tab)));
    $('#tab-list').addEventListener('click', (e) => {
      const c = e.target.closest('.seg-card');
      if (c) select('segmen', c.dataset.seg);
    });
    // Klik ruas di peta mini hero: gulir ke peta utama lalu buka detail ruas tsb
    $('.hero__stage').addEventListener('click', (e) => {
      const seg = e.target.closest('[data-seg]');
      if (!seg) return;
      $('#peta').scrollIntoView();
      select('segmen', seg.dataset.seg);
    });
    $('#tab-detail').addEventListener('click', (e) => {
      const el = e.target.closest('[data-goto-seg], [data-goto-titik], [data-alt]');
      if (!el) return;
      if (el.dataset.gotoSeg) select('segmen', el.dataset.gotoSeg);
      else if (el.dataset.gotoTitik) select('titik', el.dataset.gotoTitik);
      else {
        const a = BRMap.showAlt(el.dataset.alt);
        $('[data-layer="jalur"]').checked = true;
        $('#alt-info').innerHTML = `<div class="alt-info"><b>${esc(a.id_jalur)}</b> · ${esc(a.nama)}<br>
          Panjang rute <span class="mono">${esc(a.panjang_m)} m</span> · Tambahan jarak <span class="mono">+${esc(a.tambahan_jarak_m)} m</span></div>`;
      }
    });
  }

  document.addEventListener('DOMContentLoaded', load);
})();
