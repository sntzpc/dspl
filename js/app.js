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
        $$(".tab").forEach(b=>b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.tab;
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
    $("#inpWaktu").value = toLocalInputValue(now());
    const u = loadUser();
    if(u.petugas) $("#inpPetugas").value = u.petugas;

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

    $("#btnSave").addEventListener("click", onSaveLocal);
    $("#btnExportCsv").addEventListener("click", exportCsv);
    $("#btnClearLocal").addEventListener("click", clearLocal);
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

  // ====== Recent & Data tables ======
  async function refreshRecent(){
    const all = await IDB.getAll("violations");
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
    const all = await IDB.getAll("violations");
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
  const all = await IDB.getAll("violations");

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
    const queue = await IDB.queryIndex("violations", "synced", false);
    $("#kpiQueue").textContent = String(queue.length);
    $("#kpiQueueSub").textContent = queue.length ? "Perlu Sync Up" : "Semua data sudah tersinkron";
  }

  // ====== CSV export ======
  async function exportCsv(){
    const all = await IDB.getAll("violations");
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

  // ====== GAS API ======
  async function gasFetch(action, payload=null, method=null){
    const cfg = loadCfg();
    if(!cfg.gasUrl) throw new Error("GAS URL belum diisi.");
    const url = new URL(cfg.gasUrl);
    url.searchParams.set("action", action);
    if(cfg.apiKey) url.searchParams.set("key", cfg.apiKey);

    const opt = { method: method || (payload ? "POST" : "GET"), headers: {} };
    if(payload){
      opt.headers["Content-Type"]="application/json";
      opt.body = JSON.stringify(payload);
    }

    const res = await fetch(url.toString(), opt);
    const js = await res.json().catch(()=> ({}));
    if(!res.ok || js.ok===false){
      throw new Error(js.message || ("HTTP " + res.status));
    }
    return js;
  }

  async function syncUp(){
    const queue = await IDB.queryIndex("violations", "synced", false);
    if(!queue.length){
      toast("Tidak ada antrian.");
      return;
    }
    $("#syncInfo").textContent = `Mengirim ${queue.length} data...`;
    const payload = { rows: queue };
    const js = await gasFetch("upsertViolations", payload, "POST");
    const okIds = new Set(js.ids || []);
    for(const r of queue){
      if(okIds.has(r.id)){
        r.synced = true;
        r.synced_at = new Date().toISOString();
        await IDB.put("violations", r);
      }
    }
    $("#syncInfo").textContent = `Sukses: ${okIds.size}/${queue.length} data tersinkron.`;
    await refreshRecent();
    await renderAll();
    await refreshDashboard(true);
    await renderQueueKpi();
    toast("Sync Up selesai ✅");
  }

  async function pullMaster(){
    $("#syncInfo").textContent = "Mengambil master (peserta + pelanggaran)...";
    const js = await gasFetch("getMaster");
    const peserta = (js.participants || []).map(p=>({...p, nik:String(p.nik).trim()}));
    const pel = js.violations || [];
    if(peserta.length) await IDB.bulkPut("participants", peserta);
    if(pel.length) await IDB.bulkPut("masterViolations", pel);
    if(js.sanctions) await IDB.setMeta("sanctions", js.sanctions);
    if(js.thresholds) await IDB.setMeta("thresholds", js.thresholds);

    await renderMaster();
    $("#syncInfo").textContent = `Master terisi: peserta ${peserta.length}, pelanggaran ${pel.length}.`;
    toast("Pull master selesai ✅");
  }

  async function pullLogs(){
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
  // tampilkan saja (readonly) supaya user bisa melihat, tapi tidak perlu input
    const cfg = loadCfg();
    $("#inpGasUrl").value = cfg.gasUrl || "";
    $("#inpApiKey").value = cfg.apiKey || "";
    $("#inpGasUrl").readOnly = true;
    $("#inpApiKey").readOnly = true;

    // tombol simpan dinonaktifkan agar tidak membingungkan
    $("#btnSaveCfg").disabled = true;
    $("#btnSaveCfg").style.opacity = "0.6";
    $("#btnSaveCfg").title = "Config ditanam di app.js";
    $("#cfgInfo").textContent = "Config ditanam di app.js (read-only).";

    $("#btnSyncUp").addEventListener("click", async ()=>{
      try{ await syncUp(); }catch(e){ $("#syncInfo").textContent = "Gagal: " + e.message; toast("Gagal sync: " + e.message); }
    });
    $("#btnPullMaster").addEventListener("click", async ()=>{
      try{ await pullMaster(); }catch(e){ $("#syncInfo").textContent = "Gagal: " + e.message; toast("Gagal pull: " + e.message); }
    });
    $("#btnPullLogs").addEventListener("click", async ()=>{
      try{ await pullLogs(); }catch(e){ $("#syncInfo").textContent = "Gagal: " + e.message; toast("Gagal tarik: " + e.message); }
    });
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
