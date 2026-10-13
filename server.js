const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

const cache = new Map();
const inflight = new Map();

const CACHE_TTL_MS = 10 * 60 * 1000;
const WILAYAH_TTL_MS = 24 * 60 * 60 * 1000;
const BOUNDARY_TTL_MS = 24 * 60 * 60 * 1000;
const EMPTY_BOUNDARY_TTL_MS = 30 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 10000;
const BMKG_MIN_INTERVAL_MS = 1100;
const NOMINATIM_MIN_INTERVAL_MS = 1100;

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function setCache(key, data, ttlMs = CACHE_TTL_MS) {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function createThrottle(minIntervalMs) {
  let last = 0;
  let chain = Promise.resolve();
  return (task) => {
    const run = chain.then(async () => {
      const delay = last + minIntervalMs - Date.now();
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      last = Date.now();
      return task();
    });
    chain = run.catch(() => {});
    return run;
  };
}

const bmkgThrottle = createThrottle(BMKG_MIN_INTERVAL_MS);
const nominatimThrottle = createThrottle(NOMINATIM_MIN_INTERVAL_MS);

function once(key, task) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = task().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'dashboard-cuaca-bbws/1.0', Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Upstream error ${res.status} untuk ${url}`);
  }
  return res.json();
}

function pickBoundary(results, query) {
  const admin = results.filter((r) =>
    r && r.geojson &&
    (r.geojson.type === 'Polygon' || r.geojson.type === 'MultiPolygon') &&
    r.category === 'boundary' && r.type === 'administrative'
  );
  const hint = query.includes(',') ? query.split(',').pop().trim().toLowerCase() : '';
  const inHint = hint ? admin.find((r) => String(r.display_name || '').toLowerCase().includes(hint)) : null;
  return inHint || admin[0] || null;
}

app.get('/api/cuaca', async (req, res) => {
  const adm4 = (req.query.adm4 || '').trim();

  if (!/^\d{2}\.\d{2}\.\d{2}\.\d{4}$/.test(adm4)) {
    return res.status(400).json({
      error: 'Parameter adm4 tidak valid. Contoh format: 16.71.01.1001'
    });
  }

  const cacheKey = `cuaca:${adm4}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const url = `https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=${encodeURIComponent(adm4)}`;
    const data = await once(cacheKey, () => bmkgThrottle(() => fetchJson(url)));
    setCache(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error('[api/cuaca] gagal ambil data BMKG:', err.message);
    res.status(502).json({ error: 'Gagal mengambil data cuaca dari BMKG.' });
  }
});

async function proxyWilayah(res, cacheKey, url) {
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await once(cacheKey, () => fetchJson(url));
    setCache(cacheKey, data, WILAYAH_TTL_MS);
    res.json(data);
  } catch (err) {
    console.error(`[api/wilayah] gagal ambil ${url}:`, err.message);
    res.status(502).json({ error: 'Gagal mengambil data wilayah.' });
  }
}

app.get('/api/wilayah/provinces', async (req, res) => {
  await proxyWilayah(res, 'provinces:all', 'https://wilayah.id/api/provinces.json');
});

app.get('/api/wilayah/regencies/:code', async (req, res) => {
  const { code } = req.params;
  await proxyWilayah(res, `regencies:${code}`, `https://wilayah.id/api/regencies/${code}.json`);
});

app.get('/api/wilayah/districts/:code', async (req, res) => {
  const { code } = req.params;
  await proxyWilayah(res, `districts:${code}`, `https://wilayah.id/api/districts/${code}.json`);
});

app.get('/api/wilayah/villages/:code', async (req, res) => {
  const { code } = req.params;
  await proxyWilayah(res, `villages:${code}`, `https://wilayah.id/api/villages/${code}.json`);
});

app.get('/api/udara', async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'Parameter lat dan lon wajib berupa angka.' });
  }

  const latR = lat.toFixed(2);
  const lonR = lon.toFixed(2);
  const cacheKey = `udara:${latR},${lonR}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const params = new URLSearchParams({
      latitude: latR,
      longitude: lonR,
      current: 'us_aqi,pm2_5,pm10',
      timezone: 'auto',
    });
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?${params.toString()}`;
    const data = await once(cacheKey, () => fetchJson(url));
    setCache(cacheKey, data, CACHE_TTL_MS);
    res.json(data);
  } catch (err) {
    console.error('[api/udara] gagal ambil data kualitas udara:', err.message);
    res.status(502).json({ error: 'Gagal mengambil data kualitas udara.' });
  }
});

app.get('/api/batas', async (req, res) => {
  const nama = (req.query.nama || '').trim();
  if (!nama) {
    return res.status(400).json({ error: 'Parameter nama wajib diisi, contoh: ?nama=Kota Palembang, Sumatera Selatan' });
  }

  const cacheKey = `batas:${nama.toLowerCase()}`;
  const cached = getCache(cacheKey);
  if (cached) return res.json(cached);

  try {
    const params = new URLSearchParams({
      q: nama,
      format: 'jsonv2',
      polygon_geojson: '1',
      polygon_threshold: '0.002',
      countrycodes: 'id',
      limit: '5',
      addressdetails: '0',
    });
    const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;

    const data = await once(cacheKey, () => nominatimThrottle(async () => {
      const raw = await fetchJson(url, {
        'User-Agent': 'dashboard-cuaca-bbws/1.0 (dashboard internal pemantauan cuaca)',
      });
      const hit = pickBoundary(Array.isArray(raw) ? raw : [], nama);
      return hit ? [hit] : [];
    }));

    setCache(cacheKey, data, data.length ? BOUNDARY_TTL_MS : EMPTY_BOUNDARY_TTL_MS);
    res.json(data);
  } catch (err) {
    console.error('[api/batas] gagal ambil batas wilayah:', err.message);
    res.status(502).json({ error: 'Gagal mengambil data batas wilayah.' });
  }
});

app.listen(PORT, () => {
  console.log(`Dashboard cuaca berjalan di http://localhost:${PORT}`);
});
