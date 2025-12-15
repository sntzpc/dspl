# Dashboard Pelanggaran Disiplin (Offline-first)

Aplikasi web HTML yang:
- Input pelanggaran via web (manual/sugesti NIK/nama + scan QR code)
- Simpan cepat ke IndexedDB (offline-first)
- Sync Up ke Google Sheet (via Google Apps Script Web App)
- Pull master (peserta + master pelanggaran + sanksi + threshold)
- Tarik kembali data pelanggaran dari Google Sheet jika data lokal terhapus

## 1) Struktur file
- index.html
- css/style.css
- js/idb.js
- js/config.js (seed peserta + master awal)
- js/app.js
- sw.js + manifest.json (PWA)
- Code.gs (Google Apps Script backend)

## 2) Setup Google Sheet + Apps Script
1. Buat Google Spreadsheet baru.
2. Copy file `Code.gs` ke Apps Script (Extensions → Apps Script).
3. Di `CFG.SPREADSHEET_ID` isi Spreadsheet ID Anda.
4. (Opsional) set `CFG.API_KEY` sesuai kebutuhan keamanan.
5. Jalankan fungsi `init()` sekali (Run) untuk membuat sheet & header.
6. (Opsional) jalankan `seedMaster()` untuk mengisi master pelanggaran & sanksi default.
7. Deploy → New deployment → Web app:
   - Execute as: Me
   - Who has access: Anyone with the link
   Salin URL Web App yang berakhiran `/exec`.

## 3) Setup aplikasi web
1. Jalankan aplikasi lewat server lokal (disarankan) agar kamera & PWA bekerja:
   - VSCode Live Server, atau
   - `python -m http.server 8080`
2. Buka `http://localhost:8080` → tab Sinkronisasi:
   - Tempel GAS Web App URL
   - Isi API key (jika dipakai)
   - Klik “Simpan Setting”
3. Klik “Pull Master”.

## 4) QR Code format
Isi QR cukup NIK angka (misalnya: 202509065).

## 5) Catatan
- Data pelanggaran disimpan di IndexedDB store `violations`.
- Data master peserta disimpan di store `participants`.
- Jika browser data dihapus, klik “Tarik Data Pelanggaran dari Google Sheet” untuk restore.

