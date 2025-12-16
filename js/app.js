/* global APP_SEED, IDB, Html5Qrcode */
(function(){
  const $ = (sel, root=document)=> root.querySelector(sel);
  const $$ = (sel, root=document)=> Array.from(root.querySelectorAll(sel));

  const fmtDate = (d)=>{
    const pad=(n)=> String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const toLocalInputValue = (d)=>{
    const pad=(n)=> String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const now = ()=> new Date();

  function startOfDay(d){
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
  }
  function parseDateOnly(v){
    // v: "YYYY-MM-DD"
    if(!v) return null;
    const d = new Date(v + "T00:00:00");
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function getDashRange(){
    const sel = $("#dashPeriod");
    const v = sel ? sel.value : "30";
    const tNow = now();
    if(v === "today"){
      const from = startOfDay(tNow);
      const to = new Date(from); to.setDate(to.getDate()+1);
      return { from, to, label: "Hari ini" };
    }
    if(v === "7" || v === "30"){
      const days = Number(v);
      const to = tNow;
      const from = new Date(to.getTime() - days*24*3600*1000);
      return { from, to, label: `${days} hari terakhir` };
    }
    // custom
    const fromD = parseDateOnly($("#dashFrom")?.value);
    const toD   = parseDateOnly($("#dashTo")?.value);
    if(fromD && toD){
      const from = startOfDay(fromD);
      const to = startOfDay(toD); to.setDate(to.getDate()+1); // include end date
      return { from, to, label: `${$("#dashFrom").value} s/d ${$("#dashTo").value}` };
    }
    // fallback
    const to = tNow;
    const from = new Date(to.getTime() - 30*24*3600*1000);
    return { from, to, label: "30 hari terakhir" };
  }


  const uuid = ()=>{
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    // fallback
    return "id-" + Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
  };

  const CFG_KEY = "tc.pelanggaran.cfg";
  const USER_KEY = "tc.pelanggaran.user";
  const INSTALL_KEY = "tc.pelanggaran.installPrompt";

  // ====== AUTH ======
  const AUTH_KEY = "tc.pelanggaran.auth";        // session
  const ADMIN_HASH_KEY = "tc.pelanggaran.adminHash"; // admin password hash stored


  // ====== HARD-CODE GAS CONFIG (tanam permanen) ======
  const HARD_GAS_URL = "https://script.google.com/macros/s/AKfycbwwk4W2skF6xkSoec3laTEGdHbe4Z7E6vJkfS6tGjwUI18Z960n8rbqUPuRE-axz9Ww/exec";
  const HARD_API_KEY = "sntz2025"; // boleh "" jika tidak dipakai
  // ====== END HARD-CODE ======


  function loadCfg(){
  // Selalu pakai hardcode (tidak baca input HTML)
  const base = {...APP_SEED.defaultCfg};
  base.gasUrl = HARD_GAS_URL;
  base.apiKey = HARD_API_KEY;
  return base;
  }
  function saveCfg(cfg){
  // Dinonaktifkan karena config ditanam di app.js
  // localStorage.setItem(CFG_KEY, JSON.stringify(cfg||{}));
  }
  function loadUser(){
    try{ return JSON.parse(localStorage.getItem(USER_KEY)) || {}; }catch(_){ return {}; }
  }
  function saveUser(u){
    localStorage.setItem(USER_KEY, JSON.stringify(u||{}));
  }

  // ---- SHA-256 helper (async) ----
  async function sha256(text){
    const enc = new TextEncoder().encode(String(text));
    const buf = await crypto.subtle.digest("SHA-256", enc);
    const arr = Array.from(new Uint8Array(buf));
    return arr.map(b=> b.toString(16).padStart(2,"0")).join("");
  }

  function loadAuth(){
    try{ return JSON.parse(localStorage.getItem(AUTH_KEY)) || null; }catch(_){ return null; }
  }
  function saveAuth(a){
    localStorage.setItem(AUTH_KEY, JSON.stringify(a||{}));
  }
  function clearAuth(){
    localStorage.removeItem(AUTH_KEY);
  }

  async function ensureAdminHash(){
    // default admin password: admin123
    let h = localStorage.getItem(ADMIN_HASH_KEY);
    if(!h){
      h = await sha256("admin123");
      localStorage.setItem(ADMIN_HASH_KEY, h);
    }
    return h;
  }

  function isAdmin(){
    const a = loadAuth();
    return a && a.role === "admin";
  }
  function getUserNik(){
    const a = loadAuth();
    if(a && a.role === "user") return String(a.nik || "").trim();
    return "";
  }

  async function changeAdminPassword(){
    if(!isAdmin()){
      toast("Hanya admin yang bisa ganti password.");
      return;
    }
    const p1 = prompt("Masukkan password admin baru (min 6 karakter):", "");
    if(p1 === null) return;
    if(String(p1).trim().length < 6){
      toast("Password minimal 6 karakter.");
      return;
    }
    const p2 = prompt("Ulangi password baru:", "");
    if(p2 === null) return;
    if(p1 !== p2){
      toast("Konfirmasi tidak sama.");
      return;
    }
    const h = await sha256(p1);
    localStorage.setItem(ADMIN_HASH_KEY, h);
    toast("Password admin berhasil diubah ✅");
  }


  function netUI(){
    const el = $("#netBadge");
    if(!el) return;
    const online = navigator.onLine;
    el.textContent = online ? "online" : "offline";
    el.classList.toggle("ok", online);
    el.classList.toggle("off", !online);
  }

  function pickThreshold(total){
    const t = APP_SEED.seedThresholds.find(x=> total>=x.min && total<=x.max);
    return t || {status:"—", konsekuensi:"—"};
  }

  async function ensureSeeded(){
    const seeded = await IDB.getMeta("seeded_v1");
    if(seeded) return;

    await IDB.bulkPut("participants", APP_SEED.seedParticipants.map(p=>({
      ...p,
      nik: String(p.nik).trim()
    })));
    await IDB.bulkPut("masterViolations", APP_SEED.seedMasterViolations);
    await IDB.setMeta("sanctions", APP_SEED.seedSanctions);
    await IDB.setMeta("thresholds", APP_SEED.seedThresholds);
    await IDB.setMeta("seeded_v1", true);
  }

  async function getSanctions(){
    return (await IDB.getMeta("sanctions")) || APP_SEED.seedSanctions;
  }
  async function getThresholds(){
    return (await IDB.getMeta("thresholds")) || APP_SEED.seedThresholds;
  }

  // ====== UI wiring ======
  function initTabs(){
    $$(".tab").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const a = loadAuth();
        if(!a){
          openLogin();
          return;
        }

        // role gating: user hanya dash + data
        const tab = btn.dataset.tab;
        if(a.role === "user" && !["dash","data"].includes(tab)){
          toast("Akses dibatasi: hanya Dashboard & Data untuk user.");
          return;
        }

        $$(".tab").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");

        $$("main .panel").forEach(p=>p.style.display="none");
        $("#tab-"+tab).style.display="block";

        if(tab==="dash") refreshDashboard();
        if(tab==="data") renderAll();
        if(tab==="input") refreshRecent();
      });
    });
  }


  // ====== MASTER LOAD ======
  async function renderMaster(){
    const list = await IDB.getAll("participants");
    const dl = $("#dlPeserta");
    dl.innerHTML = list
      .filter(p=>p.is_active!==false)
      .map(p=>`<option value="${p.nik}">${escapeHtml(p.nama)} (${p.divisi||""} ${p.unit||""})</option>`)
      .join("");

    const pel = await IDB.getAll("masterViolations");
    const sel = $("#selPelanggaran");
    sel.innerHTML = pel
      .sort((a,b)=> (a.kategori||"").localeCompare(b.kategori||"") || a.jenis.localeCompare(b.jenis))
      .map(v=>`<option value="${v.id}" data-poin="${v.poin}" data-jenis="${escapeHtml(v.jenis)}" data-kat="${escapeHtml(v.kategori||"")}">${escapeHtml(v.kategori||"Umum")} • ${escapeHtml(v.jenis)} (${v.poin})</option>`)
      .join("");
    sel.dispatchEvent(new Event("change"));

    const sanctions = await getSanctions();
    const selS = $("#selSanksi");
    selS.innerHTML = `<option value="">— pilih sanksi —</option>` + sanctions.map(s=>`<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");
  }

  function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

  // ====== Participant lookup ======
  async function resolveParticipant(inputValue){
    const q = String(inputValue||"").trim();
    if(!q) return null;

    // direct by NIK
    const direct = await IDB.get("participants", q);
    if(direct) return direct;

    // if user typed "nik - nama", take first token
    const m = q.match(/^(\d{6,})/);
    if(m){
      const by = await IDB.get("participants", m[1]);
      if(by) return by;
    }

    // fuzzy by name substring
    const all = await IDB.getAll("participants");
    const qq = q.toLowerCase();
    const hit = all.find(p=> String(p.nama||"").toLowerCase().includes(qq));
    return hit || null;
  }

  async function calcParticipantPoints30(nik){
    const all = await IDB.getAll("violations");
    const since = Date.now() - 30*24*3600*1000;
    const rows = all.filter(r=> r.nik===String(nik) && new Date(r.waktu).getTime() >= since);
    const total = rows.reduce((a,r)=> a + Number(r.poin||0), 0);
    return {total, count: rows.length};
  }

  async function updateAutoStatus(){
    const p = await resolveParticipant($("#inpPeserta").value);
    const info = $("#pesertaInfo");
    if(!p){
      info.textContent = "";
      $("#autoStatus").textContent = "—";
      $("#autoKonsekuensi").textContent = "—";
      $("#sanksiHint").textContent = "Isi peserta terlebih dahulu.";
      return;
    }
    info.textContent = `${p.nama} • ${p.program||"-"} • ${p.divisi||"-"} / ${p.unit||"-"} • ${p.region||"-"}`;

    const {total, count} = await calcParticipantPoints30(p.nik);
    const thr = pickThreshold(total);
    $("#autoStatus").textContent = thr.status;
    $("#autoKonsekuensi").textContent = `${total} poin (30 hari) • ${count} kejadian • ${thr.konsekuensi}`;

    const curPoin = Number($("#inpPoin").value||0);
    const nextTotal = total + curPoin;
    const nextThr = pickThreshold(nextTotal);

    const hint = (curPoin>=50 || nextTotal>=50)
      ? "Karena akumulasi/kejadian masuk ≥ 50 poin, sanksi wajib dipilih (minimal 1)."
      : "Sanksi opsional (poin < 50).";
    $("#sanksiHint").textContent = `Jika disimpan sekarang: total menjadi ${nextTotal} poin → status ${nextThr.status}. ${hint}`;
  }

  function wireInput(){
    const a = loadAuth();
    const isUser = a && a.role === "user";

    // tetap set waktu, tetap pasang listener dasar
    $("#inpWaktu").value = toLocalInputValue(now());
    const u = loadUser();
    if(u.petugas) $("#inpPetugas").value = u.petugas;

    // pasang listener form seperti biasa
    $("#inpPeserta").addEventListener("input", ()=> updateAutoStatus());
    $("#selPelanggaran").addEventListener("change", ()=>{
      const opt = $("#selPelanggaran").selectedOptions[0];
      const poin = Number(opt?.dataset?.poin || 0);
      $("#inpPoin").value = poin;
      $("#pelInfo").textContent = opt ? opt.textContent : "";
      updateAutoStatus();
    });
    $("#inpPoin").addEventListener("input", ()=> updateAutoStatus());

    $("#btnClearForm").addEventListener("click", ()=>{
      $("#inpPeserta").value="";
      $("#inpCatatan").value="";
      $("#selSanksi").value="";
      $("#inpWaktu").value = toLocalInputValue(now());
      $("#selPelanggaran").selectedIndex = 0;
      $("#selPelanggaran").dispatchEvent(new Event("change"));
      updateAutoStatus();
    });

    // tombol2 umum tetap hidup
    $("#btnExportCsv").addEventListener("click", exportCsv);
    $("#btnClearLocal").addEventListener("click", clearLocal);

    // khusus simpan: admin saja
    if(isUser){
      $("#btnSave").disabled = true;
      $("#btnSave").style.opacity = "0.6";
      $("#btnSave").title = "Mode user: tidak bisa input pelanggaran.";
    }else{
      $("#btnSave").addEventListener("click", onSaveLocal);
    }
  }


  async function onSaveLocal(){
    const p = await resolveParticipant($("#inpPeserta").value);
    if(!p){
      toast("Peserta belum dipilih / tidak ditemukan.");
      return;
    }
    const pelId = $("#selPelanggaran").value;
    const pel = await IDB.get("masterViolations", pelId);
    if(!pel){
      toast("Master pelanggaran belum tersedia.");
      return;
    }
    const poin = Number($("#inpPoin").value||0);
    if(!Number.isFinite(poin) || poin<0){
      toast("Poin tidak valid.");
      return;
    }

    const waktuStr = $("#inpWaktu").value;
    const waktu = waktuStr ? new Date(waktuStr) : now();
    if(Number.isNaN(waktu.getTime())){
      toast("Tanggal/Jam tidak valid.");
      return;
    }

    const petugas = String($("#inpPetugas").value||"").trim();
    if(!petugas){
      toast("Isi nama petugas.");
      return;
    }
    saveUser({petugas});

    const sanksi = $("#selSanksi").value || "";
    const catatan = String($("#inpCatatan").value||"").trim();

    // status based on total points 30d including this record
    const before = await calcParticipantPoints30(p.nik);
    const afterTotal = before.total + poin;
    const thr = pickThreshold(afterTotal);

    // enforce sanction selection if current record itself is >=50 OR afterTotal >=50
    if((poin>=50 || afterTotal>=50) && !sanksi){
      toast("Poin ≥ 50: pilih salah satu sanksi terlebih dahulu.");
      return;
    }

    const rec = {
      id: uuid(),
      waktu: waktu.toISOString(),
      nik: String(p.nik),
      nama: p.nama,
      program: p.program || "",
      divisi: p.divisi || "",
      unit: p.unit || "",
      region: p.region || "",
      group: p.group || "",
      pelanggaran_id: pel.id,
      pelanggaran: pel.jenis,
      kategori: pel.kategori || "Umum",
      poin,
      status: thr.status,
      konsekuensi: thr.konsekuensi,
      sanksi,
      catatan,
      petugas,
      created_at: new Date().toISOString(),
      synced: false,
      synced_at: ""
    };

    await IDB.put("violations", rec);
    toast("Tersimpan di lokal ✅");
    $("#inpCatatan").value="";
    $("#selSanksi").value="";
    $("#inpWaktu").value = toLocalInputValue(now());
    await refreshRecent();
    await refreshDashboard(true);
    await renderQueueKpi();
  }

  async function getVisibleViolations(){
    const all = await IDB.getAll("violations");
    const a = loadAuth();
    if(a && a.role === "user"){
      const nik = String(a.nik || "").trim();
      return (all || []).filter(r=> String(r.nik) === nik);
    }
    return all || [];
  }

  // ====== Recent & Data tables ======
  async function refreshRecent(){
    const all = await getVisibleViolations();
    all.sort((a,b)=> new Date(b.waktu) - new Date(a.waktu));
    const recent = all.slice(0, 12);
    $("#tblRecent").innerHTML = recent.map(r=>{
      const sync = r.synced ? `<span class="badge ok">synced</span>` : `<span class="badge off">queue</span>`;
      return `<tr>
        <td>${fmtDate(new Date(r.waktu))}</td>
        <td>${escapeHtml(r.nik)}</td>
        <td>${escapeHtml(r.nama)}</td>
        <td>${escapeHtml(r.pelanggaran)}</td>
        <td><b>${Number(r.poin||0)}</b></td>
        <td>${escapeHtml(r.status||"")}</td>
        <td>${sync}</td>
      </tr>`;
    }).join("");
  }

  async function renderAll(){
    const q = String($("#inpFilter").value||"").trim().toLowerCase();
    const all = await getVisibleViolations();
    all.sort((a,b)=> new Date(b.waktu) - new Date(a.waktu));
    const rows = q ? all.filter(r=>
      String(r.nik).includes(q) ||
      String(r.nama||"").toLowerCase().includes(q) ||
      String(r.pelanggaran||"").toLowerCase().includes(q) ||
      String(r.petugas||"").toLowerCase().includes(q)
    ) : all;

    $("#tblAll").innerHTML = rows.map(r=>{
      const sync = r.synced ? `<span class="badge ok">synced</span>` : `<span class="badge off">queue</span>`;
      return `<tr>
        <td>${fmtDate(new Date(r.waktu))}</td>
        <td>${escapeHtml(r.nik)}</td>
        <td>${escapeHtml(r.nama)}</td>
        <td>${escapeHtml(r.pelanggaran)}</td>
        <td><b>${Number(r.poin||0)}</b></td>
        <td>${escapeHtml(r.petugas||"")}</td>
        <td>${escapeHtml(r.status||"")}</td>
        <td>${escapeHtml(r.sanksi||"")}</td>
        <td>${sync}</td>
      </tr>`;
    }).join("");
  }

  function wireDataTab(){
    $("#btnReloadData").addEventListener("click", renderAll);
    $("#inpFilter").addEventListener("input", ()=> {
      // debounce-ish
      clearTimeout(window.__fT);
      window.__fT = setTimeout(renderAll, 220);
    });
  }

  // ====== Dashboard ======
  let chartJenis;
  async function refreshDashboard(silent=false){
  const all = await getVisibleViolations();

  // KPI Hari ini (tetap fixed)
  const startToday = startOfDay(new Date());
  const todayRows = all
    .filter(r=> new Date(r.waktu).getTime() >= startToday.getTime())
    .sort((a,b)=> new Date(b.waktu) - new Date(a.waktu));

  $("#kpiToday").textContent = String(todayRows.length);
  $("#kpiTodaySub").textContent = todayRows.length
    ? `Terakhir: ${fmtDate(new Date(todayRows[0].waktu))}`
    : "—";

  // Range utama dashboard (mengikuti dropdown: today/7/30/custom)
  const { from, to, label } = getDashRange();
  const fromTs = from.getTime();
  const toTs   = to.getTime();

  const rowsRange = all.filter(r=>{
    const ts = new Date(r.waktu).getTime();
    return ts >= fromTs && ts < toTs;
  });

  // Total poin pada range
  const points = rowsRange.reduce((a,r)=> a + Number(r.poin||0), 0);
  $("#kpiPoints30").textContent = String(points);
  $("#kpiPoints30Sub").textContent = `Periode: ${label}`;

  // Total poin per peserta pada range
  const byNik = new Map();
  for(const r of rowsRange){
    byNik.set(r.nik, (byNik.get(r.nik)||0) + Number(r.poin||0));
  }

  // Peserta “bermasalah” pada range (≥50 poin)
  let risk = 0;
  for(const v of byNik.values()){
    if(v>=50) risk++;
  }
  $("#kpiRisk").textContent = String(risk);
  $("#kpiRiskSub").textContent = `Dari ${byNik.size} peserta yang punya catatan pada periode ini`;

  // Antrian sync (tetap)
  await renderQueueKpi();

  // Chart jenis (mengikuti range)
  const byJenis = new Map();
  for(const r of rowsRange){
    byJenis.set(r.pelanggaran, (byJenis.get(r.pelanggaran)||0)+1);
  }

  const labels = Array.from(byJenis.keys())
    .sort((a,b)=> (byJenis.get(b)||0) - (byJenis.get(a)||0))
    .slice(0,12);
  const vals = labels.map(l=> byJenis.get(l));

  $("#dashRange").textContent = `${label} • ${rowsRange.length} kejadian • ${labels.length} jenis teratas`;

  const canvas = $("#chartJenis");
  if(canvas){
    const ctx = canvas.getContext("2d");
    if(chartJenis) chartJenis.destroy();
    chartJenis = new Chart(ctx, {
      type: "bar",
      data: { labels, datasets: [{ label: "Jumlah kejadian", data: vals }]},
      options: {
        responsive:true,
        plugins:{ legend:{ display:false }},
        scales:{ x:{ ticks:{ color:"#a7b0c0" }}, y:{ ticks:{ color:"#a7b0c0" }}}
      }
    });
  }

  // Top 10 peserta (mengikuti range)
  const top = Array.from(byNik.entries())
    .sort((a,b)=> b[1]-a[1])
    .slice(0,10);

  $("#tblTop").innerHTML = top.map(([nik,total])=>{
    const thr = pickThreshold(total);
    const p = rowsRange.find(r=> r.nik===nik) || {};
    return `<tr>
      <td>${escapeHtml(nik)}</td>
      <td>${escapeHtml(p.nama||"")}</td>
      <td><b>${total}</b></td>
      <td>${escapeHtml(thr.status)}</td>
    </tr>`;
  }).join("");

  if(!silent) toast("Dashboard diperbarui.");
}

  async function renderQueueKpi(){
  // Jangan bergantung ke index boolean "synced" (lebih aman cross-browser)
    const all = await getVisibleViolations();

    // Queue = semua record yang BELUM benar-benar synced (true)
    const queue = (all || []).filter(r => r && r.synced !== true);

    $("#kpiQueue").textContent = String(queue.length);
    $("#kpiQueueSub").textContent = queue.length ? "Perlu Sync Up" : "Semua data sudah tersinkron";
  }


  // ====== CSV export ======
  async function exportCsv(){
    const all = await getVisibleViolations();
    all.sort((a,b)=> new Date(a.waktu)-new Date(b.waktu));
    const headers = ["waktu","nik","nama","program","divisi","unit","region","group","pelanggaran","kategori","poin","status","konsekuensi","sanksi","catatan","petugas","synced","synced_at","id"];
    const rows = [headers.join(",")].concat(all.map(r=>{
      return headers.map(h=> csvCell(r[h])).join(",");
    }));
    const blob = new Blob([rows.join("\n")], {type:"text/csv;charset=utf-8"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pelanggaran_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    setTimeout(()=> URL.revokeObjectURL(a.href), 8000);
  }
  function csvCell(v){
    const s = String(v ?? "");
    if(/[,"\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
    return s;
  }

  async function clearLocal(){
    if(!confirm("Hapus SEMUA data pelanggaran lokal? (Peserta & master tetap aman)")) return;
    await IDB.clear("violations");
    await refreshRecent();
    await renderAll();
    await refreshDashboard(true);
    toast("Data pelanggaran lokal dihapus.");
  }

  function jsonp(url, timeoutMs=20000){
    return new Promise((resolve, reject)=>{
      const cb = "__cb_" + Math.random().toString(16).slice(2);
      const u = new URL(url);
      u.searchParams.set("callback", cb);

      const s = document.createElement("script");
      let done = false;

      const timer = setTimeout(()=>{
        if(done) return;
        done = true;
        cleanup();
        reject(new Error("JSONP timeout"));
      }, timeoutMs);

      function cleanup(){
        clearTimeout(timer);
        try{ delete window[cb]; }catch(_){}
        if(s && s.parentNode) s.parentNode.removeChild(s);
      }

      window[cb] = (data)=>{
        if(done) return;
        done = true;
        cleanup();
        resolve(data);
      };

      s.onerror = ()=>{
        if(done) return;
        done = true;
        cleanup();
        reject(new Error("JSONP load error"));
      };

      s.src = u.toString();
      document.head.appendChild(s);
    });
  }

  // POST tanpa preflight & tanpa baca response (hindari CORS)
  async function postNoCors(url, payload){
    // text/plain = "simple request" -> tidak memicu OPTIONS preflight
    await fetch(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload || {})
    });
    return { ok:true }; // response opaque (tidak bisa dibaca)
  }


  // ====== GAS API ======
  async function gasFetch(action, payload=null, method=null){
    const cfg = loadCfg();
    if(!cfg.gasUrl) throw new Error("GAS URL belum diisi.");

    const url = new URL(cfg.gasUrl);
    url.searchParams.set("action", action);
    if(cfg.apiKey) url.searchParams.set("key", cfg.apiKey);

    // GET -> gunakan JSONP (bebas CORS)
    if(!payload && (!method || method === "GET")){
      const js = await jsonp(url.toString(), 25000);
      if(!js || js.ok === false) throw new Error((js && js.message) || "Gagal (JSONP).");
      return js;
    }

    // POST -> gunakan no-cors (hindari preflight CORS)
    if(payload && (!method || method === "POST")){
      await postNoCors(url.toString(), payload);
      return { ok:true }; // tidak ada ids karena opaque
    }

    // fallback
    const js = await jsonp(url.toString(), 25000);
    if(!js || js.ok === false) throw new Error((js && js.message) || "Gagal (fallback).");
    return js;
  }


  async function syncUp(){
    const a = loadAuth();
    if(a && a.role === "user") throw new Error("Mode user: tidak diizinkan sync.");
    const all = await IDB.getAll("violations");
    const queue = (all || []).filter(r => r && r.synced !== true);

    if(!queue.length){
      toast("Tidak ada antrian.");
      $("#syncInfo").textContent = "Tidak ada antrian yang perlu dikirim.";
      return;
    }

    $("#syncInfo").textContent = `Mengirim ${queue.length} data...`;

    // 1) Kirim (no-cors, tanpa baca response)
    await gasFetch("upsertViolations", { rows: queue }, "POST");

    // 2) Verifikasi dengan menarik log (JSONP GET) lalu cocokkan id
    $("#syncInfo").textContent = `Verifikasi ke Google Sheet...`;
    const js = await gasFetch("getViolations", null, "GET");
    const rows = (js && js.rows) || [];
    const idsOnSheet = new Set(rows.map(r => String(r.id || "").trim()).filter(Boolean));

    let updated = 0;
    for(const r of queue){
      if(r && idsOnSheet.has(String(r.id))){
        r.synced = true;
        r.synced_at = new Date().toISOString();
        await IDB.put("violations", r);
        updated++;
      }
    }

    $("#syncInfo").textContent = `Selesai: ${updated}/${queue.length} baris terkonfirmasi masuk Google Sheet.`;

    await refreshRecent();
    await renderAll();
    await refreshDashboard(true);
    await renderQueueKpi();

    toast("Sync Up selesai ✅");
  }

  function uniqBy(arr, keyFn){
    const m = new Map();
    for(const it of (arr||[])){
      const k = keyFn(it);
      if(!k) continue;
      if(!m.has(k)) m.set(k, it);
    }
    return Array.from(m.values());
  }

  function normNik(v){
    const s = String(v ?? "").trim();
    // boleh angka saja, minimal 6 digit (sesuai validasi Anda)
    if(!/^\d{6,}$/.test(s)) return "";
    return s;
  }

  function normId(v){
    const s = String(v ?? "").trim();
    return s ? s : "";
  }


  async function pullMaster(opts = {}){
    const a = loadAuth();
    // default: blok user (sesuai desain tab sync)
    // tapi kalau dipanggil dari login (auto pull), kita izinkan pakai opts.force = true
    if(!opts.force && a && a.role === "user") throw new Error("Mode user: tidak diizinkan pull.");

    const syncInfo = $("#syncInfo");
    if(syncInfo) syncInfo.textContent = "Mengambil master (peserta + pelanggaran)...";

    const js = await gasFetch("getMaster", null, "GET");

    // --- sanitize participants ---
    const rawPeserta = (js.participants || []).map(p => ({
      ...p,
      nik: normNik(p.nik),
      nama: String(p.nama ?? "").trim(),
    }));
    // buang nik kosong, dedupe by nik
    const peserta = uniqBy(rawPeserta.filter(p => p.nik), p => p.nik);

    // --- sanitize master violations ---
    const rawPel = (js.violations || []).map(v => ({
      ...v,
      id: normId(v.id),
      jenis: String(v.jenis ?? "").trim(),
      kategori: String(v.kategori ?? "Umum").trim(),
      poin: Number(v.poin || 0),
    }));
    // buang id kosong, dedupe by id
    const pel = uniqBy(rawPel.filter(v => v.id), v => v.id);

    // --- save to IDB (guard) ---
    try{
      if(peserta.length) await IDB.bulkPut("participants", peserta);
      if(pel.length) await IDB.bulkPut("masterViolations", pel);
      if(js.sanctions) await IDB.setMeta("sanctions", js.sanctions);
      if(js.thresholds) await IDB.setMeta("thresholds", js.thresholds);
    }catch(e){
      // kasih pesan jelas biar gampang debug
      throw new Error("Gagal simpan master ke database lokal: " + (e.message || e));
    }

    await renderMaster();

    if(syncInfo) syncInfo.textContent = `Master terisi: peserta ${peserta.length}, pelanggaran ${pel.length}.`;
    toast("Pull master selesai ✅");

    return { peserta: peserta.length, pelanggaran: pel.length };
  }


  async function pullLogs(){
    const a = loadAuth();
    if(a && a.role === "user") throw new Error("Mode user: tidak diizinkan pull.");
    $("#syncInfo").textContent = "Mengambil data pelanggaran dari Google Sheet...";
    const js = await gasFetch("getViolations");
    const rows = js.rows || [];
    // upsert to local, mark synced
    for(const r of rows){
      await IDB.put("violations", {...r, synced:true, synced_at: r.synced_at || r.updated_at || ""});
    }
    $("#syncInfo").textContent = `Tarik log selesai: ${rows.length} baris.`;
    await refreshRecent();
    await renderAll();
    await refreshDashboard(true);
    await renderQueueKpi();
    toast("Tarik data selesai ✅");
  }

  function wireSyncTab(){
    const cfg = loadCfg();
    const a = loadAuth();
    const isUser = a && a.role === "user";

    // ===== 1) Selalu tampilkan config (read-only) =====
    const gasEl = $("#inpGasUrl");
    const keyEl = $("#inpApiKey");
    if(gasEl){
      gasEl.value = cfg.gasUrl || "";
      gasEl.readOnly = true;
    }
    if(keyEl){
      keyEl.value = cfg.apiKey || "";
      keyEl.readOnly = true;
    }

    const btnSaveCfg = $("#btnSaveCfg");
    if(btnSaveCfg){
      btnSaveCfg.disabled = true;
      btnSaveCfg.style.opacity = "0.6";
      btnSaveCfg.title = "Config ditanam di app.js";
    }
    const cfgInfo = $("#cfgInfo");
    if(cfgInfo) cfgInfo.textContent = "Config ditanam di app.js (read-only).";

    // ===== util: lock / unlock button =====
    function lockBtn(btn, text){
      if(!btn) return;
      btn.dataset._locked = "1";
      btn.dataset._label = btn.textContent;
      btn.textContent = text || "⏳ Processing...";
      btn.disabled = true;
      btn.style.opacity = "0.7";
    }

    function unlockBtn(btn){
      if(!btn) return;
      btn.textContent = btn.dataset._label || btn.textContent;
      btn.disabled = false;
      btn.style.opacity = "1";
      delete btn.dataset._locked;
      delete btn.dataset._label;
    }

    async function safeRun(btn, fn, loadingText){
      console.log("BTN TAP:", btn?.id);
      if(!btn || btn.dataset._locked === "1") return;
      lockBtn(btn, loadingText);
      try{
        await fn();
      }catch(e){
        $("#syncInfo").textContent = "Gagal: " + e.message;
        toast("Gagal: " + e.message);
      }finally{
        unlockBtn(btn);
      }
    }

    function bindTap(btn, fn){
    if(!btn) return;

    const handler = (e)=>{
      // cegah “tap dianggap scroll” & cegah event dobel
      e.preventDefault?.();
      e.stopPropagation?.();
      fn();
    };

    // pointerup = paling stabil di HP (Android+iOS modern)
    btn.addEventListener("pointerup", handler, { passive:false });

    // fallback untuk browser lama
    btn.addEventListener("touchend", handler, { passive:false });

    // fallback umum desktop
    btn.addEventListener("click", handler);
  }


    // ===== tombol =====
    const btnSyncUp = $("#btnSyncUp");
    const btnPullMaster = $("#btnPullMaster");
    const btnPullLogs = $("#btnPullLogs");

    // ===== 2) Role gating: USER =====
    if(isUser){
      [btnSyncUp, btnPullMaster, btnPullLogs].forEach(btn=>{
        if(btn){
          btn.disabled = true;
          btn.style.opacity = "0.6";
        }
      });
      if(btnSyncUp) btnSyncUp.title = "Mode user: tidak diizinkan Sync";
      if(btnPullMaster) btnPullMaster.title = "Mode user: tidak diizinkan Pull Master";
      if(btnPullLogs) btnPullLogs.title = "Mode user: tidak diizinkan Pull Logs";

      const info = $("#syncInfo");
      if(info) info.textContent = "Mode user: sinkronisasi hanya dapat dilakukan oleh admin.";
      return;
    }

    // ===== 3) ADMIN: pasang handler dengan anti double-click =====
    if(btnSyncUp){
      bindTap(btnSyncUp, ()=>{
        safeRun(btnSyncUp, async ()=>{ await syncUp(); }, "⏳ Syncing...");
      });
    }

    if(btnPullMaster){
      bindTap(btnPullMaster, ()=>{
        safeRun(btnPullMaster, async ()=>{ await pullMaster(); }, "⏳ Pull Master...");
      });
    }


    if(btnPullLogs){
      bindTap(btnPullLogs, ()=>{
        safeRun(btnPullLogs, async ()=>{ await pullLogs(); }, "⏳ Pull Logs...");
      });
    }
  }


  // ====== QR ======
  let qr;
  function wireQr(){
    $("#btnScan").addEventListener("click", openQr);
    $("#btnCloseQr").addEventListener("click", closeQr);
    $("#qrModal").addEventListener("click", (e)=>{
      if(e.target.id==="qrModal") closeQr();
    });
  }

  async function openQr(){
    $("#qrModal").style.display = "flex";
    $("#qrReader").innerHTML = "";
    qr = new Html5Qrcode("qrReader");
    try{
      await qr.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        async (decodedText)=>{
          const nik = String(decodedText||"").trim();
          if(!/^\d{6,}$/.test(nik)){
            toast("QR tidak valid (harus NIK angka).");
            return;
          }
          $("#inpPeserta").value = nik;
          await updateAutoStatus();
          closeQr();
          toast("NIK terisi dari QR ✅");
        }
      );
    }catch(e){
      toast("Gagal akses kamera: " + (e.message||e));
    }
  }

  async function closeQr(){
    $("#qrModal").style.display = "none";
    if(qr){
      try{ await qr.stop(); }catch(_){}
      try{ await qr.clear(); }catch(_){}
      qr = null;
    }
  }

  // ====== PWA install ======
  function wireInstall(){
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (e)=>{
      e.preventDefault();
      deferredPrompt = e;
      $("#btnInstall").style.display = "inline-block";
    });
    $("#btnInstall").addEventListener("click", async ()=>{
      if(!deferredPrompt) return;
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      $("#btnInstall").style.display = "none";
    });
  }

  function applyRoleUI(){
    const a = loadAuth();

    // show logout when logged in
    const btnL = $("#btnLogout");
    if(btnL) btnL.style.display = a ? "inline-flex" : "none";

    // tabs visibility
    const tabs = $$(".tab");
    tabs.forEach(t=>{
      const tab = t.dataset.tab;
      // admin: semua
      if(!a){
        t.style.display = "inline-flex";
        return;
      }
      if(a.role === "admin"){
        t.style.display = "inline-flex";
        return;
      }
      // user: hanya dash + data
      t.style.display = (["dash","data"].includes(tab)) ? "inline-flex" : "none";
    });

    // if user, paksa aktifkan dashboard tab
    if(a && a.role === "user"){
      const dashBtn = $(`.tab[data-tab="dash"]`);
      if(dashBtn){
        $$(".tab").forEach(b=>b.classList.remove("active"));
        dashBtn.classList.add("active");
      }
      $$("main .panel").forEach(p=>p.style.display="none");
      $("#tab-dash").style.display = "block";
    }

    // Update subtitle / title hint (optional)
    const titleEl = document.querySelector(".subtitle");
    if(titleEl){
      if(!a) titleEl.textContent = "Offline-first • Login diperlukan";
      else if(a.role === "admin") titleEl.textContent = "Offline-first • Admin mode";
      else titleEl.textContent = `Offline-first • User mode (${a.nik})`;
    }
  }

  function resetLoginButton(){
    const btnLogin = $("#btnLogin");
    if(!btnLogin) return;

    btnLogin.disabled = false;
    btnLogin.style.opacity = "1";
    btnLogin.textContent = "Masuk";

    delete btnLogin.dataset._locked;
    delete btnLogin.dataset._label;
  }


  function openLogin(){
    const m = $("#loginModal");
    if(!m) return;
    m.style.display = "flex";
    $("#loginUser").value = "";
    $("#loginPass").value = "";
    $("#loginHint").textContent = "";
    resetLoginButton();
    setTimeout(()=> $("#loginUser")?.focus(), 50);
  }

  function closeLogin(){
    const m = $("#loginModal");
    if(!m) return;
    m.style.display = "none";
  }

  async function doLogin(){
    const u = String($("#loginUser").value||"").trim();
    const p = String($("#loginPass").value||"");

    const hintEl = $("#loginHint");
    const btnLogin = $("#btnLogin");

    // anti double-click (login)
    if(btnLogin && btnLogin.dataset._locked === "1") return;
    const lockLogin = (text)=>{
      if(!btnLogin) return;
      btnLogin.dataset._locked = "1";
      btnLogin.dataset._label = btnLogin.textContent;
      btnLogin.textContent = text || "⏳ Memproses...";
      btnLogin.disabled = true;
      btnLogin.style.opacity = "0.7";
    };
    const unlockLogin = ()=>{
      if(!btnLogin) return;
      btnLogin.textContent = btnLogin.dataset._label || "Masuk";
      btnLogin.disabled = false;
      btnLogin.style.opacity = "1";
      delete btnLogin.dataset._locked;
      delete btnLogin.dataset._label;
    };

    try{
      if(!u){
        if(hintEl) hintEl.textContent = "Username wajib diisi.";
        return;
      }

      // ===== ADMIN LOGIN =====
      if(u.toLowerCase() === "admin"){
        lockLogin("⏳ Login admin...");
        await ensureAdminHash();
        const stored = localStorage.getItem(ADMIN_HASH_KEY);
        const inputHash = await sha256(p);
        if(inputHash !== stored){
          if(hintEl) hintEl.textContent = "Password admin salah.";
          return;
        }
        saveAuth({ role:"admin", username:"admin", login_at:new Date().toISOString() });
        closeLogin();
        applyRoleUI();
        toast("Login admin ✅");
        await refreshDashboard(true);
        return;
      }

      // ===== USER LOGIN (NIK, password kosong) =====
      if(p && p.trim() !== ""){
        if(hintEl) hintEl.textContent = "Untuk user: password harus kosong.";
        return;
      }

      const nik = u;

      // 1) cek apakah NIK sudah ada di DB
      let part = await IDB.get("participants", nik);

      // 2) jika belum ada, coba AUTO PULL MASTER (tanpa perlu tombol)
      if(!part){
        if(!navigator.onLine){
          if(hintEl) hintEl.textContent = "NIK belum ada di perangkat. Silakan online sekali untuk tarik Master.";
          return;
        }

        lockLogin("⏳ Tarik Master...");
        if(hintEl) hintEl.textContent = "NIK belum ada. Mengambil Master dari Google Sheet...";

        // gunakan fungsi existing (boleh), karena saat ini belum login jadi tidak kena role-block
        await pullMaster({ force:true });

        // cek ulang
        part = await IDB.get("participants", nik);
        if(!part){
          if(hintEl) hintEl.textContent = "NIK tidak ditemukan di Master. Hubungi admin untuk update data peserta.";
          return;
        }
      }

      // 3) opsional cepat: kalau log lokal masih kosong, auto tarik logs sekali (supaya dashboard langsung ada data)
      //   (ini tetap minimal, tanpa ubah GAS. Memang menarik semua logs, tapi user view akan otomatis terfilter oleh getVisibleViolations)
      const localLogs = await IDB.getAll("violations");
      if((!localLogs || localLogs.length === 0) && navigator.onLine){
        lockLogin("⏳ Tarik Data...");
        if(hintEl) hintEl.textContent = "Master siap. Mengambil data pelanggaran dari Google Sheet (sekali)...";
        // Panggil langsung GAS agar tidak kena block role (karena belum saveAuth)
        const js = await gasFetch("getViolations", null, "GET");
        const rows = (js && js.rows) || [];
        for(const r of rows){
          await IDB.put("violations", { ...r, synced:true, synced_at: r.synced_at || r.updated_at || "" });
        }
      }

      // 4) login user
      lockLogin("⏳ Login user...");
      saveAuth({ role:"user", nik:String(nik), nama: part.nama || "", login_at:new Date().toISOString() });

      closeLogin();
      applyRoleUI();
      toast("Login user ✅");
      await refreshDashboard(true);

    }catch(err){
      console.error(err);
      if(hintEl) hintEl.textContent = "Gagal: " + (err.message || err);
      toast("Login gagal: " + (err.message || err));
    }finally{
      unlockLogin();
    }
  }

  async function logout(){
    clearAuth();
    applyRoleUI();
    openLogin();
    resetLoginButton();
  }


  // ====== Toast ======
  function toast(msg){
  let el = document.querySelector("#toast");
  if(!el){
    el = document.createElement("div");
    el.id = "toast";
    el.style.position = "fixed";
    el.style.right = "20px";
    el.style.bottom = "20px";
    el.style.background = "rgba(39,174,96,.95)";
    el.style.color = "#fff";
    el.style.padding = "14px 18px";
    el.style.borderRadius = "8px";
    el.style.boxShadow = "0 4px 6px rgba(0,0,0,.15)";
    el.style.zIndex = 1001;
    el.style.maxWidth = "92vw";
    el.style.fontWeight = "800";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = "block";
  el.style.opacity = "1";
  clearTimeout(window.__toastT);
  window.__toastT = setTimeout(()=>{
    el.style.opacity = "0";
    setTimeout(()=> el.style.display="none", 250);
  }, 2200);
  }


  // ====== boot ======
  async function boot(){
    netUI();
    window.addEventListener("online", netUI);
    window.addEventListener("offline", netUI);

    await ensureSeeded();
    // ===== LOGIN FIRST =====
    applyRoleUI();
    const a = loadAuth();
    if(!a){
      openLogin();
    }
    $("#btnLogin")?.addEventListener("click", ()=> doLogin().catch(err=> toast("Login gagal: " + err.message)));
    $("#loginPass")?.addEventListener("keydown", (e)=>{ if(e.key==="Enter") $("#btnLogin")?.click(); });
    $("#loginUser")?.addEventListener("keydown", (e)=>{ if(e.key==="Enter") $("#btnLogin")?.click(); });

    $("#btnLogout")?.addEventListener("click", ()=> logout().catch(()=>{}));
    $("#loginModal")?.addEventListener("click", (e)=>{ if(e.target.id==="loginModal"){} }); // no close on backdrop

    initTabs();
    // Dashboard period controls
    const dp = $("#dashPeriod");
    if(dp){
      const toggleCustom = ()=>{
        const isCustom = dp.value === "custom";
        $("#dashFrom").style.display = isCustom ? "inline-block" : "none";
        $("#dashTo").style.display = isCustom ? "inline-block" : "none";
      };
      dp.addEventListener("change", async ()=>{
        toggleCustom();
        await refreshDashboard(true);
      });
      $("#dashFrom")?.addEventListener("change", ()=> refreshDashboard(true));
      $("#dashTo")?.addEventListener("change", ()=> refreshDashboard(true));
      toggleCustom();
    }
    wireInstall();
    window.addEventListener("keydown", (e)=>{
      // Ctrl+Shift+P untuk ganti password admin
      if(e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")){
        changeAdminPassword().catch(()=>{});
      }
    });

    wireQr();
    wireDataTab();
    wireSyncTab();
    wireInput();

    await renderMaster();
    await refreshRecent();
    await refreshDashboard(true);

    $("#btnRefreshDash").addEventListener("click", ()=> refreshDashboard());
  }

  boot().catch(e=>{
    console.error(e);
    alert("Gagal start aplikasi: " + e.message);
  });
})();
