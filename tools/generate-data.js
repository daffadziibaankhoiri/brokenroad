// Generator data sampel BrokenRoad (dummy, deterministik). Jalankan: node tools/generate-data.js
// Menghasilkan 5 GeoJSON di data/ dengan atribut setara hasil analisis QGIS (buffer, SAW).
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Seeded PRNG agar data stabil setiap generate
let seed = 20260502;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (a, b) => a + rnd() * (b - a);
const r2 = (x) => Math.round(x * 100) / 100;

// Garis tengah Jl. A. Yani dari OpenStreetMap (way "Jalan Jenderal Achmad Yani", dirata-rata per 250 m) [lat, lon]
const WAYPOINTS = require('./centerline-osm.json');
const KM_TOTAL = 36; // patok km nominal; panjang geometri OSM ±33,6 km, diskalakan ke 0–36

const CUM = [0];
for (let i = 1; i < WAYPOINTS.length; i++) CUM.push(CUM[i - 1] + Math.hypot(WAYPOINTS[i][0] - WAYPOINTS[i - 1][0], WAYPOINTS[i][1] - WAYPOINTS[i - 1][1]));

// Posisi pada garis tengah untuk km tertentu (interpolasi linear menurut panjang kumulatif)
function atKm(km) {
  const s = (Math.min(Math.max(km, 0), KM_TOTAL) / KM_TOTAL) * CUM[CUM.length - 1];
  let i = CUM.findIndex((c) => c >= s) - 1;
  i = Math.min(Math.max(i, 0), WAYPOINTS.length - 2);
  const t = (s - CUM[i]) / (CUM[i + 1] - CUM[i] || 1);
  const [a, b] = [WAYPOINTS[i], WAYPOINTS[i + 1]];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
// Km nominal dari titik waypoint terdekat (untuk objek yang posisinya diambil dari OSM)
function kmOf([lat, lon]) {
  let best = 0;
  WAYPOINTS.forEach((w, i) => { if (Math.hypot(w[0] - lat, w[1] - lon) < Math.hypot(WAYPOINTS[best][0] - lat, WAYPOINTS[best][1] - lon)) best = i; });
  return Math.round((CUM[best] / CUM[CUM.length - 1]) * KM_TOTAL * 10) / 10;
}
// Vektor normal (kiri arah BJM→BJB) satuan derajat
function normalAt(km) {
  const p = atKm(Math.max(km - 0.2, 0)), q = atKm(Math.min(km + 0.2, KM_TOTAL));
  const dx = q[1] - p[1], dy = q[0] - p[0], len = Math.hypot(dx, dy);
  return [dx / len, -dy / len]; // [dLat, dLon] tegak lurus
}
// Offset lajur: Pergi di sisi kiri (lalu lintas lajur kiri), Pulang di sisi kanan
function offsetPt(km, meters) {
  const [lat, lon] = atKm(km), [nLat, nLon] = normalAt(km), d = meters / 111320;
  return [lat + nLat * d, lon + nLon * d];
}
const LANE = { Pergi: 9, Pulang: -9 };
const toXY = ([lat, lon]) => [+lon.toFixed(6), +lat.toFixed(6)];

function haversine([lat1, lon1], [lat2, lon2]) {
  const R = 6371000, rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const lineLength = (pts) => pts.slice(1).reduce((s, p, i) => s + haversine(pts[i], p), 0);

function kecamatanAt(km) {
  if (km < 2) return 'Banjarmasin Tengah';
  if (km < 6) return 'Banjarmasin Selatan';
  if (km < 11) return 'Kertak Hanyar';
  if (km < 19.5) return 'Gambut'; // Liang Anggang (Banjarbaru) dimulai di bundarannya
  return 'Banjarbaru';
}

// ---------- Elemen jaringan (di garis tengah) ----------
const ELEMEN = [
  ['Simpang Jl. Pangeran Antasari', 'Simpang', 0.3], ['APILL Simpang Km 2', 'Lampu Lalu Lintas', 2.1],
  ['U-Turn Km 3,5', 'U-Turn', 3.5], ['APILL Simpang Km 4,5', 'Lampu Lalu Lintas', 4.5],
  ['Simpang Jl. Gubernur Syarkawi', 'Simpang', 6.8], ['U-Turn Km 8', 'U-Turn', 8.1],
  ['APILL Simpang Kertak Hanyar', 'Lampu Lalu Lintas', 9.7], ['U-Turn Km 12', 'U-Turn', 12.2],
  ['APILL Simpang Empat Gambut', 'Lampu Lalu Lintas', 14.0], ['Bundaran Kilometer 17', 'Bundaran', kmOf([-3.4260, 114.6845])],
  ['Bundaran Liang Anggang', 'Bundaran', kmOf([-3.4445, 114.7000])], ['APILL Simpang Bandara', 'Lampu Lalu Lintas', 25.3],
  ['U-Turn Km 27', 'U-Turn', 27.4], ['Simpang Landasan Ulin', 'Simpang', 29.8],
  ['APILL Simpang Km 33', 'Lampu Lalu Lintas', 33.0], ['Bundaran Simpang Empat Banjarbaru', 'Bundaran', 36.0],
];
const elemen = ELEMEN.map(([nama, jenis, km], i) => ({
  id: `EJ-${String(i + 1).padStart(2, '0')}`, nama, jenis, km, ll: atKm(km),
}));

// ---------- Fasilitas publik (±60–150 m dari jalan) ----------
const FASILITAS = [
  ['RSUD Ulin Banjarmasin', 'Rumah Sakit', 1.8, 1], ['Pusat Perbelanjaan Km 2', 'Pasar', 2.4, -1],
  ['RS Bhayangkara Banjarmasin', 'Rumah Sakit', 3.6, 1], ['SMA Negeri Km 5', 'Sekolah', 5.2, -1],
  ['Kantor Kecamatan Kertak Hanyar', 'Perkantoran', 8.5, 1], ['Pasar Kertak Hanyar', 'Pasar', 9.9, -1],
  ['SMP Negeri 1 Kertak Hanyar', 'Sekolah', 10.6, 1], ['Pasar Gambut', 'Pasar', 14.2, -1],
  ['Puskesmas Gambut', 'Rumah Sakit', 14.6, 1], ['SMA Negeri 1 Gambut', 'Sekolah', 15.8, -1],
  ['Kantor Kecamatan Gambut', 'Perkantoran', 16.4, 1], ['SD Negeri Liang Anggang', 'Sekolah', 22.0, -1],
  ['Kantor Bandara Syamsudin Noor', 'Perkantoran', 25.6, 1], ['Pasar Landasan Ulin', 'Pasar', 29.5, -1],
  ['SMK Negeri Banjarbaru', 'Sekolah', 32.4, 1], ['Kantor Pemerintahan Banjarbaru', 'Perkantoran', 34.6, -1],
  ['Universitas Lambung Mangkurat Banjarbaru', 'Sekolah', 35.6, 1],
];
const fasilitas = FASILITAS.map(([nama, jenis, km, side], i) => ({
  id: `FP-${String(i + 1).padStart(2, '0')}`, nama, jenis, km, ll: offsetPt(km, side * between(60, 150)),
}));

// ---------- Segmen ±500 m & titik kerusakan ----------
const TINGKAT = [['Ringan', 1], ['Sedang', 2], ['Berat', 3]];
const JENIS = ['Lubang', 'Retak', 'Amblas', 'Bergelombang', 'Tambalan Rusak'];
const MACET = [['Lancar', 1], ['Padat', 2], ['Macet', 3]];
const W = { K1: 0.35, K2: 0.15, K3: 0.20, K4: 0.15, K5: 0.15 };
assert(Math.abs(Object.values(W).reduce((a, b) => a + b) - 1) < 1e-9, 'Bobot SAW harus berjumlah 1');

function dimensi(tingkat) {
  const s = { Ringan: [0.3, 1.2, 1, 3], Sedang: [0.8, 2.5, 3, 6], Berat: [1.5, 5, 6, 15] }[tingkat];
  return { panjang_m: r2(between(s[0], s[1])), lebar_m: r2(between(s[0] * 0.6, s[1] * 0.8)), kedalaman_cm: Math.round(between(s[2], s[3])) };
}
const kelas = (S) => (S >= 2.3 ? 'Tinggi' : S >= 1.7 ? 'Sedang' : 'Rendah');

const segmen = [], titik = [], jalur = [];
let nTitik = 0, nAlt = 0;
for (const arah of ['Pergi', 'Pulang']) {
  for (let i = 0; i < KM_TOTAL * 2; i++) {
    if (rnd() > 0.42) continue; // hanya segmen dengan temuan kerusakan yang diekspor
    const kmA = i * 0.5, kmB = kmA + 0.5, kmMid = kmA + 0.25;
    const no = arah === 'Pergi' ? i + 1 : KM_TOTAL * 2 - i; // pulang dihitung dari Banjarbaru
    const id_segmen = `SEG-${arah === 'Pergi' ? 'PG' : 'PL'}-${String(no).padStart(3, '0')}`;
    const kecamatan = kecamatanAt(kmMid);
    const urban = kmMid < 11 || kmMid > 30;
    const [kemacetan, k3] = urban ? pick([MACET[1], MACET[2], MACET[2], MACET[0]]) : pick([MACET[0], MACET[0], MACET[1], MACET[2]]);

    // titik kerusakan dalam segmen
    const n = 1 + Math.floor(rnd() * 4);
    const pts = [];
    for (let k = 0; k < n; k++) {
      const km = between(kmA + 0.02, kmB - 0.02);
      const [tingkat] = pick([TINGKAT[0], TINGKAT[0], TINGKAT[1], TINGKAT[1], TINGKAT[2]]);
      const ll = offsetPt(km, LANE[arah] + between(-3, 3));
      pts.push({ km, tingkat, ll, jenis: pick(JENIS), ...dimensi(tingkat) });
    }
    const k1 = Math.max(...pts.map((p) => TINGKAT.find((t) => t[0] === p.tingkat)[1]));
    const panjang_rusak_m = Math.round(between(15, 60) * n);
    const proporsi = panjang_rusak_m / 500;
    const k2 = proporsi < 0.1 ? 1 : proporsi < 0.25 ? 2 : 3;

    const mid = offsetPt(kmMid, LANE[arah]);
    const fasDekat = fasilitas.filter((f) => haversine(mid, f.ll) <= 450); // dari tengah segmen (250 m) + 200 m
    const k4 = fasDekat.length === 0 ? 1 : fasDekat.length === 1 ? 2 : 3;

    // jalur alternatif: hanya bila ada jalan lingkungan (acak) & kerusakan ≥ sedang
    let tambahan_jarak_m = null, k5 = 3;
    if (k1 >= 2 && rnd() < 0.5) {
      const side = arah === 'Pergi' ? 1 : -1, off = between(250, 700);
      const a = Math.max(kmA - 0.3, 0), b = Math.min(kmB + 0.3, KM_TOTAL);
      const detour = [offsetPt(a, LANE[arah]), offsetPt(a + 0.05, side * off), offsetPt((a + b) / 2, side * (off + 60)),
        offsetPt(b - 0.05, side * off), offsetPt(b, LANE[arah])];
      if (arah === 'Pulang') detour.reverse();
      const direct = lineLength([offsetPt(a, LANE[arah]), offsetPt(b, LANE[arah])]);
      tambahan_jarak_m = Math.round(lineLength(detour) - direct);
      k5 = tambahan_jarak_m < 1000 ? 1 : tambahan_jarak_m < 3000 ? 2 : 3;
      nAlt++;
      jalur.push({
        type: 'Feature',
        properties: { id_jalur: `ALT-${String(nAlt).padStart(2, '0')}`, id_segmen, arah,
          nama: `Pengalihan via jalan lingkungan Km ${kmA.toFixed(1).replace('.', ',')}`,
          panjang_m: Math.round(lineLength(detour)), tambahan_jarak_m },
        geometry: { type: 'LineString', coordinates: detour.map(toXY) },
      });
    }
    // Tanpa alternatif = dampak penutupan maksimal (K5 = 3)

    const S = r2(W.K1 * k1 + W.K2 * k2 + W.K3 * k3 + W.K4 * k4 + W.K5 * k5);
    assert(S >= 1 && S <= 3, `Skor di luar rentang: ${S}`);
    const tingkatSeg = TINGKAT[k1 - 1][0];
    const ruas = `Jl. A. Yani Km ${kmA.toFixed(1).replace('.', ',')}–${kmB.toFixed(1).replace('.', ',')}`;

    const line = [offsetPt(kmA, LANE[arah]), offsetPt(kmMid, LANE[arah]), offsetPt(kmB, LANE[arah])];
    if (arah === 'Pulang') line.reverse();
    segmen.push({
      type: 'Feature',
      properties: { id_segmen, ruas, arah, kecamatan, km_awal: kmA, km_akhir: kmB, panjang_m: 500,
        jumlah_titik: n, tingkat_kerusakan: tingkatSeg, kemacetan, panjang_rusak_m,
        proporsi_rusak: r2(proporsi), jumlah_fasilitas_200m: fasDekat.length, tambahan_jarak_m,
        k1, k2, k3, k4, k5, skor_saw: S, kelas_prioritas: kelas(S) },
      geometry: { type: 'LineString', coordinates: line.map(toXY) },
    });

    for (const p of pts) {
      nTitik++;
      const ej = elemen.map((e) => ({ e, d: haversine(p.ll, e.ll) })).sort((a, b) => a.d - b.d)[0];
      const fas = fasilitas.filter((f) => haversine(p.ll, f.ll) <= 200).map((f) => f.nama);
      titik.push({
        type: 'Feature',
        properties: { id_kerusakan: `KR-${String(nTitik).padStart(3, '0')}`, id_segmen, ruas, arah, kecamatan,
          km: r2(p.km), jenis_kerusakan: p.jenis, tingkat_kerusakan: p.tingkat,
          panjang_m: p.panjang_m, lebar_m: p.lebar_m, kedalaman_cm: p.kedalaman_cm, kemacetan,
          elemen_terdekat: ej.d <= 100 ? `${ej.e.nama} (${Math.round(ej.d)} m)` : null,
          fasilitas_200m: fas.length ? fas.join('; ') : null,
          skor_saw: S, kelas_prioritas: kelas(S), foto: null, tanggal_survei: '2026-05-0' + (1 + Math.floor(rnd() * 9)) },
        geometry: { type: 'Point', coordinates: toXY(p.ll) },
      });
    }
  }
}

const fc = (name, features) => ({ type: 'FeatureCollection', name,
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } }, features });
const pointFeat = (props, ll) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: toXY(ll) } });

const out = path.join(__dirname, '..', 'data');
fs.mkdirSync(out, { recursive: true });
const write = (file, obj) => fs.writeFileSync(path.join(out, file), JSON.stringify(obj, null, 1));
write('titik_kerusakan.geojson', fc('titik_kerusakan', titik));
write('prioritas_segmen.geojson', fc('prioritas_segmen', segmen));
write('jalur_alternatif.geojson', fc('jalur_alternatif', jalur));
write('elemen_jaringan.geojson', fc('elemen_jaringan', elemen.map((e) =>
  pointFeat({ id_elemen: e.id, nama: e.nama, jenis: e.jenis, km: e.km, buffer_m: 100 }, e.ll))));
write('fasilitas_publik.geojson', fc('fasilitas_publik', fasilitas.map((f) =>
  pointFeat({ id_fasilitas: f.id, nama: f.nama, jenis: f.jenis, km: f.km, buffer_m: 200 }, f.ll))));

assert(titik.length > 0 && segmen.length > 0 && jalur.length > 0);
const tinggi = segmen.filter((s) => s.properties.kelas_prioritas === 'Tinggi').length;
console.log(`titik=${titik.length} segmen=${segmen.length} (tinggi=${tinggi}) jalur_alt=${jalur.length}`);
