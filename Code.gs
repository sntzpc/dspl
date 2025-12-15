/**
 * Dashboard Pelanggaran Disiplin - Google Apps Script Backend
 *
 * Sheets:
 * - peserta
 * - master_pelanggaran
 * - master_sanksi
 * - threshold_sanksi
 * - pelanggaran_log
 *
 * Deploy as Web App (Execute as: Me, Access: Anyone with the link)
 */

const CFG = {
  // >>>> GANTI dengan Spreadsheet ID milik Anda <<<<
  SPREADSHEET_ID: "PASTE_SPREADSHEET_ID_HERE",

  // Optional API key (isi bebas). Jika kosong, endpoint tetap jalan tanpa key.
  API_KEY: "CHANGE_ME_OR_EMPTY",

  SHEETS: {
    peserta: "peserta",
    masterPelanggaran: "master_pelanggaran",
    masterSanksi: "master_sanksi",
    threshold: "threshold_sanksi",
    log: "pelanggaran_log",
  }
};

function doGet(e){
  try{
    const action = (e.parameter.action || "").trim();
    checkKey_(e);

    if(action === "ping") return ok_({message:"pong", now: new Date().toISOString()});
    if(action === "getMaster") return ok_(getMaster_());
    if(action === "getViolations") return ok_({rows: getViolations_()});

    return ok_({ok:true, message:"No action. Use ?action=ping|getMaster|getViolations"});
  }catch(err){
    return fail_(err);
  }
}

function doPost(e){
  try{
    const action = (e.parameter.action || "").trim();
    checkKey_(e);

    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    if(action === "upsertViolations"){
      const ids = upsertViolations_(body.rows || []);
      return ok_({ids});
    }
    return ok_({ok:true, message:"No POST action."});
  }catch(err){
    return fail_(err);
  }
}

/** One-time initializer: creates sheets + headers + seeds. Run manually from editor. */
function init(){
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const shPeserta = getOrCreate_(ss, CFG.SHEETS.peserta, ["nik","nama","program","divisi","unit","region","group","is_active"]);
  const shPel = getOrCreate_(ss, CFG.SHEETS.masterPelanggaran, ["id","jenis","deskripsi","poin","kategori"]);
  const shS = getOrCreate_(ss, CFG.SHEETS.masterSanksi, ["sanksi"]);
  const shT = getOrCreate_(ss, CFG.SHEETS.threshold, ["min","max","status","konsekuensi"]);
  const shLog = getOrCreate_(ss, CFG.SHEETS.log, [
    "id","waktu","nik","nama","program","divisi","unit","region","group",
    "pelanggaran_id","pelanggaran","kategori","poin","status","konsekuensi",
    "sanksi","catatan","petugas","created_at","updated_at"
  ]);

  // NOTE: Anda bisa paste data peserta & master lewat import spreadsheet biasa,
  // atau gunakan fungsi seedMaster() untuk mengisi master default.
  SpreadsheetApp.flush();
  return "OK";
}

/** Optional seeding master data (from your SOP). Run manually after init(). */
function seedMaster(){
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const shPel = ss.getSheetByName(CFG.SHEETS.masterPelanggaran);
  const shS = ss.getSheetByName(CFG.SHEETS.masterSanksi);
  const shT = ss.getSheetByName(CFG.SHEETS.threshold);

  const master = [
    ["V01","Merokok di lingkungan TC","Termasuk menyimpan barang terkait rokok",30,"Umum"],
    ["V02","Tidak hadir tepat waktu","Datang terlambat / tidak ikut apel / tidak masuk kelas tanpa alasan jelas",20,"Umum"],
    ["V03","Tempat tidur tidak rapi","Tidak merapikan tempat tidur atau meletakkan pakaian sembarangan",10,"Umum"],
    ["V04","Boros listrik","Tidak mematikan AC/Lampu/Stop kontak setelah dipakai",10,"Umum"],
    ["V05","Boros air","Membiarkan air mengalir / tidak efisien",10,"Umum"],
    ["V06","Tidak menjaga kebersihan kelas & TC","Sampah berserakan, food wrap ditinggal",10,"Umum"],
    ["V07","Tidak melaksanakan ibadah sesuai agama","Absen ibadah secara sengaja tanpa alasan",15,"Umum"],
    ["V08","Tidak memakai sepatu selama kegiatan","Termasuk tidak memakai APD lainnya",15,"Umum"],
    ["V09","Keluar lingkungan TC tanpa izin","Tidak izin ke TC Head / HR Training / KTU",25,"Umum"],
    ["V10","Membawa makanan ke kamar / makan di kasur","Menimbulkan masalah kebersihan dan mengundang semut",10,"Umum"],
    ["V11","Jam malam dilanggar / berkeliaran setelah waktu istirahat","Melanggar ketentuan jadwal TC",15,"Umum"],
    ["V12","Bermain HP saat sesi kelas","Tidak fokus belajar",10,"Umum"],
    ["V13","Tidak mengikuti kegiatan dan lingkaran pagi","Tanpa alasan",15,"Umum"],
    ["V14","Tidak menghormati instruktur / berperilaku kurang sopan","Suara tinggi, melawan arahan",30,"Umum"],
    ["V15","Nilai Post Test di bawah 76","Tidak antusias dalam belajar",10,"Umum"],
    ["H01","Manipulasi data / laporan palsu","Pelanggaran berat - integritas",100,"Berat"],
    ["H02","Mencuri / mengambil barang bukan milik sendiri","Pelanggaran berat - integritas",100,"Berat"],
    ["H03","Berkelahi / kekerasan fisik","Pelanggaran berat - integritas",100,"Berat"],
    ["H04","Penyalahgunaan obat terlarang / alkohol","Pelanggaran berat - integritas",100,"Berat"],
    ["H05","Vandalisme / merusak fasilitas","Pelanggaran berat - integritas (100 + ganti rugi)",100,"Berat"],
  ];

  const sanctions = [
    ["Potong rumput lingkungan TC selama 30 menit"],
    ["Membersihkan Toilet Kelas sebanyak 2 hari berturut-turut"],
    ["Tidak dibagikan HP di hari Sabtu dan Minggu selama 1 periode"],
    ["Menanam tanaman buah tahunan sebanyak 1 pohon"],
    ["Mengumpulkan topsoil untuk bedengan sebanyak 5 angkong"],
    ["Ecer Jangkos sebanyak 5 angkong"],
    ["Membersihkan Celling Fan Ruang Restoran sebanyak 1 hari"],
    ["Menyapu dan mengepel Ruang Kelas di pagi hari sebanyak 1 kali"],
  ];

  const thr = [
    [0,30,"Aman","Pembinaan ringan push up 10x & catatan disiplin"],
    [31,49,"Warning","Surat peringatan 1 & mencuci peralatan makan 1 hari"],
    [50,79,"Disiplin Keras","Diberlakukan sanksi (50-59: 1 sanksi; 60-69: 2 sanksi; 70-79: 3 sanksi)"],
    [80,99,"Critical","Sidang disiplin & rekomendasi pulang"],
    [100,100,"Gagal","Dikeluarkan dari program"],
  ];

  clearDataKeepHeader_(shPel);
  clearDataKeepHeader_(shS);
  clearDataKeepHeader_(shT);

  shPel.getRange(2,1,master.length,5).setValues(master);
  shS.getRange(2,1,sanctions.length,1).setValues(sanctions);
  shT.getRange(2,1,thr.length,4).setValues(thr);

  return "OK";
}

// ===== internals =====
function getMaster_(){
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const participants = readObjects_(ss.getSheetByName(CFG.SHEETS.peserta));
  const violations = readObjects_(ss.getSheetByName(CFG.SHEETS.masterPelanggaran));
  const sanctions = readObjects_(ss.getSheetByName(CFG.SHEETS.masterSanksi)).map(r=> r.sanksi).filter(Boolean);
  const thresholds = readObjects_(ss.getSheetByName(CFG.SHEETS.threshold)).map(r=>({
    min: Number(r.min), max: Number(r.max), status: r.status, konsekuensi: r.konsekuensi
  }));
  return {participants, violations, sanctions, thresholds};
}

function getViolations_(){
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CFG.SHEETS.log);
  return readObjects_(sh);
}

function upsertViolations_(rows){
  const ss = SpreadsheetApp.openById(CFG.SPREADSHEET_ID);
  const sh = ss.getSheetByName(CFG.SHEETS.log);

  const header = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  const idx = indexBy_(sh, header, "id"); // existing ids
  const nowIso = new Date().toISOString();

  const idsOk = [];
  rows.forEach((r)=>{
    if(!r || !r.id) return;
    const values = header.map((h)=>{
      if(h === "updated_at") return nowIso;
      if(h === "created_at") return r.created_at || nowIso;
      return (r[h] !== undefined) ? r[h] : "";
    });

    const rowIndex = idx[String(r.id)];
    if(rowIndex){
      sh.getRange(rowIndex, 1, 1, header.length).setValues([values]);
    }else{
      sh.appendRow(values);
    }
    idsOk.push(String(r.id));
  });

  return idsOk;
}

function checkKey_(e){
  const need = String(CFG.API_KEY || "").trim();
  if(!need) return;
  const got = String((e.parameter && e.parameter.key) || "").trim();
  if(got !== need) throw new Error("Invalid API key.");
}

function ok_(obj){
  return ContentService
    .createTextOutput(JSON.stringify({ok:true, ...obj}))
    .setMimeType(ContentService.MimeType.JSON);
}
function fail_(err){
  const msg = (err && err.message) ? err.message : String(err);
  return ContentService
    .createTextOutput(JSON.stringify({ok:false, message: msg}))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreate_(ss, name, header){
  let sh = ss.getSheetByName(name);
  if(!sh) sh = ss.insertSheet(name);
  if(sh.getLastRow() === 0){
    sh.getRange(1,1,1,header.length).setValues([header]);
  }else{
    const cur = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    if(cur.join("|") !== header.join("|")){
      sh.getRange(1,1,1,header.length).setValues([header]);
    }
  }
  return sh;
}

function clearDataKeepHeader_(sh){
  const lr = sh.getLastRow();
  if(lr > 1){
    sh.getRange(2,1,lr-1,sh.getLastColumn()).clearContent();
  }
}

function readObjects_(sh){
  if(!sh) return [];
  const lr = sh.getLastRow();
  const lc = sh.getLastColumn();
  if(lr < 2) return [];
  const header = sh.getRange(1,1,1,lc).getValues()[0].map(String);
  const values = sh.getRange(2,1,lr-1,lc).getValues();
  return values.map(row=>{
    const o = {};
    header.forEach((h,i)=> o[h] = row[i]);
    return o;
  });
}

function indexBy_(sh, header, key){
  const lr = sh.getLastRow();
  const out = {};
  if(lr < 2) return out;
  const col = header.indexOf(key) + 1;
  if(col <= 0) return out;
  const ids = sh.getRange(2,col,lr-1,1).getValues().flat();
  for(let i=0;i<ids.length;i++){
    const v = String(ids[i]||"").trim();
    if(v) out[v] = i+2; // sheet row number
  }
  return out;
}
