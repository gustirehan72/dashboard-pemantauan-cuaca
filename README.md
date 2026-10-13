# Dashboard Cuaca — BBWS Sumatera VIII (Sumatera Selatan)

Dashboard pemantauan cuaca untuk seluruh **Sumatera Selatan**, dengan
data cuaca resmi dan gratis dari BMKG, peta interaktif dengan batas
per kabupaten/kota, pemilih wilayah, dan mode berpindah lokasi acak.

## Sumber data (semua gratis, tanpa API key)

| Kebutuhan                               | Sumber                                              |
|------------------------------------------|------------------------------------------------------|
| Prakiraan cuaca                          | `api.bmkg.go.id` (Data Terbuka BMKG)                 |
| Daftar kabupaten/kota/kecamatan/kelurahan| `wilayah.id`                                          |
| Peta jalan & nama tempat (default)       | OpenStreetMap                                         |
| Citra satelit (opsi alternatif di peta)  | Esri World Imagery                                    |
| Garis batas kabupaten/kota               | OpenStreetMap, via Nominatim                          |
| Kualitas udara (AQI)                     | Open-Meteo Air Quality API (model CAMS)               |
| Angin (kecepatan & arah)                 | `api.bmkg.go.id` (field `ws`/`wd`, sama dengan data cuaca) |
| Aset BBWS (AWLR, ARR, AWS, Embung, Bendung, DAS) | Data GIS internal BBWS Sumatera VIII (diolah dari shapefile) |

## Menjalankan secara lokal

```bash
npm install
npm start
```

Buka `http://localhost:3000` di browser.

## Struktur folder

```
cuaca-dashboard/
├── server.js        # backend Express + proxy ke BMKG, wilayah.id, Nominatim
├── package.json
└── public/
    ├── index.html
    ├── style.css
    ├── script.js
    ├── assets/
    │   └── logo-pu.png
    └── data/
        └── aset-bbws.json   # titik & area aset BBWS, hasil olahan shapefile
```

## Aset BBWS di peta

Aset yang tersedia (Pos Duga Air/AWLR, Pos Hujan/ARR, Pos Klimatologi/AWS,
Embung, Bendung, dan Daerah Aliran Sungai) diolah dari shapefile resmi BBWS
Sumatera VIII menjadi satu file `public/data/aset-bbws.json`. Semuanya
**tersembunyi secara default** - nyalakan lewat centang di bagian "Aset BBWS
Sumatera VIII" pada legenda peta, persis seperti "Batas wilayah".
Ikon Embung, Bendung, dan cuaca "Kabut/kabur" memakai gambar kustom di
`public/assets/`.

Beberapa catatan jujur soal data ini:
- Koordinat yang aslinya dalam UTM Zone 48S (Bendung) sudah
  dikonversi ke lintang/bujur biasa (divalidasi silang dengan titik lain
  yang sudah dalam lintang/bujur - meleset sekitar 40 meter, wajar untuk
  dua titik survei berbeda di lokasi yang sama).
- Poligon DAS yang titiknya sangat banyak sudah disederhanakan supaya tidak
  membebani browser - bentuk garis besarnya tetap akurat.
- Layer ini murni data referensi statis (lokasi aset), bukan status
  real-time (debit air, curah hujan terkini, dll) - data sensor langsung
  tidak tersedia dalam file yang diberikan.

## Struktur `script.js` (penting kalau mau mengedit)

File ini sengaja dibagi 3 bagian tegas, urutannya wajib dijaga:
1. **Variabel status** — semua `let` di dekat atas file.
2. **Fungsi-fungsi** — semua `function` di tengah.
3. **Kode yang langsung berjalan** — `tickClock()`, `init()`, dan
   sejenisnya di paling bawah file, setelah semuanya di atas selesai.

Aturan ini mencegah bug "Cannot access X before initialization" yang
pernah membuat dashboard berhenti total tanpa pesan error. Kalau
menambah variabel baru yang dipakai kode yang jalan segera, taruh
deklarasinya di bagian atas, jangan di dekat kode pemakainya.

## Cara kerja

- **Pemilih wilayah** (dropdown di strip biru) — pilih salah satu
  kabupaten/kota untuk fokus ke sana (wilayah lain diredupkan di peta,
  kecamatan-kecamatannya dimuat satu per satu), atau pilih "Seluruh
  Sumatera Selatan" untuk melihat semua kabupaten/kota sekaligus.
- **Klik langsung di peta** — klik garis batas sebuah kabupaten/kota
  saat mode "Seluruh Sumatera Selatan" untuk fokus ke sana, atau klik
  ikon cuaca mana pun untuk langsung menampilkan cuaca di titik itu.
- **Mode otomatis (default)** — dashboard berpindah sendiri secara acak
  antar titik yang sedang terlihat tiap 5 detik (`AUTO_CYCLE_MS` di
  `script.js`), tidak mengulang titik yang sama sampai semua kebagian
  giliran. Begitu ada pemilihan manual, mode ini dijeda 5 menit
  (`IDLE_RESUME_MS`) lalu jalan lagi sendiri.
- **Legenda** (kanan atas peta) — bisa dilipat/disembunyikan lewat
  tombol kecil di pojoknya, dan checkbox di dalamnya mengatur tampil/
  tidaknya garis batas serta ikon cuaca di semua area sekaligus.

## Batasan yang perlu diketahui (baca sebelum pakai untuk operasional)

- **Garis batas wilayah** memakai data komunitas OpenStreetMap (via
  Nominatim), bukan data batas administrasi resmi BIG/Kemendagri. Cukup
  akurat untuk visualisasi, tapi jangan dipakai sebagai rujukan hukum/legal.
- **Ikon di peta** menunjukkan kondisi cuaca BMKG real-time (bukan data
  sensor AWLR/ARR/AWS sungai atau data Hari Tanpa Hujan — itu produk
  BMKG lain yang tidak tersedia lewat API publik).
- Memuat 17 kabupaten/kota + kecamatannya butuh banyak permintaan ke
  BMKG dan Nominatim. Server ini membatasi kecepatan permintaan ke
  masing-masing (BMKG & Nominatim, sekitar 1 permintaan/detik) dan
  meng-cache hasilnya, supaya tidak diblokir upstream — jadi ikon dan
  batas wilayah akan terisi bertahap selama beberapa puluh detik
  pertama, bukan langsung semua muncul.
- Semua permintaan ke server luar punya timeout, dan ada jaring
  pengaman di frontend yang menampilkan pesan error langsung di layar
  kalau ada yang gagal — tidak akan diam "loading" tanpa keterangan.
- Kalau CDN `unpkg.com` (tempat memuat pustaka peta Leaflet) diblokir
  oleh jaringan kantor/ISP, peta akan menampilkan pesan "tidak
  tersedia", tapi seluruh data cuaca tetap berjalan normal.
- Tidak ada satupun nilai cuaca yang dihitung/disimulasikan secara
  lokal — semua kartu memakai respons `/api/cuaca` yang sama, langsung
  dari BMKG.

## Deploy supaya bisa diakses semua orang

1. Push folder ini ke GitHub.
2. Deploy ke layanan seperti Render.com / Railway (mendukung Node.js).
3. (Opsional) Arahkan domain sendiri ke layanan tersebut lewat DNS (CNAME).

## Kredit data

Wajib dicantumkan sesuai ketentuan BMKG: Sumber data cuaca: BMKG
(Badan Meteorologi, Klimatologi, dan Geofisika). Sudah otomatis
ditampilkan di footer dashboard, bersama kredit OpenStreetMap & Esri.
