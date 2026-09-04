# Desktop launcher

Menjalankan God's Eye View sebagai aplikasi Windows: ikon di Desktop dan menu
Start, jendela sendiri tanpa tab dan address bar, dan entri di
**Settings > Apps > Installed apps**.

## Pasang

```powershell
powershell -ExecutionPolicy Bypass -File app\install.ps1
```

Tidak butuh hak administrator — semuanya ditulis di profil pengguna dan `HKCU`.
Sumbernya tidak disalin ke mana pun: aplikasi berjalan langsung dari checkout
ini, karena ia memang membutuhkan `node_modules`, `.env`, dan `config/`.

## Copot

```powershell
powershell -ExecutionPolicy Bypass -File app\uninstall.ps1
```

Tambahkan `-RemoveProfile` untuk sekalian menghapus profil jendela (ukuran
jendela, zoom, izin mikrofon untuk fitur suara). Kode sumber tidak pernah
disentuh.

## Cara kerjanya

`GodsEyeView.vbs` → `gev-launcher.ps1` → server + jendela.

Rantai itu ada supaya tidak ada jendela konsol yang berkedip saat ikon diklik.
Peran launcher:

1. Preflight: Node ada di PATH, `node_modules` terpasang, `.env` punya
   `GOOGLE_MAPS_API_KEY`. Kegagalan muncul sebagai kotak dialog, bukan diam.
2. Menampilkan splash — hanya pada start dingin. Launcher sengaja tak terlihat,
   jadi tanpa ini klik ikon tidak menghasilkan apa pun di layar selama beberapa
   detik, yang terbaca sebagai gagal dan mengundang klik kedua. Splash-nya
   best-effort: kalau gagal dibuat, peluncuran tetap berjalan.
3. Menyalakan Vite di port 4173 secara tersembunyi — atau memakai ulang server
   yang sudah jalan, sehingga klik ganda memberi jendela kedua, bukan rebutan
   port.
4. Menunggu server benar-benar menjawab (bukan sekadar port terbuka). Status
   splash membedakan keduanya: "Menyalakan sistem" saat port belum terbuka,
   "Menyiapkan globe" setelah Vite boot tapi belum menyajikan aplikasi.
5. Membuka Chrome — atau Edge — dalam mode `--app` dengan direktori profil
   sendiri di `app/browser-profile/`, menahan splash 2,5 detik melintasi
   start-up Chrome supaya layar tidak sempat kosong, lalu menutupnya.
6. Menunggu jendela ditutup, lalu mematikan server yang ia nyalakan sendiri.
   Server milik orang lain tidak disentuh.

Start dingin terukur ~6 detik; dengan cache Vite hangat ~2 detik.

Jejaknya ada di `app/launcher.log`; keluaran Vite ada di `app/server.log` dan
`app/server.err.log`.

## Kenapa dev server, bukan hasil build

Backend aplikasi ini **adalah** dev server Vite. Ke-21 plugin proxy di
`vite.config.js` menjembatani provider yang menyimpan rahasia (OpenAI,
AISStream, TomTom, FIRMS, OpenSky), dan hanya 9 di antaranya yang juga
mendaftarkan `configurePreviewServer`. Artinya `vite build` + `vite preview`
akan menyala dengan sebagian besar layer langsung mati. Mode `vite` adalah
satu-satunya mode di mana aplikasi ini utuh.

Konsekuensinya: Node.js tetap harus terpasang, dan folder ini tidak bisa
dipindahkan tanpa menjalankan ulang `install.ps1`.

## Catatan

- **Port** default 4173. Untuk mengubahnya, sunting `-Port` di
  `gev-launcher.ps1`.
- **Ikon** dibuat dari `public/logo.svg` oleh `node app/make-icon.mjs`
  (memakai `sharp`, sudah ada sebagai devDependency). `install.ps1`
  menjalankannya otomatis bila `.ico` belum ada.
- **Encoding**: berkas `.ps1` disimpan sebagai UTF-8 **dengan BOM** dan hanya
  berisi karakter ASCII. Windows PowerShell 5.1 membaca skrip tanpa BOM sebagai
  ANSI, dan sebuah em-dash yang salah dibaca akan berubah menjadi tanda kutip
  pintar yang merusak parsing. Kalau menyunting berkas ini, pertahankan
  keduanya.
- **Node 22 vs 24**: `package.json` meminta Node 24/26, tetapi dev server
  berjalan baik di Node 22 yang terpasang di mesin ini. Yang benar-benar
  menuntut Node 24 hanya berkas uji anggaran alokasi (`npm test`).
