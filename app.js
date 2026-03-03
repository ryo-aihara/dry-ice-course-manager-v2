/* =========================================
   dry-ice-course-manager
   最終固定版ロジック
   - OCRなし
   - 便は分離（絶対合算しない）
   - CSV基準優先
   - 1週保持（週ID=月曜）
========================================= */

const $ = (q) => document.querySelector(q);
const $$ = (q) => Array.from(document.querySelectorAll(q));

/* ---------- DOM ---------- */

const els = {
  dateText: $("#dateText"),
  datePrev: $("#datePrev"),
  dateNext: $("#dateNext"),

  base25: $("#base25"),
  base30: $("#base30"),
  quick30: $("#quick30"),
  baseText: $("#baseText"),

  selectedCount: $("#selectedCount"),
  remainingCount: $("#remainingCount"),
  unassignedCount: $("#unassignedCount"),

  btnSave: $("#btnSave"),
  btnReset: $("#btnReset"),
  btnLoadCsv: $("#btnLoadCsv"),
  btnClearSelection: $("#btnClearSelection"),
  btnAddGroup: $("#btnAddGroup"),
  btnChecklist: $("#btnChecklist"),

  dotLoaded: $("#dotLoaded"),
  statusText: $("#statusText"),

  csvInput: $("#csvInput"),

  unassignedList: $("#unassignedList"),
  viewCards: $("#viewCards"),
  viewPaper: $("#viewPaper"),
  viewData: $("#viewData"),

  sumShime: $("#sumShime"),
  sumCut: $("#sumCut"),
  sumPieces: $("#sumPieces"),
  sumCases: $("#sumCases"),

  modal: $("#modal"),
  modalClose: $("#modalClose"),
  modalOk: $("#modalOk"),
  modalDelete: $("#modalDelete"),
  editCourse: $("#editCourse"),
  editBin: $("#editBin"),
  editShime: $("#editShime"),
  editCut: $("#editCut"),
  editWarn: $("#editWarn"),
};

/* ---------- Storage ---------- */

const STORAGE_KEY = "dryice_v2";
const WEEK_KEY = "dryice_weekId";

/* ---------- State ---------- */

const state = {
  date: new Date(),

  base: 30,          // UIでの基準
  csvBase: null,     // CSVで読んだ基準
  baseOverridden: false,

  loaded: false,
  saved: false,

  items: [],         // {id, course, bin, shime, cut, group, checked, selected}
  groups: ["A","B","C","D","E","+"]

};

/* ---------- Utils ---------- */

function pad2(n){
  return String(n).padStart(2,"0");
}

function fmtDate(d){
  return `${d.getFullYear()}/${pad2(d.getMonth()+1)}/${pad2(d.getDate())}`;
}

function startOfWeekMonday(d){
  const x = new Date(d);
  const day = x.getDay(); // 0=Sun
  const diff = (day === 0) ? -6 : (1 - day);
  x.setDate(x.getDate() + diff);
  x.setHours(0,0,0,0);
  return x;
}

function weekId(d){
  const m = startOfWeekMonday(d);
  return `${m.getFullYear()}-${pad2(m.getMonth()+1)}-${pad2(m.getDate())}`;
}

/* ---------- Base Logic ---------- */

function getEffectiveBase(){
  if (state.csvBase && !state.baseOverridden) {
    return state.csvBase;
  }
  return state.base;
}

function setBaseUI(){
  const base = getEffectiveBase();
  els.baseText.textContent = String(base);

  els.base25.classList.remove("active");
  els.base30.classList.remove("active");
  els.quick30.classList.remove("active");

  if (base === 25) {
    els.base25.classList.add("active");
  } else {
    els.base30.classList.add("active");
    els.quick30.classList.add("active");
  }
}

/* ---------- Totals ---------- */

function calcTotals(){
  const base = getEffectiveBase();

  let sumShime = 0;
  let sumCut = 0;

  state.items.forEach(it=>{
    sumShime += it.shime;
    sumCut += it.cut;
  });

  const pieces = (sumShime * base) + sumCut;
  const cases = pieces / base;

  return { base, sumShime, sumCut, pieces, cases };
}

function updateSummary(){
  const t = calcTotals();
  els.sumShime.textContent = t.sumShime;
  els.sumCut.textContent = t.sumCut;
  els.sumPieces.textContent = t.pieces;
  els.sumCases.textContent = t.cases.toFixed(2);
}

/* ---------- CSV Parsing ---------- */

function parseCSV(text){
  const lines = text
    .split(/\r?\n/)
    .map(s=>s.trim())
    .filter(Boolean);

  if (!lines.length) return { base:null, rows:[] };

  let base = null;
  let index = 0;

  // shime_size 行
  if (/^shime_size\s*,/i.test(lines[0])) {
    const parts = lines[0].split(",");
    const n = Number(parts[1]);
    if (n === 25 || n === 30) {
      base = n;
    }
    index = 1;
  }

  const header = (lines[index] || "").toLowerCase();
  index++;

  const cols = header.split(",").map(s=>s.trim());
  const rows = [];

  for (; index < lines.length; index++){
    const parts = lines[index].split(",").map(s=>s.trim());
    if (parts.length < 4) continue;

    const obj = {};
    cols.forEach((c,i)=> obj[c] = parts[i]);

    const course = String(obj.course || "").trim();
    const bin = Number(obj.bin);
    const shime = Number(obj.shime);
    const cut = Number(obj.cut);

    if (!course || !(bin === 1 || bin === 2)) continue;

    rows.push({
      course,
      bin,
      shime: Number.isFinite(shime) ? Math.max(0, Math.trunc(shime)) : 0,
      cut: Number.isFinite(cut) ? Math.max(0, Math.trunc(cut)) : 0
    });
  }

  return { base, rows };
}
/* ---------- Validation / Limits ---------- */

function cutLimitFor(base){
  return (base === 25) ? 24 : 29;
}

function validateItem(it){
  const base = getEffectiveBase();
  const lim = cutLimitFor(base);
  const warns = [];

  if (!/^\d+$/.test(String(it.course))) warns.push("courseが数値ではありません");
  if (!(it.bin === 1 || it.bin === 2)) warns.push("binは1か2のみ");
  if (!Number.isInteger(it.shime) || it.shime < 0) warns.push("shimeが不正");
  if (!Number.isInteger(it.cut) || it.cut < 0) warns.push("cutが不正");
  if (it.cut > lim) warns.push(`cut上限超え（${base}期は${lim}まで）`);

  // 同一 course×bin 重複警告
  const dup = state.items.filter(x => x.id !== it.id && x.course === it.course && x.bin === it.bin);
  if (dup.length) warns.push("同一 course×bin が重複しています");

  return warns;
}

/* ---------- Item Helpers ---------- */

function newId(){
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function setStatus(){
  els.dotLoaded.classList.toggle("on", state.loaded);
  els.statusText.textContent =
    `${state.loaded ? "読込済" : "未読込"}　${state.saved ? "保存済" : "未保存"}`;
}

function renderSelectedCount(){
  const n = state.items.filter(x => x.selected).length;
  els.selectedCount.textContent = String(n);
}

/* ---------- Render: Unassigned ---------- */

function renderUnassigned(){
  const list = state.items.filter(x => !x.group);
  els.unassignedCount.textContent = String(list.length);
  els.remainingCount.textContent = String(list.length);

  els.unassignedList.innerHTML = "";

  list.forEach(it=>{
    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="meta">
        <div class="title">
          ${it.course}
          <span class="badge">${it.bin}便</span>
          ${validateItem(it).length ? `<span class="badge warn">警告</span>` : ""}
        </div>
        <div class="sub">〆 ${it.shime} / cut ${it.cut}</div>
      </div>
      <div class="actions">
        <button class="btnMini" type="button" data-edit="${it.id}">編集</button>
        <button class="btnMini" type="button" data-select="${it.id}">
          ${it.selected ? "解除" : "選択"}
        </button>
      </div>
    `;
    els.unassignedList.appendChild(el);
  });
}

/* ---------- Render: Cards (Groups) ---------- */

function renderCards(){
  els.viewCards.innerHTML = "";

  // グループごとに箱を作る
  state.groups.forEach(g=>{
    const box = document.createElement("div");
    box.className = "card panel";
    box.style.marginTop = "10px";

    const items = state.items.filter(x => x.group === g);

    box.innerHTML = `
      <div class="panelHead">
        <h2>グループ ${g}</h2>
        <div class="chip"><b>${items.length}</b> 件</div>
      </div>
      <div class="list" id="list_${CSS.escape(g)}"></div>
    `;

    els.viewCards.appendChild(box);

    const listEl = box.querySelector(`#list_${CSS.escape(g)}`);
    items.forEach(it=>{
      const warns = validateItem(it);

      const row = document.createElement("div");
      row.className = "item";
      row.innerHTML = `
        <div class="meta">
          <div class="title">
            ${it.course}
            <span class="badge">${it.bin}便</span>
            ${warns.length ? `<span class="badge warn">警告</span>` : ""}
          </div>
          <div class="sub">〆 ${it.shime} / cut ${it.cut}</div>
        </div>
        <div class="actions">
          <button class="btnMini" type="button" data-back="${it.id}">戻す</button>
          <button class="btnMini" type="button" data-edit="${it.id}">編集</button>
        </div>
      `;

      listEl.appendChild(row);
    });
  });
}

/* ---------- Render: Paper ---------- */

function renderPaper(){
  // courseごとに1便/2便を同居表示
  const map = new Map(); // course -> {1:item,2:item}

  state.items
    .slice()
    .sort((a,b)=>Number(a.course)-Number(b.course) || a.bin-b.bin)
    .forEach(it=>{
      if (!map.has(it.course)) map.set(it.course, {});
      map.get(it.course)[it.bin] = it;
    });

  const paper = document.createElement("div");
  paper.className = "paper";

  const grid = document.createElement("div");
  grid.className = "paperGrid";

  Array.from(map.keys())
    .sort((a,b)=>Number(a)-Number(b))
    .forEach(course=>{
      const row = map.get(course);
      const it1 = row[1];
      const it2 = row[2];

      const cell = document.createElement("div");
      cell.className = "paperRow";
      cell.innerHTML = `
        <div><b>course ${course}</b></div>
        <div class="dataDim">1便：${it1 ? `〆${it1.shime} cut${it1.cut}` : "-"}</div>
        <div class="dataDim">2便：${it2 ? `〆${it2.shime} cut${it2.cut}` : "-"}</div>
        <div class="dataDim">チェック：${(it1?.checked || it2?.checked) ? "✔" : "-"}</div>
      `;
      grid.appendChild(cell);
    });

  paper.appendChild(grid);
  els.viewPaper.innerHTML = "";
  els.viewPaper.appendChild(paper);
}

/* ---------- Render: Data View ---------- */

function renderData(){
  const base = getEffectiveBase();
  const lim = cutLimitFor(base);
  const t = calcTotals();

  const lines = [];
  lines.push(`<span class="dataTag">DATA STREAM</span> <span class="dataDim">/ dry-ice-course-manager</span>`);
  lines.push(`<span class="dataDim">MODE:</span> <span class="dataOk">${base} MODE</span> ${state.baseOverridden ? `<span class="dataWarn">OVERRIDE</span>` : `<span class="dataDim">CSV PRIORITY</span>`}`);
  lines.push(`<span class="dataDim">TOTAL:</span> shime=${t.sumShime} cut=${t.sumCut} pieces=${t.pieces} (cut_limit=${lim})`);
  lines.push(`<span class="dataDim">---</span>`);

  state.items
    .slice()
    .sort((a,b)=>Number(a.course)-Number(b.course) || a.bin-b.bin)
    .forEach(it=>{
      const warn = validateItem(it);
      lines.push(
        `${warn.length ? `<span class="dataWarn">WARN</span>` : `<span class="dataOk">LIVE</span>`} `
        + `course=${it.course} bin=${it.bin} shime=${it.shime} cut=${it.cut} `
        + `${it.group ? `group=${it.group}` : `group=UNASSIGNED`}`
      );
    });

  const box = document.createElement("div");
  box.className = "dataView";
  box.innerHTML = lines.map(s=>`<div class="dataLine">${s}</div>`).join("");

  els.viewData.innerHTML = "";
  els.viewData.appendChild(box);
}

/* ---------- Render All ---------- */

function renderAll(){
  els.dateText.textContent = fmtDate(state.date);

  renderUnassigned();
  renderCards();
  renderPaper();
  renderData();
  renderSelectedCount();
  updateSummary();
}

/* ---------- CSV Load (Apply) ---------- */

function loadFromCSV(){
  const parsed = parseCSV(els.csvInput.value);

  state.csvBase = (parsed.base === 25 || parsed.base === 30) ? parsed.base : null;
  state.baseOverridden = false;

  state.items = parsed.rows.map(r=>({
    id: newId(),
    course: r.course,
    bin: r.bin,
    shime: r.shime,
    cut: r.cut,
    group: null,
    checked: false,
    selected: false
  }));

  state.loaded = true;
  state.saved = false;

  setStatus();
  setBaseUI();
  renderAll();
}
/* ---------- View Tabs ---------- */

function setView(name){
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.view === name));
  els.viewCards.classList.toggle("active", name === "cards");
  els.viewPaper.classList.toggle("active", name === "paper");
  els.viewData.classList.toggle("active", name === "data");
}

/* ---------- Move Selected ---------- */

function applyMoveSelected(group){
  const selected = state.items.filter(x => x.selected);
  if (!selected.length) return;

  selected.forEach(it=>{
    it.group = (group === "PLUS") ? "+" : group;
    it.selected = false;
  });

  state.saved = false;
  setStatus();
  renderAll();
}

/* ---------- Modal (Edit) ---------- */

let editingId = null;

function openModal(id){
  const it = state.items.find(x => x.id === id);
  if (!it) return;

  editingId = id;

  els.editCourse.value = it.course;
  els.editBin.value = String(it.bin);
  els.editShime.value = String(it.shime);
  els.editCut.value = String(it.cut);

  els.editWarn.hidden = true;
  els.modal.classList.add("show");
  els.modal.setAttribute("aria-hidden","false");
}

function closeModal(){
  editingId = null;
  els.modal.classList.remove("show");
  els.modal.setAttribute("aria-hidden","true");
}

function commitModal(){
  const it = state.items.find(x => x.id === editingId);
  if (!it) return;

  const next = {
    ...it,
    course: String(els.editCourse.value).trim(),
    bin: Number(els.editBin.value),
    shime: Math.max(0, Math.trunc(Number(els.editShime.value || 0))),
    cut: Math.max(0, Math.trunc(Number(els.editCut.value || 0))),
  };

  const warns = validateItem(next);
  if (warns.length){
    // 警告は出すが、思想として「修正可能」を優先して通す
    els.editWarn.hidden = false;
    els.editWarn.textContent = warns.join(" / ");
  } else {
    els.editWarn.hidden = true;
  }

  Object.assign(it, next);
  state.saved = false;
  setStatus();
  renderAll();
  closeModal();
}

function deleteModalItem(){
  const idx = state.items.findIndex(x => x.id === editingId);
  if (idx < 0) return;
  state.items.splice(idx, 1);

  state.saved = false;
  setStatus();
  renderAll();
  closeModal();
}

/* ---------- Weekly Reset ---------- */

function ensureWeeklyReset(){
  const current = weekId(new Date());
  const saved = localStorage.getItem(WEEK_KEY);

  if (saved && saved !== current){
    // 週が変わったら全削除（履歴は持たない）
    localStorage.removeItem(STORAGE_KEY);
  }
  localStorage.setItem(WEEK_KEY, current);
}

/* ---------- Save / Load (Mon-Fri) ---------- */

function getDayKey(){
  return fmtDate(state.date);
}

function saveToday(){
  const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  all[getDayKey()] = {
    date: getDayKey(),
    base: state.base,
    csvBase: state.csvBase,
    baseOverridden: state.baseOverridden,
    items: state.items,
    groups: state.groups
  };

  // 直近1週のみ保持（同一週IDだけ残す）
  const curWeek = weekId(state.date);
  const kept = {};

  Object.keys(all).forEach(k=>{
    const p = k.split("/");
    if (p.length !== 3) return;
    const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (weekId(d) === curWeek) kept[k] = all[k];
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));

  state.saved = true;
  setStatus();
}

function loadTodayIfExists(){
  const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  const data = all[getDayKey()];
  if (!data) return;

  state.base = data.base ?? 30;
  state.csvBase = data.csvBase ?? null;
  state.baseOverridden = !!data.baseOverridden;

  state.items = Array.isArray(data.items) ? data.items : [];
  state.groups = Array.isArray(data.groups) ? data.groups : ["A","B","C","D","E","+"];

  state.loaded = state.items.length > 0;
  state.saved = true;

  setStatus();
  setBaseUI();
  renderAll();
}

/* ---------- Wire Events (クリックが死なない核) ---------- */

function wireEvents(){
  // 日付
  els.datePrev.addEventListener("click", ()=>{
    state.date.setDate(state.date.getDate() - 1);
    loadTodayIfExists();
    renderAll();
  });

  els.dateNext.addEventListener("click", ()=>{
    state.date.setDate(state.date.getDate() + 1);
    loadTodayIfExists();
    renderAll();
  });

  // 25/30（手動上書き＝OVERRIDE）
  els.base25.addEventListener("click", ()=>{
    state.base = 25;
    state.baseOverridden = true;
    state.saved = false;
    setStatus();
    setBaseUI();
    renderAll();
  });

  els.base30.addEventListener("click", ()=>{
    state.base = 30;
    state.baseOverridden = true;
    state.saved = false;
    setStatus();
    setBaseUI();
    renderAll();
  });

  els.quick30.addEventListener("click", ()=>{
    state.base = 30;
    state.baseOverridden = true;
    state.saved = false;
    setStatus();
    setBaseUI();
    renderAll();
  });

  // Tabs
  $$(".tab").forEach(t=>{
    t.addEventListener("click", ()=> setView(t.dataset.view));
  });

  // 選択一括移動
  $$("[data-move]").forEach(btn=>{
    btn.addEventListener("click", ()=> applyMoveSelected(btn.dataset.move));
  });

  // CSV読み込み
  els.btnLoadCsv.addEventListener("click", loadFromCSV);

  // 選択解除
  els.btnClearSelection.addEventListener("click", ()=>{
    state.items.forEach(x=> x.selected = false);
    state.saved = false;
    setStatus();
    renderAll();
  });

  // グループ追加（+の直前へ）
  els.btnAddGroup.addEventListener("click", ()=>{
    const name = prompt("追加グループ名（例：F / G / 夜便 など）");
    if (!name) return;
    if (state.groups.includes(name)) return alert("同名グループは追加できません");

    state.groups.splice(state.groups.length - 1, 0, name);
    state.saved = false;
    setStatus();
    renderAll();
  });

  // 保存
  els.btnSave.addEventListener("click", saveToday);

  // リセット（今日だけ）
  els.btnReset.addEventListener("click", ()=>{
    const ok = confirm("今日のデータをリセットします。よろしいですか？");
    if (!ok) return;

    state.items = [];
    state.csvBase = null;
    state.baseOverridden = false;
    state.loaded = false;
    state.saved = false;

    setStatus();
    setBaseUI();
    renderAll();
  });

  // 目視チェック（簡易：全件反転）
  els.btnChecklist.addEventListener("click", ()=>{
    const ok = confirm("目視チェックを全件反転します。OK？");
    if (!ok) return;

    state.items.forEach(x=> x.checked = !x.checked);
    state.saved = false;
    setStatus();
    renderAll();
  });

  // モーダル
  els.modalClose.addEventListener("click", closeModal);
  els.modal.addEventListener("click", (e)=>{
    if (e.target === els.modal) closeModal();
  });
  els.modalOk.addEventListener("click", commitModal);
  els.modalDelete.addEventListener("click", deleteModalItem);

  // イベント委譲：編集/選択/戻す
  document.addEventListener("click", (e)=>{
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;

    const editId = t.getAttribute("data-edit");
    if (editId){
      openModal(editId);
      return;
    }

    const selId = t.getAttribute("data-select");
    if (selId){
      const it = state.items.find(x=> x.id === selId);
      if (!it) return;
      it.selected = !it.selected;
      state.saved = false;
      setStatus();
      renderAll();
      return;
    }

    const backId = t.getAttribute("data-back");
    if (backId){
      const it = state.items.find(x=> x.id === backId);
      if (!it) return;
      it.group = null;
      state.saved = false;
      setStatus();
      renderAll();
      return;
    }
  });
}

/* ---------- Init ---------- */

function init(){
  ensureWeeklyReset();

  els.dateText.textContent = fmtDate(state.date);

  // 既存ロード
  loadTodayIfExists();

  // 初期UI
  setBaseUI();
  setView("cards");
  setStatus();
  renderAll();

  // クリックが死なない核
  wireEvents();
}

init();
