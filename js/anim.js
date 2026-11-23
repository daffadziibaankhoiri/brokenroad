/* BrokenRoad: animasi GSAP + ScrollTrigger.
   Semua animasi hanya jalan bila pengguna tidak meminta reduced motion; matchMedia membatalkannya otomatis. */
(function () {
  if (!window.gsap) return; // CDN gagal dimuat: halaman tetap tampil statis
  gsap.registerPlugin(ScrollTrigger);
  gsap.defaults({ ease: 'power3.out', duration: 0.8 });
  gsap.config({ nullTargetWarn: false }); // index & about berbagi skrip; target yang tak ada di halaman ini dilewati saja

  const mm = gsap.matchMedia();
  let motion = false; // true selama media query no-preference cocok

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    motion = true;

    // Navbar turun dari atas
    gsap.from('.navbar', { yPercent: -100, autoAlpha: 0, duration: 0.6, clearProps: 'all' });

    // Intro hero: berurutan, bukan rantai delay
    const tl = gsap.timeline({ delay: 0.1 });
    tl.from('.hero__kicker', { y: 16, autoAlpha: 0 })
      .from('.hero h1', { y: 40, autoAlpha: 0, duration: 1 }, '<0.1')
      .from('.lead', { y: 24, autoAlpha: 0 }, '<0.25')
      .from('.metrics > div, .hero__actions > *', { y: 24, autoAlpha: 0, stagger: 0.08 }, '<0.2')
      .from('.hero__text > .btn-primary',{ y: 16, scale: 0.95, autoAlpha: 0 }, '<0.2')
      .from('.hero__stage', { y: 40, scale: 0.96, autoAlpha: 0, duration: 1 }, 0.3)
      .from('.chip', { y: 20, scale: 0.9, autoAlpha: 0, stagger: 0.15, ease: 'back.out(1.6)', clearProps: 'transform' }, 0.9) // clearProps: transform inline akan mematikan efek hover CSS
      .from('.hero__quote', { autoAlpha: 0 }, '-=0.4');

    // Elemen .reveal muncul bertahap saat masuk viewport
    gsap.set('.reveal', { y: 40, autoAlpha: 0 });
    ScrollTrigger.batch('.reveal', {
      start: 'top 88%',
      once: true,
      onEnter: (els) => gsap.to(els, { y: 0, autoAlpha: 1, stagger: 0.12, overwrite: true, clearProps: 'all' }), // clearProps: transform/opacity sisa bisa mengganggu backdrop-filter
    });

    // Bagian di bawah hanya ada di index.html
    if (document.querySelector('#peta')) {
      // Kaca filter & panel workspace muncul saat peta terlihat
      gsap.from('.filter-bar, .workspace', {
        y: 40, autoAlpha: 0, stagger: 0.15, clearProps: 'all',
        scrollTrigger: { trigger: '#peta', start: 'top 75%' },
      });

      // Parallax ringan: peta mini bergerak lebih lambat dari scroll
      gsap.to('.hero__stage', {
        yPercent: -8, ease: 'none',
        scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: 1 },
      });
    }

    return () => { motion = false; };
  });

  // Dipanggil app.js setelah GeoJSON dimuat
  function dataReady() {
    if (!motion) return;
    // Angka KPI menghitung naik dari 0
    document.querySelectorAll('#kpi-titik, #kpi-tinggi').forEach((el) => {
      const end = parseInt(el.textContent, 10);
      if (!Number.isFinite(end)) return;
      const o = { v: 0 };
      gsap.to(o, { v: end, duration: 1.4, ease: 'power2.out', onUpdate: () => { el.textContent = Math.round(o.v); } });
    });
    // Ruas di peta mini "tergambar" satu per satu (urutan DOM: prioritas rendah dulu, tinggi terakhir)
    const segs = document.querySelectorAll('#hero-map .seg');
    segs.forEach((p) => { const len = p.getTotalLength(); gsap.set(p, { strokeDasharray: len, strokeDashoffset: len }); });
    gsap.to(segs, { strokeDashoffset: 0, duration: 0.5, ease: 'power1.inOut', stagger: { amount: 1.4 }, delay: 0.6,
      clearProps: 'strokeDasharray,strokeDashoffset' });
  }

  // Dipanggil app.js setiap daftar prioritas dirender ulang (filter berubah)
  function list() {
    if (!motion) return;
    gsap.from('#tab-list .seg-card', { x: 24, autoAlpha: 0, duration: 0.45, stagger: { each: 0.03, amount: 0.5 }, overwrite: true });
  }

  // Panel detail meluncur masuk saat objek diklik
  function detail() {
    if (!motion) return;
    gsap.from('#tab-detail > *', { y: 16, autoAlpha: 0, duration: 0.45, stagger: 0.05, overwrite: true });
  }

  window.BRAnim = { dataReady, list, detail };
})();
