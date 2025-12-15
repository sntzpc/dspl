/**
 * Minimal IndexedDB helper (no dependencies)
 * Stores:
 * - participants (key: nik as string)
 * - masterViolations (key: id)
 * - meta (key: k)
 * - violations (key: id)
 */
(function(){
  const DB_NAME = "tc_pelanggaran_db";
  const DB_VER  = 1;

  function openDB(){
    return new Promise((resolve, reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = ()=>{
        const db = req.result;

        if(!db.objectStoreNames.contains("participants")){
          const s = db.createObjectStore("participants", { keyPath: "nik" });
          s.createIndex("nama", "nama", { unique:false });
        }
        if(!db.objectStoreNames.contains("masterViolations")){
          const s = db.createObjectStore("masterViolations", { keyPath: "id" });
          s.createIndex("jenis", "jenis", { unique:false });
        }
        if(!db.objectStoreNames.contains("violations")){
          const s = db.createObjectStore("violations", { keyPath: "id" });
          s.createIndex("nik", "nik", { unique:false });
          s.createIndex("waktu", "waktu", { unique:false });
          s.createIndex("synced", "synced", { unique:false });
        }
        if(!db.objectStoreNames.contains("meta")){
          db.createObjectStore("meta", { keyPath: "k" });
        }
      };
      req.onsuccess = ()=> resolve(req.result);
      req.onerror = ()=> reject(req.error);
    });
  }

  async function tx(storeNames, mode, fn){
    const db = await openDB();
    return new Promise((resolve, reject)=>{
      const t = db.transaction(storeNames, mode);
      const stores = Array.isArray(storeNames)
        ? storeNames.map(n=>t.objectStore(n))
        : [t.objectStore(storeNames)];
      let out;
      t.oncomplete = ()=> resolve(out);
      t.onerror = ()=> reject(t.error);
      t.onabort = ()=> reject(t.error);
      out = fn(...stores);
    });
  }

  // ---- helpers ----
  function isValidKey(v){
    if (v === undefined || v === null) return false;
    if (typeof v === "number") return Number.isFinite(v);
    if (typeof v === "string") return v.trim().length > 0;
    if (v instanceof Date) return Number.isFinite(v.getTime());
    // we intentionally do not accept arrays/objects here to avoid DOMException
    return false;
  }

  function normalizeKey(v){
    if (v === undefined || v === null) return v;
    if (typeof v === "string") return v.trim();
    if (typeof v === "number") return v;
    if (v instanceof Date) return v.getTime();
    return v;
  }

  function makePrefixRange(prefix){
    const p = String(prefix ?? "").trim();
    if (!p) return null;
    // prefix match: [p, p + \uffff]
    return IDBKeyRange.bound(p, p + "\uffff", false, false);
  }

  const idb = {
    async put(store, obj){
      return tx(store, "readwrite", (s)=> s.put(obj));
    },

    async bulkPut(store, arr){
      return tx(store, "readwrite", (s)=> { (arr||[]).forEach(o=>s.put(o)); });
    },

    async get(store, key){
      const db = await openDB();
      return new Promise((resolve, reject)=>{
        const t = db.transaction(store, "readonly");
        const s = t.objectStore(store);
        const req = s.get(key);
        req.onsuccess = ()=> resolve(req.result || null);
        req.onerror = ()=> reject(req.error);
      });
    },

    async getAll(store){
      const db = await openDB();
      return new Promise((resolve, reject)=>{
        const t = db.transaction(store, "readonly");
        const s = t.objectStore(store);
        const req = s.getAll();
        req.onsuccess = ()=> resolve(req.result || []);
        req.onerror = ()=> reject(req.error);
      });
    },

    async delete(store, key){
      return tx(store, "readwrite", (s)=> s.delete(key));
    },

    async clear(store){
      return tx(store, "readwrite", (s)=> s.clear());
    },

    /**
     * queryIndex(store, indexName, valueOrOptions)
     * Backward compatible:
     *   - valueOrOptions can be a simple value -> exact match (old behavior)
     * New options:
     *   - { eq: "x" }            exact match
     *   - { prefix: "ab" }       prefix match (for string index)
     *   - { lower, upper }       range
     *   - { direction, limit }   cursor options
     */
    async queryIndex(store, indexName, valueOrOptions){
      const db = await openDB();

      // normalize options
      let opts = {};
      if (valueOrOptions && typeof valueOrOptions === "object" && !(valueOrOptions instanceof Date)) {
        opts = valueOrOptions;
      } else {
        opts = { eq: valueOrOptions };
      }

      return new Promise((resolve, reject)=>{
        const t = db.transaction(store, "readonly");
        const s = t.objectStore(store);

        let idx;
        try {
          idx = s.index(indexName);
        } catch (e) {
          // index missing -> return empty instead of crash
          resolve([]);
          return;
        }

        const direction = opts.direction || "next";
        const limit = Number.isFinite(opts.limit) ? opts.limit : null;

        let range = null;

        try {
          if (isValidKey(opts.eq)) {
            range = IDBKeyRange.only(normalizeKey(opts.eq));
          } else if (typeof opts.prefix === "string" && opts.prefix.trim() !== "") {
            range = makePrefixRange(opts.prefix);
          } else if (isValidKey(opts.lower) || isValidKey(opts.upper)) {
            const loOk = isValidKey(opts.lower);
            const upOk = isValidKey(opts.upper);
            if (loOk && upOk) range = IDBKeyRange.bound(normalizeKey(opts.lower), normalizeKey(opts.upper), false, false);
            else if (loOk) range = IDBKeyRange.lowerBound(normalizeKey(opts.lower), false);
            else if (upOk) range = IDBKeyRange.upperBound(normalizeKey(opts.upper), false);
          }
        } catch (e) {
          // range creation failed -> keep range null and fallback to "all"
          range = null;
        }

        // If range is null AND eq is invalid -> safest is return all (no filter)
        // But support limit using cursor.
        const out = [];
        const req = idx.openCursor(range, direction);

        req.onerror = ()=> {
          // last resort fallback: getAll() without filter
          try {
            const r2 = idx.getAll();
            r2.onsuccess = ()=> resolve(r2.result || []);
            r2.onerror = ()=> reject(r2.error);
          } catch (e) {
            reject(req.error || e);
          }
        };

        req.onsuccess = (ev)=>{
          const cur = ev.target.result;
          if (!cur) {
            resolve(out);
            return;
          }
          out.push(cur.value);
          if (limit && out.length >= limit) {
            resolve(out);
            return;
          }
          cur.continue();
        };
      });
    },

    async count(store){
      const db = await openDB();
      return new Promise((resolve, reject)=>{
        const t = db.transaction(store, "readonly");
        const s = t.objectStore(store);
        const req = s.count();
        req.onsuccess = ()=> resolve(req.result || 0);
        req.onerror = ()=> reject(req.error);
      });
    },

    async getMeta(k){
      const r = await this.get("meta", k);
      return r ? r.v : null;
    },

    async setMeta(k, v){
      return this.put("meta", {k, v});
    }
  };

  window.IDB = idb;
})();
