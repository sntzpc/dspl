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

  // ====== LOGIN RUN TOKEN (hindari tombol nyangkut / race logout) ======
    let __loginRunId = 0;

    // ====== LOGIN PROGRESS UI ======
    function setLoginProgress(step, total, msg){
      const hintEl = $("#loginHint");
      const wrap = $("#loginProgWrap");
      const bar  = $("#loginProgBar");

      const s = Number(step || 0);
      const t = Number(total || 0);

      if(hintEl){
        hintEl.textContent = t ? `${s}/${t} • ${msg || ""}` : String(msg || "");
      }
      if(wrap && bar && t){
        wrap.style.display = "block";
        const pct = Math.max(0, Math.min(100, Math.round((s / t) * 100)));
        bar.style.width = pct + "%";
      }else if(wrap){
        // kalau tidak pakai step/total, sembunyikan bar
        wrap.style.display = "none";
      }
    }

    function resetLoginProgress(){
      const hintEl = $("#loginHint");
      const wrap = $("#loginProgWrap");
      const bar  = $("#loginProgBar");
      if(hintEl) hintEl.textContent = "";
      if(wrap) wrap.style.display = "none";
      if(bar) bar.style.width = "0%";
    }

  // ====== HARD-CODE GAS CONFIG (tanam permanen) ======
  const HARD_GAS_URL = "https://script.google.com/macros/s/AKfycbzKcSqt2lrjQl5_9h6rT8ObjBfDRol9be1i0BjT6ZZdyDpn8KWCQ2lIZ7_NjbbDeshO/exec";
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

    const WARNING_MIN = 31;
      const WARNING_MAX = 49;
      const WARNING_SANCTION_TEXT = "Mencuci peralatan makan 1 hari";

      function isWarningPoints(total){
        const t = Number(total||0);
        return t >= WARNING_MIN && t <= WARNING_MAX;
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
        if(a.role === "user" && !["dash","data","sync","sanctions"].includes(tab)){
          toast("Akses dibatasi: hanya Dashboard, Data & Sinkronisasi untuk user.");
          return;
        }

        $$(".tab").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");

        $$("main .panel").forEach(p=>p.style.display="none");
        $("#tab-"+tab).style.display="block";

        if(tab==="dash") refreshDashboard();
        if(tab==="data") renderAll();
        if(tab==="input") refreshRecent();
        if(tab==="sanctions") renderSanctionsTab();
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
    /* multi-select: tidak pakai opsi kosong */
    selS.innerHTML = sanctions.map(s=>`<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");

  }

  function escapeHtml(s){ return String(s||"").replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m])); }
  function escapeAttr(s){ return escapeHtml(s).replace(/"/g,"&quot;"); }

  function getSelectedSanctions(){
    const sel = $("#selSanksi");
    if(!sel) return "";
    const vals = Array.from(sel.selectedOptions || []).map(o=> String(o.value||"").trim()).filter(Boolean);
    return vals.join(" | "); // simpan sebagai text gabungan
  }


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
      Array.from($("#selSanksi").options || []).forEach(o=> o.selected = false);
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

    const sanksi = getSelectedSanctions();
    const catatan = String($("#inpCatatan").value||"").trim();

    // status based on total points 30d including this record
    const before = await calcParticipantPoints30(p.nik);
    const afterTotal = before.total + poin;
    const thr = pickThreshold(afterTotal);

    // enforce sanction selection if current record itself is >=50 OR afterTotal >=50
    if((poin>=50 || afterTotal>=50) && !sanksi){
      toast("Poin ≥ 50: pilih minimal 1 sanksi terlebih dahulu (boleh lebih dari 1).");
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
    Array.from($("#selSanksi").options || []).forEach(o=> o.selected = false);
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

    // Peserta “warning” pada range (31–49 poin)
  let warn = 0;
  for(const v of byNik.values()){
    if(v >= WARNING_MIN && v < 50) warn++;
  }
  const elW = $("#kpiWarn");
  const elWS = $("#kpiWarnSub");
  if(elW) elW.textContent = String(warn);
  if(elWS) elWS.textContent = `Dari ${byNik.size} peserta yang punya catatan pada periode ini`;


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
      data: {
        labels,
        datasets: [{
          label: "Jumlah kejadian",
          data: vals,
          barThickness: 10,      // ✅ lebih kecil
          maxBarThickness: 12,   // ✅ batas maksimum
          categoryPercentage: 0.6, // ✅ jarak kategori lebih lega
          barPercentage: 0.6       // ✅ bar jadi ~60% dari slotnya
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false, // ✅ lebih enak di mobile
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: "#a7b0c0" } },
          y: { ticks: { color: "#a7b0c0" }, beginAtZero: true }
        }
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
    const a = loadAuth();
    const isUser = a && a.role === "user";
    const myNik = isUser ? String(a.nik||"").trim() : "";

    // 1) violations queue (user hanya miliknya)
    const vAll = await IDB.getAll("violations");
    let vRows = (vAll || []).filter(r => r && r.synced !== true);
    if(isUser) vRows = vRows.filter(r => String(r.nik||"").trim() === myNik);

    // 2) assignments queue (admin saja yang bisa kirim; user tidak punya queue assignment)
    const aAll = await IDB.getAll("sanction_assignments");
    const aRows = (aAll || []).filter(r => r && r.synced !== true);

    // 3) reports queue (user hanya miliknya)
    const rAll = await IDB.getAll("sanction_reports");
    let rRows = (rAll || []).filter(r => r && r.synced !== true);
    if(isUser) rRows = rRows.filter(r => String(r.nik||"").trim() === myNik);

    // Tampilkan ringkas
    const total = vRows.length + (isUser ? 0 : aRows.length) + rRows.length;
    $("#kpiQueue").textContent = String(total);

    const parts = [];
    if(!isUser) parts.push(`Pelanggaran:${vRows.length}`);
    if(!isUser) parts.push(`Sanksi:${aRows.length}`);
    parts.push(`Laporan:${rRows.length}`);

    $("#kpiQueueSub").textContent = total
      ? ("Perlu Sync • " + parts.join(" | "))
      : "Semua data sudah tersinkron";
  }

  async function openWarnModal(){
    const m = $("#warnModal");
    if(!m) return;

    // ✅ Ambil assignments terbaru kalau online (supaya status open/reported/done up to date)
    // Ini “realtime” dalam konteks aplikasi offline-first.
    await pullAssignmentsIfOnline_();

    const all = await getVisibleViolations();
    const { from, to, label } = getDashRange();
    const fromTs = from.getTime();
    const toTs   = to.getTime();

    const rowsRange = (all || []).filter(r=>{
      const ts = new Date(r.waktu).getTime();
      return ts >= fromTs && ts < toTs;
    });

    // aggregate by nik
    const map = new Map(); // nik -> {total, nama}
    for(const r of rowsRange){
      const nik = String(r.nik || "").trim();
      if(!nik) continue;
      if(!map.has(nik)){
        map.set(nik, { nik, nama: r.nama || "", total: 0 });
      }
      map.get(nik).total += Number(r.poin || 0);
    }

    const list = Array.from(map.values())
      .filter(x=> x.total >= WARNING_MIN && x.total < 50)
      .sort((a,b)=> b.total - a.total);

    $("#warnModalSub").textContent = `Periode: ${label} • ${list.length} peserta`;

    // ===== Ambil assignment dari IDB =====
    let asgRows = await IDB.getAll("sanction_assignments");
    asgRows = (asgRows || []).filter(a => a && a.nik);

    // jika role user, assignment di IDB biasanya sudah terfilter saat pull,
    // tapi aman juga untuk jaga-jaga:
    const auth = loadAuth();
    if(auth && auth.role === "user"){
      const myNik = String(auth.nik || "").trim();
      asgRows = asgRows.filter(a => String(a.nik || "").trim() === myNik);
    }

    $("#tblWarn").innerHTML = list.map(x=>{
      const thr = pickThreshold(x.total);

      // SP1 assignment kalau ada
      const sp1 = findSp1AssignmentForNik_(asgRows, x.nik);

      const sanksiTxt = sp1 ? (sp1.sanksi || WARNING_SANCTION_TEXT) : (WARNING_SANCTION_TEXT || "-");
      const asgBadge  = sp1 ? badgeAssignment_(sp1.status) : `<span class="badge">-</span>`;

      // ✅ klik NIK/Nama langsung preview SP1 (window baru) + tombol print ada di dalamnya
      const nikLink  = `<button class="btn ghost btnSp1Preview" data-nik="${escapeAttr(x.nik)}" data-nama="${escapeAttr(x.nama)}" data-total="${escapeAttr(x.total)}" style="padding:6px 10px">🔎 ${escapeHtml(x.nik)}</button>`;
      const namaLink = `<button class="btn ghost btnSp1Preview" data-nik="${escapeAttr(x.nik)}" data-nama="${escapeAttr(x.nama)}" data-total="${escapeAttr(x.total)}" style="padding:6px 10px">${escapeHtml(x.nama)}</button>`;

      return `<tr>
        <td>${nikLink}</td>
        <td>${namaLink}</td>
        <td><b>${x.total}</b></td>
        <td>${escapeHtml(thr.status || "Warning")}</td>
        <td>${escapeHtml(sanksiTxt || "-")}</td>
        <td>${asgBadge}</td>
        <td>
          <button class="btn ghost btnPrintSp1"
            data-nik="${escapeAttr(x.nik)}"
            data-nama="${escapeAttr(x.nama)}"
            data-total="${escapeAttr(x.total)}"
          >Cetak SP1</button>
        </td>
      </tr>`;
    }).join("");

    // bind actions (once per open)
    const tbl = $("#tblWarn");
    if(tbl && tbl.dataset._wired !== "1"){
      tbl.dataset._wired = "1";
      tbl.addEventListener("click", (e)=>{
        // klik peserta -> preview SP1
        const pv = e.target.closest("button.btnSp1Preview");
        if(pv){
          const nik = pv.getAttribute("data-nik");
          const nama = pv.getAttribute("data-nama");
          const total = Number(pv.getAttribute("data-total")||0);
          printSp1Letter_({ nik, nama, total, periodLabel: label });
          return;
        }

        // tombol cetak (tetap ada)
        const b = e.target.closest("button.btnPrintSp1");
        if(!b) return;
        const nik = b.getAttribute("data-nik");
        const nama = b.getAttribute("data-nama");
        const total = Number(b.getAttribute("data-total")||0);
        printSp1Letter_({ nik, nama, total, periodLabel: label });
      }, { passive:false });
    }

    m.style.display = "flex";
  }


  function closeWarnModal(){
    const m = $("#warnModal");
    if(m) m.style.display = "none";
  }


  async function openRiskModal(){
      const m = $("#riskModal");
      if(!m) return;

      const all = await getVisibleViolations();
      const { from, to, label } = getDashRange();
      const fromTs = from.getTime();
      const toTs   = to.getTime();

      // data pada range dashboard
      const rowsRange = (all || []).filter(r=>{
        const ts = new Date(r.waktu).getTime();
        return ts >= fromTs && ts < toTs;
      });

      // aggregate by nik
      const map = new Map(); // nik -> {total, nama, sanctions:Set}
      for(const r of rowsRange){
        const nik = String(r.nik || "").trim();
        if(!nik) continue;
        if(!map.has(nik)){
          map.set(nik, { nik, nama: r.nama || "", total: 0, sanctions: new Set() });
        }
        const obj = map.get(nik);
        obj.total += Number(r.poin || 0);

        // kumpulkan sanksi yang pernah diberikan
        const s = String(r.sanksi || "").trim();
        if(s) s.split("|").map(x=>x.trim()).filter(Boolean).forEach(x=> obj.sanctions.add(x));
      }

      // filter >=50, sort desc
      const list = Array.from(map.values())
        .filter(x=> x.total >= 50)
        .sort((a,b)=> b.total - a.total);

      $("#riskModalSub").textContent = `Periode: ${label} • ${list.length} peserta`;

      $("#tblRisk").innerHTML = list.map(x=>{
        const thr = pickThreshold(x.total);
        const sanctions = Array.from(x.sanctions).join(" ; ");
        return `<tr>
          <td>${escapeHtml(x.nik)}</td>
          <td>${escapeHtml(x.nama)}</td>
          <td><b>${x.total}</b></td>
          <td>${escapeHtml(thr.status)}</td>
          <td>${escapeHtml(sanctions || "-")}</td>
        </tr>`;
      }).join("");

      m.style.display = "flex";
    }

    function closeRiskModal(){
      const m = $("#riskModal");
      if(m) m.style.display = "none";
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

  async function resetAppData(){
  const ok = confirm(
    "INI AKAN MENGHAPUS DATA LOKAL KHUSUS APLIKASI INI:\n" +
    "- Database lokal (participants/master/violations/meta)\n" +
    "- Session login\n" +
    "- Cache PWA\n\n" +
    "Lanjutkan?"
  );
  if(!ok) return;

  try{
    // 1) clear IndexedDB stores aplikasi ini
    await IDB.clear("violations");
    await IDB.clear("participants");
    await IDB.clear("masterViolations");
    await IDB.clear("meta");

    // 2) hapus localStorage keys aplikasi ini
    const keysToRemove = [
      "tc.pelanggaran.cfg",
      "tc.pelanggaran.user",
      "tc.pelanggaran.installPrompt",
      "tc.pelanggaran.auth",
      "tc.pelanggaran.adminHash",
    ];
    keysToRemove.forEach(k=> localStorage.removeItem(k));

    // 3) hapus Cache Storage (PWA cache)
    if(window.caches && caches.keys){
      const ck = await caches.keys();
      await Promise.all(ck.map(name=> caches.delete(name)));
    }

    // 4) unregister service worker (jika ada)
    if(navigator.serviceWorker && navigator.serviceWorker.getRegistrations){
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=> r.unregister()));
    }

    toast("Data lokal aplikasi sudah dihapus. Reload...");
    setTimeout(()=> location.reload(), 600);
  }catch(e){
    console.error(e);
    toast("Gagal reset aplikasi: " + (e.message || e));
  }
}


  function jsonp(url, timeoutMs=25000){
    return new Promise((resolve, reject)=>{
      const cb = "__cb_" + Math.random().toString(16).slice(2);
      const u = new URL(url);

      u.searchParams.set("callback", cb);
      u.searchParams.set("_ts", String(Date.now()));

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

      // ✅ penting untuk Chrome Android
      s.async = true;
      s.type = "text/javascript";
      // HAPUS referrerPolicy no-referrer (kadang bikin Chrome “aneh” untuk script.google.com)
      // s.referrerPolicy = "no-referrer";
      s.crossOrigin = "anonymous";

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

  function postViaIframe(url, payload, timeoutMs=25000){
  return new Promise((resolve, reject)=>{
    const cb = "__postcb_" + Math.random().toString(16).slice(2);
    const u = new URL(url);
    u.searchParams.set("callback", cb);
    u.searchParams.set("_ts", String(Date.now()));

    let done = false;
    const timer = setTimeout(()=>{
      if(done) return;
      done = true;
      cleanup();
      reject(new Error("POST iframe timeout"));
    }, timeoutMs);

    function cleanup(){
      clearTimeout(timer);
      try{ delete window[cb]; }catch(_){}
      if(ifr && ifr.parentNode) ifr.parentNode.removeChild(ifr);
      if(frm && frm.parentNode) frm.parentNode.removeChild(frm);
    }

    window[cb] = (data)=>{
      if(done) return;
      done = true;
      cleanup();
      resolve(data);
    };

    const ifr = document.createElement("iframe");
    ifr.name = cb;
    ifr.style.display = "none";
    document.body.appendChild(ifr);

    const frm = document.createElement("form");
    frm.method = "POST";
    frm.action = u.toString();
    frm.target = cb;
    frm.style.display = "none";

    // kirim payload sebagai text/plain (seperti pola yang Bapak suka)
    const ta = document.createElement("textarea");
    ta.name = "payload"; // optional, tapi kita pakai body langsung via postData.contents? -> tidak
    // ⚠️ Apps Script WebApp membaca e.postData.contents dari body raw.
    // Form post default content-type: application/x-www-form-urlencoded
    // Jadi kita trik: kirim raw JSON lewat 1 field dan di GAS baca dari parameter kalau perlu.

    // Cara paling aman & sederhana: gunakan body JSON raw via fetch? tapi CORS.
    // Jadi kita lakukan: kirim field "contents" lalu GAS baca dari e.parameter.contents.
    ta.name = "contents";
    ta.value = JSON.stringify(payload || {});
    frm.appendChild(ta);

    document.body.appendChild(frm);

    // submit
    frm.submit();
  });
}

  async function warmUpGas(action="ping"){
      const cfg = loadCfg();
      const url = new URL(cfg.gasUrl);
      url.searchParams.set("action", action);
      if(cfg.apiKey) url.searchParams.set("key", cfg.apiKey);
      url.searchParams.set("_warm", String(Date.now()));

      // 1) fetch no-cors (cuma “nembak”, tidak baca response)
      try{
        await fetch(url.toString(), { mode:"no-cors", cache:"no-store" });
      }catch(_){}

      // 2) optional: iframe warm-up (kadang bantu Chrome yang suka redirect)
      try{
        await new Promise((res)=>{
          const ifr = document.createElement("iframe");
          ifr.style.display = "none";
          ifr.src = url.toString();
          document.body.appendChild(ifr);
          setTimeout(()=>{
            ifr.remove();
            res();
          }, 900);
        });
      }catch(_){}
    }


  // ====== GAS API ======
  async function gasFetch(action, payload=null, method=null){
    const cfg = loadCfg();
    if(!cfg.gasUrl) throw new Error("GAS URL belum diisi.");

    const url = new URL(cfg.gasUrl);

    // support action seperti: "getViolations&nik=123"
    const [act, qs] = String(action).split("&", 2);
    url.searchParams.set("action", act);

    if(qs){
      // masukkan sisa query yang sudah ada
      const rest = String(action).slice(String(act).length + 1); // setelah &
      rest.split("&").forEach(pair=>{
        const [k,v] = pair.split("=");
        if(k) url.searchParams.set(k, decodeURIComponent(v || ""));
      });
    }

    if(cfg.apiKey) url.searchParams.set("key", cfg.apiKey);

    // GET -> JSONP (bebas CORS) + retry untuk Chrome Android
    if(!payload && (!method || method === "GET")){
      try{
        const js = await jsonp(url.toString(), 25000);
        if(!js || js.ok === false) throw new Error((js && js.message) || "Gagal (JSONP).");
        return js;
      }catch(e){
        await warmUpGas(action);
        const js2 = await jsonp(url.toString(), 25000);
        if(!js2 || js2.ok === false) throw new Error((js2 && js2.message) || "Gagal (JSONP setelah warm-up).");
        return js2;
      }
    }

    // ✅ POST -> fetch no-cors (TIDAK kena X-Frame-Options karena bukan iframe)
      if(payload && (!method || method === "POST")){
        await postNoCors(url.toString(), payload);
        // response "opaque" tidak bisa dibaca, jadi konfirmasi dilakukan lewat GET (pull)
        return { ok:true, message:"sent(no-cors)" };
      }


    // fallback
    const js = await jsonp(url.toString(), 25000);
    if(!js || js.ok === false) throw new Error((js && js.message) || "Gagal (fallback).");
    return js;
  }


  async function testPing(){
    try{
      const js = await gasFetch("ping", null, "GET");
      toast("PING OK: " + (js.message || "pong"));
      console.log("PING RESPONSE:", js);
    }catch(e){
      toast("PING GAGAL: " + e.message);
      console.error("PING ERROR:", e);
    }
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

    // 1) KIRIM (no-cors, tidak baca response)
    await gasFetch("upsertViolations", { rows: queue }, "POST");

    // 2) KONFIRMASI: tarik ulang logs dari server (GET JSONP)
    $("#syncInfo").textContent = "Mengonfirmasi hasil (pull logs)...";
    await pullLogs(); // ini akan menimpa record server -> synced:true

    // 3) Hitung berapa yang benar-benar sudah synced setelah pull
    let updated = 0;
    for(const r of queue){
      const cur = await IDB.get("violations", r.id);
      if(cur && cur.synced === true) updated++;
    }

    $("#syncInfo").textContent = `Selesai: ${updated}/${queue.length} baris terkonfirmasi masuk ke Server.`;

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


  async function pullLogs(opts = {}){
  const a = loadAuth();
  const isUser = a && a.role === "user";
  const myNik = isUser ? String(a.nik || "").trim() : "";

  $("#syncInfo").textContent = "Mengambil data pelanggaran dari Google Sheet...";
  const action = (isUser && myNik) ? ("getViolations&nik=" + encodeURIComponent(myNik)) : "getViolations";
  const js = await gasFetch(action, null, "GET");
  let rows = (js && js.rows) || [];

  // ✅ IMPORTANT: jika user, simpan hanya data miliknya
  if(isUser){
    rows = rows.filter(r => String(r?.nik || "").trim() === myNik);
  }

  for(const r of rows){
    await IDB.put("violations", { ...r, synced:true, synced_at: r.synced_at || r.updated_at || "" });
  }

  $("#syncInfo").textContent = `Tarik data selesai: ${rows.length} baris.`;
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
      const info = $("#syncInfo");
      if(info) info.textContent = `Menjalankan: ${btn?.id || "-"} ...`;
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

      // hindari double binding kalau wireSyncTab kepanggil lagi
      if(btn.dataset._tapBound === "1") return;
      btn.dataset._tapBound = "1";

      // guard agar tidak double-run (karena kita pasang beberapa event)
      let lastRun = 0;

      const run = (e)=>{
        const nowTs = Date.now();
        if(nowTs - lastRun < 350) return; // anti double fire
        lastRun = nowTs;

        try{
          e?.preventDefault?.();
          e?.stopPropagation?.();
        }catch(_){}

        fn();
      };

      // 1) Paling kompatibel untuk tombol di HP/PWA
      btn.addEventListener("click", run, { passive:false });

      // 2) Tambahan: pointer & touch (optional)
      if(window.PointerEvent){
        btn.addEventListener("pointerup", run, { passive:false });
      }else{
        btn.addEventListener("touchend", run, { passive:false });
      }
    }




    // ===== tombol =====
    const btnSyncUp = $("#btnSyncUp");
    const btnPullMaster = $("#btnPullMaster");
    const btnPullLogs = $("#btnPullLogs");
    const btnResetApp = $("#btnResetApp");

    // ===== 2) Role gating: USER =====
    if(isUser){
      // user: hanya boleh Tarik Data Aktual + Reset Aplikasi
      if(btnSyncUp){
        // user boleh sync khusus laporan sanksi
        btnSyncUp.disabled = false;
        btnSyncUp.style.opacity = "1";
        btnSyncUp.title = "Kirim antrian laporan sanksi Anda";
        btnSyncUp.textContent = "Kirim Laporan (Queue)";

        bindTap(btnSyncUp, ()=>{
          safeRun(btnSyncUp, async ()=>{ await syncUpReportsOnly_(); }, "⏳ Mengirim...");
        });
      }
      if(btnPullMaster){
        btnPullMaster.disabled = true;
        btnPullMaster.style.opacity = "0.6";
        btnPullMaster.title = "Mode user: tidak diizinkan Tarik Master";
      }

      // ✅ boleh tarik data aktual
      if(btnPullLogs){
        btnPullLogs.disabled = false;
        btnPullLogs.style.opacity = "1";
        btnPullLogs.title = "Tarik data pelanggaran (hanya data NIK Anda)";
        bindTap(btnPullLogs, ()=>{
          safeRun(btnPullLogs, async ()=>{ await pullLogs(); }, "⏳ Pull Data...");
        });
      }

      // ✅ boleh reset aplikasi
      if(btnResetApp){
        btnResetApp.disabled = false;
        btnResetApp.style.opacity = "1";
        btnResetApp.title = "Hapus semua data lokal aplikasi ini";
        bindTap(btnResetApp, ()=>{
          safeRun(btnResetApp, async ()=>{ await resetAppData(); }, "⏳ Menghapus...");
        });
      }

      const info = $("#syncInfo");
      if(info) info.textContent = "Mode user: Anda bisa Tarik Data Aktual & Hapus Data Lokal aplikasi.";
      return;
    }


    // ===== 3) ADMIN: pasang handler dengan anti double-click =====
    if(btnSyncUp){
      bindTap(btnSyncUp, ()=>{
        safeRun(btnSyncUp, async ()=>{ await syncUpAll_(); }, "⏳ Sync All...");
      });
      // opsional: ubah label tombol
      btnSyncUp.textContent = "Sync Up (Semua)";
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

    if(btnResetApp){
      bindTap(btnResetApp, ()=>{
        safeRun(btnResetApp, async ()=>{ await resetAppData(); }, "⏳ Menghapus...");
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

      // user: dash + data + sync
      t.style.display = (["dash","data","sync","sanctions"].includes(tab)) ? "inline-flex" : "none";
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
    resetLoginProgress();
    resetLoginButton();
    setTimeout(()=> $("#loginUser")?.focus(), 50);
  }


  function closeLogin(){
    const m = $("#loginModal");
    if(!m) return;
    m.style.display = "none";
  }

  async function doLogin(){
    const runId = ++__loginRunId;

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

      // hanya boleh unlock kalau ini proses login terakhir (tidak dibatalkan logout)
      if(runId !== __loginRunId) return;

      btnLogin.textContent = btnLogin.dataset._label || "Masuk";
      btnLogin.disabled = false;
      btnLogin.style.opacity = "1";
      delete btnLogin.dataset._locked;
      delete btnLogin.dataset._label;
    };

    try{
      if(!u){
        resetLoginProgress();
        if(hintEl) hintEl.textContent = "Username wajib diisi.";
        return;
      }

      // ===== ADMIN LOGIN =====
      if(u.toLowerCase() === "admin"){
        lockLogin("⏳ Login admin...");
        setLoginProgress(1, 1, "Verifikasi admin...");
        await ensureAdminHash();
        const stored = localStorage.getItem(ADMIN_HASH_KEY);
        const inputHash = await sha256(p);
        if(inputHash !== stored){
          setLoginProgress(0, 0, "Password admin salah.");
          return;
        }
        saveAuth({ role:"admin", username:"admin", login_at:new Date().toISOString() });
        closeLogin();
        applyRoleUI();
        toast("Login admin ✅");
        await refreshDashboard(true);
        wireSyncTab();
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
        setLoginProgress(1, 3, "NIK belum ada. Mengambil Master dari Google Sheet...");
        await pullMaster({ force:true });

        // cek ulang
        part = await IDB.get("participants", nik);
        if(!part){
          setLoginProgress(0, 0, "NIK tidak ditemukan di Master. Hubungi admin untuk update data peserta.");
          return;
        }
      }

      // 3) opsional cepat: kalau log lokal masih kosong, auto tarik logs sekali (supaya dashboard langsung ada data)
      //   (ini tetap minimal, tanpa ubah GAS. Memang menarik semua logs, tapi user view akan otomatis terfilter oleh getVisibleViolations)
      const localLogs = await IDB.getAll("violations");
      if((!localLogs || localLogs.length === 0) && navigator.onLine){
        lockLogin("⏳ Tarik Data...");
        setLoginProgress(2, 3, "Master siap. Mengambil data pelanggaran (sekali)...");
        // Panggil langsung GAS agar tidak kena block role (karena belum saveAuth)
        const js = await gasFetch("getViolations", null, "GET");
        let rows = (js && js.rows) || [];

        // ✅ user hanya simpan data dirinya
        rows = rows.filter(r => String(r?.nik || "").trim() === String(nik).trim());

        for(const r of rows){
          await IDB.put("violations", { ...r, synced:true, synced_at: r.synced_at || r.updated_at || "" });
        }
      }

      // 4) login user
      lockLogin("⏳ Login user...");
      setLoginProgress(3, 3, "Menyiapkan sesi user...");
      saveAuth({ role:"user", nik:String(nik), nama: part.nama || "", login_at:new Date().toISOString() });

      closeLogin();
      applyRoleUI();
      toast("Login user ✅");
      await refreshDashboard(true);
      wireSyncTab();

    }catch(err){
      console.error(err);
      if(hintEl) hintEl.textContent = "Gagal: " + (err.message || err);
      toast("Login gagal: " + (err.message || err));
    }finally{
      unlockLogin();
      if(runId === __loginRunId){
        // jangan hapus hint kalau berisi error
        // tapi kalau sukses (modal tertutup), reset bar
        if($("#loginModal")?.style?.display !== "flex"){
          resetLoginProgress();
        }
      }

    }
  }

  async function logout(){
    __loginRunId++; // batalkan proses login yang sedang berjalan
    clearAuth();
    applyRoleUI();
    openLogin(); // sudah reset button + progress di dalamnya
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

    function printSp1Letter_({ nik, nama, total, periodLabel }){
    const nowD = new Date();
    const tanggal = nowD.toLocaleDateString("id-ID", { year:"numeric", month:"long", day:"2-digit" });

    const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Surat Peringatan 1 - ${nik}</title>
<style>
  body{ font-family: Arial, sans-serif; margin:24px; color:#111; }
  .wrap{ max-width:820px; margin:0 auto; }
  h1{ font-size:18px; text-align:center; margin:0 0 10px; }
  .meta{ margin:14px 0; line-height:1.5; }
  .box{ border:1px solid #ddd; padding:12px 14px; border-radius:10px; }
  .small{ font-size:12px; color:#333; }
  .mt{ margin-top:14px; }
  .sign{ margin-top:26px; }
  @media print{
    button{ display:none; }
    body{ margin:0; }
    .wrap{ max-width:100%; }
  }
</style>
</head>
<body>
<div class="wrap">
  <button onclick="window.print()">🖨️ Cetak</button>
  <h1>SURAT PERINGATAN 1 (SP1)</h1>
  <div class="small" style="text-align:center;">
    (Dibuat otomatis oleh Sistem Monitoring Pelanggaran Disiplin Training Center)
  </div>

  <div class="meta mt">
    Tanggal: <b>${tanggal}</b><br/>
    Periode akumulasi: <b>${escapeHtml(periodLabel || "30 hari terakhir")}</b>
  </div>

  <div class="box">
    Dengan ini diberikan Surat Peringatan 1 kepada peserta berikut:
    <div class="meta">
      NIK: <b>${escapeHtml(nik)}</b><br/>
      Nama: <b>${escapeHtml(nama)}</b><br/>
      Total poin: <b>${Number(total||0)}</b> (kategori <b>Warning</b>, 31–49 poin)
    </div>

    <div class="mt">
      Peserta diwajibkan meningkatkan disiplin dan kepatuhan terhadap ketentuan Training Center.
      SP1 ini diterbitkan otomatis berdasarkan akumulasi poin pelanggaran pada periode di atas.
    </div>

    <div class="mt">
      Sanksi yang berlaku untuk kategori Warning:
      <b>${escapeHtml(WARNING_SANCTION_TEXT)}</b>.
    </div>

    <div class="small mt">
      Catatan: Dokumen ini tidak memerlukan tanda tangan karena diterbitkan otomatis oleh sistem.
    </div>
  </div>

  <div class="sign small">
    Seriang Training Center
  </div>
</div>
</body>
</html>`;

    const w = window.open("", "_blank");
    if(!w){
      alert("Popup diblokir. Izinkan pop-up untuk mencetak SP1.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  function badgeAssignment_(st){
    const s = String(st || "open").toLowerCase();
    if(s === "done") return `<span class="badge ok">done</span>`;
    if(s === "reported") return `<span class="badge">reported</span>`;
    return `<span class="badge off">open</span>`;
  }

  function findSp1AssignmentForNik_(assignRows, nik){
    const idSp1 = "SP1_" + String(nik || "").trim();
    // prioritas: id SP1_*
    let hit = (assignRows || []).find(a => String(a.id || "").trim() === idSp1);
    if(hit) return hit;

    // fallback: note_admin ada AUTO_SP1
    hit = (assignRows || []).find(a =>
      String(a.nik || "").trim() === String(nik || "").trim() &&
      String(a.note_admin || "").includes("AUTO_SP1")
    );
    return hit || null;
  }

  async function setAssignmentStatusLocal_(assignmentId, status){
    const id = String(assignmentId || "").trim();
    if(!id) return;

    const asg = await IDB.get("sanction_assignments", id);
    if(!asg) return;

    const cur = String(asg.status || "open").toLowerCase();
    const next = String(status || "").toLowerCase();
    if(!next) return;

    // jangan turunkan status
    if(cur === "done") return;

    asg.status = next;
    asg.updated_at = new Date().toISOString();

    // biarkan synced tetap true (ini hanya untuk UI cepat)
    await IDB.put("sanction_assignments", asg);
  }

  // ====== SANCTIONS (Assignment + Report) ======
  let __currentAssignTarget = null;   // admin assign modal context
  let __currentReportTarget = null;   // user report modal context

  async function renderSanctionsTab(){
    const a = loadAuth();
    const isUser = a && a.role === "user";
    const isAdm  = a && a.role === "admin";

    // subtitle
    const sub = $("#sanctionsSub");
    if(sub){
      sub.textContent = isUser ? `Mode user (${a.nik}) • Menampilkan sanksi Anda` : "Mode admin • Menampilkan semua sanksi & laporan";
    }

    // show admin box
    const admBox = $("#adminSanctionsBox");
    if(admBox) admBox.style.display = isAdm ? "block" : "none";

    // render assignment list from local
    await pullAssignmentsIfOnline_();
    await renderAssignmentsTable_();

    // admin risk list based on dash range
    if(isAdm){
      await renderAdminRiskAssign_();
    }
  }

  async function pullAssignmentsIfOnline_(){
    // Tarik assignments dari server kalau online (admin: semua, user: nik sendiri)
    if(!navigator.onLine) return;

    const a = loadAuth();
    if(!a) return;

    try{
      const action = (a.role === "user")
        ? ("getAssignments&nik=" + encodeURIComponent(String(a.nik||"").trim()))
        : "getAssignments";

      const js = await gasFetch(action, null, "GET");
      const rows = (js && js.rows) || [];
      for(const r of rows){
        await IDB.put("sanction_assignments", normalizeAssignment_(r));
      }

      // laporan (opsional tampilkan untuk admin)
      const actionR = (a.role === "user")
        ? ("getReports&nik=" + encodeURIComponent(String(a.nik||"").trim()))
        : "getReports";

      const jsR = await gasFetch(actionR, null, "GET");
      const rep = (jsR && jsR.rows) || [];
      for(const rr of rep){
        await IDB.put("sanction_reports", { ...rr, synced:true, synced_at: rr.updated_at || "" });
      }
    }catch(e){
      console.warn("pullAssignmentsIfOnline failed:", e);
    }
  }

  function normalizeAssignment_(r){
    return {
      id: String(r.id || "").trim() || uuid(),
      nik: String(r.nik || "").trim(),
      nama: String(r.nama || "").trim(),
      sanksi: String(r.sanksi || "").trim(),
      note_admin: String(r.note_admin || "").trim(),
      status: String(r.status || "open").trim(),
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || "",

      // ✅ penting untuk konfirmasi
      synced: true,
      synced_at: r.updated_at || new Date().toISOString(),
    };
  }


  async function renderAssignmentsTable_(){
    const a = loadAuth();
    if(!a) return;

    const isUser = a.role === "user";
    const nikMe = isUser ? String(a.nik||"").trim() : "";

    let rows = await IDB.getAll("sanction_assignments");
    rows = (rows || []).filter(x=> x && x.nik);

    if(isUser){
      rows = rows.filter(x=> String(x.nik) === nikMe);
    }

    rows.sort((x,y)=> new Date(y.created_at) - new Date(x.created_at));

    $("#tblSanctions").innerHTML = rows.map(x=>{
      const st = (x.status || "open").toLowerCase();
      const badge = st === "done"
        ? `<span class="badge ok">done</span>`
        : (st === "reported" ? `<span class="badge">reported</span>` : `<span class="badge off">open</span>`);

      let aksi = "-";
      const isSp1 = String(x.note_admin || "").includes("AUTO_SP1");

      if(isUser){
        const btnPrint = isSp1
          ? `<button class="btn ghost btnPrintSp1Inline" data-nik="${escapeAttr(x.nik)}" data-nama="${escapeAttr(x.nama)}">Cetak SP1</button>`
          : "";

        if(st === "open"){
          aksi = `
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <button class="btn ghost btnReport" data-id="${escapeAttr(x.id)}">Laporkan</button>
              ${btnPrint}
            </div>`;
        }else if(st === "reported"){
          aksi = `
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <button class="btn ghost btnViewReport" data-id="${escapeAttr(x.id)}" title="Lihat laporan yang sudah Anda kirim">Lihat Laporan</button>
              ${btnPrint}
            </div>`;
        }else if(st === "done"){
          aksi = `
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <button class="btn ghost btnViewReport" data-id="${escapeAttr(x.id)}" title="Lihat laporan (sudah diverifikasi)">Lihat Laporan</button>
              ${btnPrint}
            </div>`;
        }
      }else{
        // admin
        const btnPrint = isSp1
          ? `<button class="btn ghost btnPrintSp1Inline" data-nik="${escapeAttr(x.nik)}" data-nama="${escapeAttr(x.nama)}">Cetak SP1</button>`
          : "";

        aksi = `
          <div class="row" style="gap:8px; flex-wrap:wrap">
            <button class="btn ghost btnViewReport" data-id="${escapeAttr(x.id)}">Lihat Laporan</button>
            ${btnPrint}
          </div>`;
      }

      return `<tr>
        <td>${fmtDate(new Date(x.created_at))}</td>
        <td>${escapeHtml(x.nik)}</td>
        <td>${escapeHtml(x.nama)}</td>
        <td>${escapeHtml(x.sanksi || "-")}${x.note_admin ? `<div class="muted small">${escapeHtml(x.note_admin)}</div>` : ""}</td>
        <td>${badge}</td>
        <td>${aksi}</td>
      </tr>`;
    }).join("");

    // bind action buttons (delegation)
    bindSanctionsActions_();
  }

  function bindSanctionsActions_(){
    const root = $("#tblSanctions");
    if(!root || root.dataset._wired === "1") return;
    root.dataset._wired = "1";

    root.addEventListener("click", async (e)=>{
      const btn = e.target.closest("button");
      if(!btn) return;
      if(btn.disabled) return;

      const id = btn.getAttribute("data-id");
      if(!id) return;

      if(btn.classList.contains("btnReport")){
        await openReportModal_(id);
      }
      if(btn.classList.contains("btnViewReport")){
        await openViewReport_(id);
      }
            if(btn.classList.contains("btnPrintSp1Inline")){
        // total poin diambil ulang dari dashboard-range supaya akurat
        const nik = btn.getAttribute("data-nik");
        const nama = btn.getAttribute("data-nama");

        const all = await getVisibleViolations();
        const { from, to, label } = getDashRange();
        const fromTs = from.getTime();
        const toTs   = to.getTime();

        const rowsRange = (all || []).filter(r=>{
          const ts = new Date(r.waktu).getTime();
          return ts >= fromTs && ts < toTs;
        });

        let total = 0;
        for(const r of rowsRange){
          if(String(r.nik||"").trim() === String(nik||"").trim()){
            total += Number(r.poin||0);
          }
        }

        printSp1Letter_({ nik, nama, total, periodLabel: label });
      }
    }, { passive:false });
  }

  async function renderAdminRiskAssign_(){
    // daftar peserta >=50 pada range dashboard (mengikuti dropdown dashboard)
    const all = await getVisibleViolations();
    const { from, to } = getDashRange();
    const fromTs = from.getTime();
    const toTs = to.getTime();

    const rowsRange = (all||[]).filter(r=>{
      const ts = new Date(r.waktu).getTime();
      return ts >= fromTs && ts < toTs;
    });

    const map = new Map();
    for(const r of rowsRange){
      const nik = String(r.nik||"").trim();
      if(!nik) continue;
      map.set(nik, (map.get(nik)||0) + Number(r.poin||0));
    }

    const list = Array.from(map.entries())
      .filter(([_, total])=> total >= 50)
      .sort((a,b)=> b[1]-a[1])
      .slice(0, 50);

    $("#tblAdminRiskAssign").innerHTML = list.map(([nik,total])=>{
      const thr = pickThreshold(total);
      const p = rowsRange.find(x=> String(x.nik)===String(nik)) || {};
      return `<tr>
        <td>${escapeHtml(nik)}</td>
        <td>${escapeHtml(p.nama||"")}</td>
        <td><b>${total}</b></td>
        <td>${escapeHtml(thr.status||"")}</td>
        <td><button class="btn btnAssign" data-nik="${escapeAttr(nik)}" data-nama="${escapeAttr(p.nama||"")}" data-total="${total}">Beri Sanksi</button></td>
      </tr>`;
    }).join("");

    // bind once
    const tbl = $("#tblAdminRiskAssign");
    if(tbl && tbl.dataset._wired !== "1"){
      tbl.dataset._wired = "1";
      tbl.addEventListener("click", async (e)=>{
        const b = e.target.closest("button.btnAssign");
        if(!b) return;
        const nik = b.getAttribute("data-nik");
        const nama = b.getAttribute("data-nama");
        const total = Number(b.getAttribute("data-total")||0);
        await openAssignModal_(nik, nama, total);
      }, { passive:false });
    }
  }

  async function openAssignModal_(nik, nama, totalPoin){
    if(!isAdmin()){
      toast("Hanya admin.");
      return;
    }
    __currentAssignTarget = { nik:String(nik||"").trim(), nama:String(nama||"").trim(), totalPoin:Number(totalPoin||0) };

    // isi select sanctions dari master sanctions
    const sanctions = await getSanctions();
    $("#assignSanksi").innerHTML = sanctions.map(s=>`<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join("");

    $("#assignNik").value = __currentAssignTarget.nik;
    $("#assignNama").value = __currentAssignTarget.nama;
    $("#assignSub").textContent = `Akumulasi poin periode dashboard: ${__currentAssignTarget.totalPoin}`;
    $("#assignNote").value = "";
    $("#assignInfo").textContent = "";
    Array.from($("#assignSanksi").options||[]).forEach(o=> o.selected=false);

    $("#assignModal").style.display = "flex";
  }

  function closeAssignModal_(){
    const m = $("#assignModal");
    if(m) m.style.display = "none";
    __currentAssignTarget = null;
  }

  function getMultiSelected_(selId){
    const sel = $(selId);
    const vals = Array.from(sel?.selectedOptions||[]).map(o=> String(o.value||"").trim()).filter(Boolean);
    return vals;
  }

  async function saveAssign_(){
    if(!isAdmin()) return;
    if(!__currentAssignTarget) return;

    const picks = getMultiSelected_("#assignSanksi");
    if(!picks.length){
      toast("Pilih minimal 1 sanksi.");
      return;
    }

    const note_admin = String($("#assignNote").value||"").trim();

    const rec = {
      id: uuid(),
      nik: __currentAssignTarget.nik,
      nama: __currentAssignTarget.nama,
      sanksi: picks.join(" | "),
      note_admin,
      status: "open",
      created_at: new Date().toISOString(),
      updated_at: "",
      synced: false,
      synced_at: ""
    };

    await IDB.put("sanction_assignments", rec);
    toast("Sanksi disimpan di lokal ✅");

    closeAssignModal_();
    await renderAssignmentsTable_();
    await renderQueueKpi(); // optional: tetap pakai KPI queue violations, tapi tidak masalah

    // kalau online, langsung kirim
    if(navigator.onLine){
      try{
        await syncUpAll_();
      }catch(_){}
    }
  }

  async function openReportModal_(assignmentId){
    const a = loadAuth();
    if(!a || a.role !== "user"){
      toast("Hanya user yang bisa lapor.");
      return;
    }

    const asg = await IDB.get("sanction_assignments", assignmentId);
    if(!asg){
      toast("Data sanksi tidak ditemukan.");
      return;
    }

    __currentReportTarget = asg;

    $("#reportSub").textContent = `${asg.nik} • ${asg.nama} • ${asg.sanksi}`;
    $("#reportNote").value = "";
    $("#reportBefore").value = "";
    $("#reportAfter").value = "";
    $("#beforeHint").textContent = "Belum dipilih";
    $("#afterHint").textContent = "Belum dipilih";
    $("#reportInfo").textContent = "";

    $("#reportModal").style.display = "flex";
  }

  function closeReportModal_(){
    const m = $("#reportModal");
    if(m) m.style.display = "none";
    __currentReportTarget = null;
  }

  async function openViewReport_(assignmentId){
    // Admin melihat laporan: cari report di store
    const a = loadAuth();
    if(!a){
      toast("Belum login.");
      return;
    }
    const reps = await IDB.queryIndex("sanction_reports", "assignment_id", { eq: assignmentId });
    const r = (reps||[]).sort((a,b)=> new Date(b.created_at)-new Date(a.created_at))[0];
    if(!r){
      toast("Belum ada laporan untuk sanksi ini.");
      return;
    }

    // tampilkan sederhana via alert (minimal perubahan UI)
    const msg =
      `LAPORAN:\n`+
      `NIK: ${r.nik}\n`+
      `Nama: ${r.nama}\n`+
      `Catatan: ${r.note_user || "-"}\n\n`+
      `Before: ${r.before_url}\n`+
      `After: ${r.after_url}\n`;

    alert(msg);
  }

  async function compressImageToDataUrl(file, maxW=1280, quality=0.75){
    // return dataURL jpeg
    const img = await new Promise((resolve, reject)=>{
      const i = new Image();
      i.onload = ()=> resolve(i);
      i.onerror = reject;
      i.src = URL.createObjectURL(file);
    });

    const ratio = Math.min(1, maxW / img.width);
    const w = Math.round(img.width * ratio);
    const h = Math.round(img.height * ratio);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    try{ URL.revokeObjectURL(img.src); }catch(_){}
    return dataUrl;
  }

  async function submitReport_(){
    const a = loadAuth();
    if(!a || a.role !== "user"){
      toast("Hanya user.");
      return;
    }
    if(!__currentReportTarget){
      toast("Context report hilang.");
      return;
    }

    // ✅ PATCH: anti double click + progress pada tombol kirim
    const btn = $("#btnSubmitReport");
    const lockBtn = (text)=>{
      if(!btn) return;
      if(btn.dataset._locked === "1") return; // sudah terkunci
      btn.dataset._locked = "1";
      btn.dataset._label = btn.textContent;
      btn.textContent = text || "⏳ Mengirim...";
      btn.disabled = true;
      btn.style.opacity = "0.7";
    };
    const unlockBtn = ()=>{
      if(!btn) return;
      btn.textContent = btn.dataset._label || "Kirim Laporan";
      btn.disabled = false;
      btn.style.opacity = "1";
      delete btn.dataset._locked;
      delete btn.dataset._label;
    };

    // kalau sudah terkunci, stop (hindari double click)
    if(btn && btn.dataset._locked === "1") return;

    const f1 = $("#reportBefore").files?.[0];
    const f2 = $("#reportAfter").files?.[0];
    if(!f1 || !f2){
      toast("Foto sebelum & sesudah wajib.");
      return;
    }

    try{
      lockBtn("⏳ Memproses...");

      $("#reportInfo").textContent = "1/4 • Memproses foto BEFORE...";
      const before_b64 = await compressImageToDataUrl(f1, 1280, 0.75);

      $("#reportInfo").textContent = "2/4 • Memproses foto AFTER...";
      const after_b64  = await compressImageToDataUrl(f2, 1280, 0.75);

      $("#reportInfo").textContent = "3/4 • Menyimpan antrian lokal...";
      const payload = {
        id: uuid(),
        assignment_id: __currentReportTarget.id,
        nik: __currentReportTarget.nik,
        nama: __currentReportTarget.nama,
        note_user: String($("#reportNote").value||"").trim(),
        before_b64,
        after_b64,
        created_at: new Date().toISOString()
      };

      // Simpan lokal queue dulu
      await IDB.put("sanction_reports", { ...payload, synced:false, synced_at:"" });
      toast("Laporan tersimpan di lokal ✅");
      await setAssignmentStatusLocal_(__currentReportTarget.id, "reported");

      // kirim kalau online
      if(navigator.onLine){
        try{
          lockBtn("⏳ Mengirim...");
          $("#reportInfo").textContent = "4/4 • Mengirim laporan ke server...";
          await gasFetch("submitSanctionReport", payload, "POST");

          $("#reportInfo").textContent = "Mengonfirmasi (pull laporan)...";
          await pullAssignmentsIfOnline_();
          await renderAssignmentsTable_();

          // Setelah pull, report dari server sudah masuk IDB (punya before_url/after_url)
          // Tandai synced untuk id ini (jika sudah ada)
          const cur = await IDB.get("sanction_reports", payload.id);
          if(cur){
            cur.synced = true;
            cur.synced_at = new Date().toISOString();
            await IDB.put("sanction_reports", cur);
          }

          $("#reportInfo").textContent = "Laporan terkirim ✅";
          toast("Laporan terkirim ✅");
        }catch(e){
          $("#reportInfo").textContent = "Gagal kirim (tetap tersimpan lokal): " + e.message;
          toast("Gagal kirim: " + e.message);
        }
      }else{
        $("#reportInfo").textContent = "Offline: laporan akan terkirim saat online & klik 'Kirim Laporan' (Queue).";
      }

      // Tutup modal + refresh tabel (agar tombol Laporkan jadi nonaktif jika status sudah reported)
      closeReportModal_();
      await renderAssignmentsTable_();
      await renderQueueKpi();

    }catch(e){
      console.error(e);
      $("#reportInfo").textContent = "Gagal: " + (e.message || e);
      toast("Gagal: " + (e.message || e));
    }finally{
      unlockBtn();
    }
  }


  async function syncUpReportsOnly_(){
    const a = loadAuth();
    if(!a || a.role !== "user") throw new Error("Hanya user.");
    if(!navigator.onLine) throw new Error("Offline. Nyalakan internet untuk kirim laporan.");

    const myNik = String(a.nik||"").trim();
    const allR = await IDB.getAll("sanction_reports");
    const queueR = (allR || []).filter(r => r && r.synced !== true && String(r.nik||"").trim() === myNik);

    if(!queueR.length){
      toast("Tidak ada antrian laporan.");
      $("#syncInfo").textContent = "Tidak ada antrian laporan yang perlu dikirim.";
      return;
    }

    $("#syncInfo").textContent = `Mengirim ${queueR.length} laporan...`;

    // Kirim satu-satu (payload besar karena foto)
    for(const r of queueR){
      try{
        await gasFetch("submitSanctionReport", r, "POST");
        // JANGAN langsung set synced=true di sini (POST no-cors tidak bisa dikonfirmasi)
        // Konfirmasi dilakukan setelah pull.
      }catch(e){
        console.warn("Kirim ulang report gagal:", e);
      }
    }

    $("#syncInfo").textContent = "Mengonfirmasi (pull laporan dari server)...";
    await pullAssignmentsIfOnline_(); // ini menarik reports juga
    await renderAssignmentsTable_();

    // Konfirmasi: jika report id sudah ada di server (ter-pull), tandai synced
    const afterPull = await IDB.getAll("sanction_reports");
    const serverIds = new Set((afterPull||[]).filter(x=> x && x.synced === true).map(x=> String(x.id)));

    let confirmed = 0;
    for(const r of queueR){
      if(serverIds.has(String(r.id))){
        const cur = await IDB.get("sanction_reports", r.id);
        if(cur){
          cur.synced = true;
          cur.synced_at = new Date().toISOString();
          await IDB.put("sanction_reports", cur);
        }
        confirmed++;
      }
    }

    $("#syncInfo").textContent = `Selesai: ${confirmed}/${queueR.length} laporan terkonfirmasi di server.`;
    await renderQueueKpi();
    toast("Sync laporan selesai ✅");
  }


  async function syncUpAll_(){
    // Kirim queue violations + assignments (admin) + reports (user/admin)
    // Pola baru:
    // - POST pakai no-cors (tidak bisa baca response)
    // - Konfirmasi hasil lewat GET JSONP (pull...)
    const a = loadAuth();
    if(!a) return;

    // =========================
    // 1) VIOLATIONS (admin saja)
    // =========================
    if(a.role === "admin"){
      // syncUp() juga sudah diubah: POST no-cors lalu konfirmasi via pullLogs()
      await syncUp();
    }

    // ==================================
    // 2) ASSIGNMENTS (admin saja)
    // ==================================
    if(a.role === "admin"){
      const allA = await IDB.getAll("sanction_assignments");
      const queueA = (allA || []).filter(r => r && r.synced !== true);

      if(queueA.length){
        // 2a) KIRIM (POST no-cors)
        await gasFetch("upsertAssignments", { rows: queueA }, "POST");

        // 2b) KONFIRMASI (pull dari server → akan menandai synced:true via normalizeAssignment_())
        await pullAssignmentsIfOnline_();

        // 2c) UPDATE lokal: set synced untuk yang sudah muncul/terkonfirmasi
        for(const r of queueA){
          const cur = await IDB.get("sanction_assignments", r.id);
          if(cur && cur.synced === true){
            // sudah benar dari server, aman
            continue;
          }
          // kalau belum terkonfirmasi (misal pull gagal), BIARKAN queue
        }
      }
    }

    // ==========================================
    // 3) REPORTS (user/admin) - submit ulang jika perlu
    // ==========================================
    // Karena submitSanctionReport dulu mengembalikan before_url/after_url,
    // sekarang POST no-cors tidak bisa baca response. Maka:
    // - tetap kirim ulang laporan yg queue
    // - lalu konfirmasi dengan pullAssignmentsIfOnline_() agar before_url/after_url terisi dari server
    const allR = await IDB.getAll("sanction_reports");
    const queueR = (allR || []).filter(r => r && r.synced !== true);

    if(queueR.length){
      // 3a) KIRIM ulang satu-satu (lebih aman karena payload besar)
      for(const r of queueR){
        try{
          await gasFetch("submitSanctionReport", r, "POST");

          // Tandai "terkirim" secara optimis.
          // Konfirmasi dan pengisian before_url/after_url dilakukan lewat pull.
          r.synced = true;
          r.synced_at = new Date().toISOString();
          await IDB.put("sanction_reports", r);
        }catch(e){
          // kalau gagal, biarkan tetap queue
          console.warn("Resend report failed:", e);
        }
      }

      // 3b) KONFIRMASI: tarik lagi assignments + reports dari server
      // - reports dari server punya before_url/after_url
      // - assignments status bisa berubah jadi "reported"
      if(navigator.onLine){
        await pullAssignmentsIfOnline_();
      }

      // 3c) Setelah pull, kita coba merge url ke record lokal (kalau server punya)
      // Catatan: pullAssignmentsIfOnline_() sudah put() semua reports dari server.
      // Jadi di sini cukup memastikan record queue yang sama sudah ada url-nya.
      for(const r of queueR){
        const cur = await IDB.get("sanction_reports", r.id);
        if(cur){
          // kalau sudah ada before_url/after_url dari server, biarkan
          continue;
        }
        // kalau belum ada (misal server generate id berbeda), maka minimal sudah "synced:true" optimis.
        // Anda bisa tambah logika matching by assignment_id + created_at jika ingin lebih presisi.
      }
    }

    // =========================
    // 4) Refresh UI (opsional)
    // =========================
    try{
      await renderAssignmentsTable_();
    }catch(_){}
    try{
      await renderQueueKpi();
    }catch(_){}
  }


  // ====== boot ======
  async function boot(){
    // ===== Helpers: bind once =====
    const __bindOnceMap = boot.__bindOnceMap || (boot.__bindOnceMap = new WeakMap());

    const bindOnce = (target, ev, fn, opt)=>{
      if(!target || !target.addEventListener) return;

      let reg = __bindOnceMap.get(target);
      if(!reg){
        reg = Object.create(null);
        __bindOnceMap.set(target, reg);
      }

      const key = String(ev);
      if(reg[key]) return;

      reg[key] = true;
      target.addEventListener(ev, fn, opt);
    };


    const clickOnce = (sel, fn)=>{
      bindOnce($(sel), "click", fn, { passive:false });
    };

    const onEnter = (sel, fn)=>{
      const el = $(sel);
      bindOnce(el, "keydown", (e)=>{
        if(e.key === "Enter"){
          e.preventDefault();
          fn();
        }
      });
    };

    // ===== Network badge =====
    netUI();
    bindOnce(window, "online", netUI);
    bindOnce(window, "offline", netUI);

    // ===== Seed (once) =====
    await ensureSeeded();

    // ===== Login first =====
    applyRoleUI();
    const a = loadAuth();
    if(!a) openLogin();

    // Login actions
    clickOnce("#btnLogin", ()=> doLogin().catch(err=> toast("Login gagal: " + (err.message || err))));
    onEnter("#loginUser", ()=> $("#btnLogin")?.click());
    onEnter("#loginPass", ()=> $("#btnLogin")?.click());

    // Logout
    clickOnce("#btnLogout", ()=> logout().catch(()=>{}));

    // Backdrop login: no close (tetap aman, tidak ngapa-ngapain)
    bindOnce($("#loginModal"), "click", (e)=>{
      if(e.target?.id === "loginModal"){
        // intentionally do nothing (no close on backdrop)
      }
    });

    // ===== Tabs =====
    initTabs();

    // ===== Dashboard period controls =====
    const dp = $("#dashPeriod");
    if(dp && dp.dataset._wired !== "1"){
      dp.dataset._wired = "1";

      const toggleCustom = ()=>{
        const isCustom = dp.value === "custom";
        const fromEl = $("#dashFrom");
        const toEl   = $("#dashTo");
        if(fromEl) fromEl.style.display = isCustom ? "inline-block" : "none";
        if(toEl)   toEl.style.display   = isCustom ? "inline-block" : "none";
      };

      bindOnce(dp, "change", async ()=>{
        toggleCustom();
        await refreshDashboard(true);
      });

      bindOnce($("#dashFrom"), "change", ()=> refreshDashboard(true));
      bindOnce($("#dashTo"), "change", ()=> refreshDashboard(true));

      toggleCustom();
    }

    // ===== Sanctions tab wiring =====
    clickOnce("#btnSanctionsRefresh", ()=> renderSanctionsTab().catch(e=> toast("Gagal: " + e.message)));

    clickOnce("#btnCloseAssign", ()=> closeAssignModal_());
    bindOnce($("#assignModal"), "click", (e)=>{ if(e.target?.id==="assignModal") closeAssignModal_(); });

    clickOnce("#btnSaveAssign", ()=> saveAssign_().catch(e=> toast("Gagal: " + e.message)));

    clickOnce("#btnCloseReport", ()=> closeReportModal_());
    bindOnce($("#reportModal"), "click", (e)=>{ if(e.target?.id==="reportModal") closeReportModal_(); });

    bindOnce($("#reportBefore"), "change", ()=> { $("#beforeHint").textContent = $("#reportBefore").files?.[0]?.name || "Belum dipilih"; });
    bindOnce($("#reportAfter"),  "change", ()=> { $("#afterHint").textContent  = $("#reportAfter").files?.[0]?.name  || "Belum dipilih"; });

    // ===== FIX: Jangan paksa kamera, izinkan pilih dari Galeri/Files di mobile =====
      (function forceGalleryPicker(){
        const beforeEl = $("#reportBefore");
        const afterEl  = $("#reportAfter");

        const patch = (el)=>{
          if(!el) return;

          // Hapus capture supaya tidak langsung buka kamera
          el.removeAttribute("capture");
          try{ el.capture = ""; }catch(_){}

          // Pastikan accept tetap image/*
          el.setAttribute("accept", "image/*");

          // optional: single file
          el.removeAttribute("multiple");
        };

        patch(beforeEl);
        patch(afterEl);
      })();


    clickOnce("#btnSubmitReport", ()=> submitReport_().catch(e=> toast("Gagal: " + e.message)));


    // ===== Install PWA =====
    wireInstall();

    // Hotkey admin change password
    bindOnce(window, "keydown", (e)=>{
      if(e.ctrlKey && e.shiftKey && (e.key === "P" || e.key === "p")){
        changeAdminPassword().catch(()=>{});
      }
    });

    // ===== Other wiring =====
    wireQr();
    wireDataTab();
    wireSyncTab();
    wireInput();

    // ===== Warning modal events =====
    clickOnce("#btnCloseWarn", ()=> closeWarnModal());
    bindOnce($("#warnModal"), "click", (e)=>{
      if(e.target?.id === "warnModal") closeWarnModal();
    });

    // ===== Klik kartu KPI Warning =====
    clickOnce("#cardWarn", ()=> openWarnModal().catch(()=>{}));


    // ===== Risk modal events =====
    clickOnce("#btnCloseRisk", ()=> closeRiskModal());
    bindOnce($("#riskModal"), "click", (e)=>{
      if(e.target?.id === "riskModal") closeRiskModal();
    });

    // ===== Klik kartu KPI Risk (pakai ID khusus) =====
    clickOnce("#cardRisk", ()=> openRiskModal().catch(()=>{}));
    // cursor sudah dari CSS .card.kpi-clickable, jadi tidak perlu set style via JS

    // ===== Initial render =====
    await renderMaster();
    await refreshRecent();
    await refreshDashboard(true);

    // Refresh dashboard button
    clickOnce("#btnRefreshDash", ()=> refreshDashboard());
  }


  boot().catch(e=>{
    console.error(e);
    alert("Gagal start aplikasi: " + e.message);
  });
})();
