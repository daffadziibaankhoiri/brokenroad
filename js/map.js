/* BrokenRoad: map.js
 * Leaflet setup, GeoJSON layer styles, tooltips, highlighting and flyTo.
 * Exposes window.BRMap for app.js to use.
 */
(function () {
  const COLOR = {
    Berat: '#DC2626', Sedang: '#EA580C', Ringan: '#CA8A04',      // tingkat kerusakan
    Tinggi: '#DC2626', Rendah: '#CA8A04',                         // kelas prioritas (Sedang shares the color)
    alt: '#2563EB', elemen: '#E2E8F0', fasilitas: '#7C3AED',
  };
  const RADIUS = { Ringan: 6, Sedang: 9, Berat: 12 };
  const EJ_CODE = { 'Simpang': 'S', 'Lampu Lalu Lintas': 'L', 'U-Turn': 'U', 'Bundaran': 'B' };
  const FP_CODE = { 'Pasar': 'P', 'Sekolah': 'Sk', 'Rumah Sakit': 'RS', 'Perkantoran': 'K' };

  // CARTO basemaps (light_all/dark_all) now require an API key and return a watermark tile without one,
  // so light/dark use Esri Canvas, which works without a key.
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/{v}/MapServer/tile/{z}/{y}/{x}';
  const ESRI_ATTR = 'Tiles © Esri · Esri, HERE, Garmin, © OpenStreetMap contributors';
  const BASEMAPS = {
    light: [ESRI.replace('{v}', 'World_Light_Gray_Base'), ESRI_ATTR, 16],
    osm: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© OpenStreetMap contributors', 19],
    dark: [ESRI.replace('{v}', 'World_Dark_Gray_Base'), ESRI_ATTR, 16],
  };

  let map, base, corridorBounds, onSelect;
  let data = {};
  const layers = {};
  const index = { titik: {}, segmen: {}, jalur: {} };
  let selected = null;          // { group, layer }
  let elemenBuffer;

  const segStyle = (f) => ({ color: COLOR[f.properties.kelas_prioritas], weight: 6, opacity: 0.9, lineCap: 'round' });
  const titikStyle = (f) => ({ radius: RADIUS[f.properties.tingkat_kerusakan], color: '#fff', weight: 1.5,
    fillColor: COLOR[f.properties.tingkat_kerusakan], fillOpacity: 0.9 });
  const altStyle = () => ({ color: COLOR.alt, weight: 4, opacity: 0.85, dashArray: '8, 6' });

  function init(selectCb) {
    onSelect = selectCb;
    map = L.map('map', { zoomControl: true, preferCanvas: false }).setView([-3.39, 114.71], 11);
    setBasemap('dark');

    map.createPane('altPane').style.zIndex = 410;     // jalur alternatif below the segments
    map.createPane('segPane').style.zIndex = 420;
    map.createPane('titikPane').style.zIndex = 430;

    layers.segmen = L.geoJSON(null, { pane: 'segPane', style: segStyle, onEachFeature: bindSegmen }).addTo(map);
    layers.titik = L.geoJSON(null, {
      pane: 'titikPane', style: titikStyle,
      pointToLayer: (f, ll) => L.circleMarker(ll, { pane: 'titikPane' }),
      onEachFeature: bindTitik,
    }).addTo(map);
    layers.jalur = L.geoJSON(null, { pane: 'altPane', style: altStyle, onEachFeature: bindJalur });
    layers.elemen = L.layerGroup();
    layers.fasilitas = L.layerGroup();
    elemenBuffer = L.layerGroup();

    addLegend();
    addResetButton();
  }

  function setBasemap(key) {
    if (base) map.removeLayer(base);
    const [url, attribution, maxNativeZoom] = BASEMAPS[key];
    base = L.tileLayer(url, { attribution, maxZoom: 19, maxNativeZoom }).addTo(map);
  }

  // ---------- binding per feature ----------
  function bindTitik(f, layer) {
    const p = f.properties;
    index.titik[p.id_kerusakan] = layer;
    layer.bindTooltip(`<b>${p.id_kerusakan}</b> · ${p.jenis_kerusakan} (${p.tingkat_kerusakan})`, { className: 'tip', direction: 'top' });
    layer.on('click', () => { highlight('titik', layer); onSelect('titik', p); });
  }
  function bindSegmen(f, layer) {
    const p = f.properties;
    index.segmen[p.id_segmen] = layer;
    layer.bindTooltip(`<b>${p.id_segmen}</b> · Prioritas ${p.kelas_prioritas} · skor ${p.skor_saw.toFixed(2).replace(".", ",")}`, { className: 'tip', sticky: true });
    layer.on('click', () => { highlight('segmen', layer); onSelect('segmen', p); });
  }
  function bindJalur(f, layer) {
    const p = f.properties;
    index.jalur[p.id_segmen] = layer;
    layer.bindTooltip(`<b>${p.id_jalur}</b> · +${p.tambahan_jarak_m} m untuk ${p.id_segmen}`, { className: 'tip', sticky: true });
  }

  function iconMarker(f, cls, code) {
    const [lon, lat] = f.geometry.coordinates;
    const size = code.length > 1 ? 22 : 18;
    return L.marker([lat, lon], { icon: L.divIcon({ className: '', html: `<div class="${cls}" style="width:${size}px;height:${size}px">${code}</div>`, iconSize: [size, size] }) });
  }

  // ---------- data ----------
  function setData(d) {
    data = d;
    d.elemen.features.forEach((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      iconMarker(f, 'ej-icon', EJ_CODE[p.jenis] || '•').bindTooltip(`<b>${p.nama}</b><br>${p.jenis} · Km ${p.km}`, { className: 'tip', direction: 'top' }).addTo(layers.elemen);
      L.circle([lat, lon], { radius: 100, color: COLOR.elemen, weight: 1, dashArray: '3, 4', fillOpacity: 0.06, interactive: false }).addTo(elemenBuffer);
    });
    d.fasilitas.features.forEach((f) => {
      const p = f.properties, [lon, lat] = f.geometry.coordinates;
      L.circle([lat, lon], { radius: 200, color: COLOR.fasilitas, weight: 1, fillOpacity: 0.08, interactive: false }).addTo(layers.fasilitas);
      iconMarker(f, 'fp-icon', FP_CODE[p.jenis] || '•').bindTooltip(`<b>${p.nama}</b><br>${p.jenis} · buffer 200 m`, { className: 'tip', direction: 'top' }).addTo(layers.fasilitas);
    });
    layers.jalur.addData(d.jalur);

    const b = L.geoJSON(d.elemen).getBounds().extend(L.geoJSON(d.segmen).getBounds());
    corridorBounds = b.pad(0.03);
    reset();
  }

  // Redraws titik & segmen from the filtered features
  function setFiltered(titikFeatures, segmenFeatures) {
    index.titik = {}; index.segmen = {};
    selected = null;
    layers.titik.clearLayers().addData(titikFeatures);
    layers.segmen.clearLayers().addData(segmenFeatures);
  }

  // ---------- interaction ----------
  function highlight(group, layer) {
    if (selected) {
      const g = layers[selected.group];
      if (g.hasLayer(selected.layer)) g.resetStyle(selected.layer);
    }
    selected = { group, layer };
    if (group === 'segmen') layer.setStyle({ weight: 11, color: '#FFFFFF', opacity: 1 }).bringToFront();
    else layer.setStyle({ color: '#FFFFFF', weight: 3, radius: layer.getRadius() + 3 }).bringToFront();
  }

  function focus(group, id) {
    const layer = index[group][id];
    if (!layer) return false;
    highlight(group, layer);
    if (group === 'titik') map.flyTo(layer.getLatLng(), 17, { duration: 0.8 });
    else map.flyToBounds(layer.getBounds(), { maxZoom: 16, padding: [60, 60], duration: 0.8 });
    return true;
  }

  function toggle(name, on) {
    const l = layers[name];
    if (on) l.addTo(map); else map.removeLayer(l);
    if (name === 'elemen' && !on) map.removeLayer(elemenBuffer);
  }
  function setElemenBuffer(on) {
    if (on && map.hasLayer(layers.elemen)) elemenBuffer.addTo(map); else map.removeLayer(elemenBuffer);
  }

  // Turns on the alternative route layer and highlights the route for a segment
  function showAlt(idSegmen) {
    const layer = index.jalur[idSegmen];
    if (!layer) return null;
    toggle('jalur', true);
    layers.jalur.resetStyle();
    layer.setStyle({ weight: 6, opacity: 1 }).bringToFront();
    map.flyToBounds(layer.getBounds(), { maxZoom: 16, padding: [60, 60], duration: 0.8 });
    return layer.feature.properties;
  }

  function reset() { if (corridorBounds) map.flyToBounds(corridorBounds, { duration: 0.8 }); }

  // ---------- controls ----------
  function addLegend() {
    const c = L.control({ position: 'bottomleft' });
    c.onAdd = () => {
      const el = L.DomUtil.create('div', 'legend');
      const dot = (col, r) => `<i class="c" style="width:${r * 2}px;height:${r * 2}px;background:${col}"></i>`;
      const line = (col) => `<i class="l" style="background:${col}"></i>`;
      el.innerHTML = `
        <h4>Titik Kerusakan</h4>
        <div class="row">${dot(COLOR.Berat, 6)} Berat</div>
        <div class="row">${dot(COLOR.Sedang, 4.5)} Sedang</div>
        <div class="row">${dot(COLOR.Ringan, 3)} Ringan</div>
        <h4>Prioritas Perbaikan</h4>
        <div class="row">${line(COLOR.Tinggi)} Tinggi</div>
        <div class="row">${line(COLOR.Sedang)} Sedang</div>
        <div class="row">${line(COLOR.Rendah)} Rendah</div>
        <div class="row"><i class="d"></i> Jalur Alternatif</div>`;
      L.DomEvent.disableClickPropagation(el);
      return el;
    };
    c.addTo(map);
  }
  function addResetButton() {
    const c = L.control({ position: 'topright' });
    c.onAdd = () => {
      const btn = L.DomUtil.create('button', 'reset-btn');
      btn.type = 'button';
      btn.textContent = '⤢ Reset Tampilan Koridor';
      L.DomEvent.disableClickPropagation(btn);
      btn.addEventListener('click', reset);
      return btn;
    };
    c.addTo(map);
  }

  window.BRMap = { init, setData, setFiltered, focus, toggle, setElemenBuffer, setBasemap, showAlt, reset, COLOR };
})();
