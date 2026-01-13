// FXSport. Full JS.
// Ready ring: Yellow. Exercise ring: Green. Rest ring: Red.
// Progress bar gradient is handled in CSS (.progress__bar uses --accent-grad).
// If image missing, show big exercise name.
// If preset = Area 51, exclude group = full.
// End sound: plays once at the end. Final rest block is not created.
// Pause/Resume: Start resumes from paused second (does not restart the block).
// Tabata 6 exercises: 3 sets. Set1 uses (a,b), Set2 (c,d), Set3 (e,f).
// Each set: 4 rounds of (20s work a, 10s rest, 20s work b, 10s rest), last work has no rest.
// Between sets: 15s rest. Keep current Ready.

const RAW_SETTINGS =
  "https://wmprietopardo.github.io/fxsport/Documents/FXSport-Settings.csv";
const RAW_EXERCISES =
  "https://wmprietopardo.github.io/fxsport/Documents/FXSport-Exercises.csv";

const SPOTIFY_EMBED_URL =
  "https://open.spotify.com/embed/playlist/3X393B14lthT2jdYmC4TZA";
const SPOTIFY_PLAYLIST_URL =
  "https://open.spotify.com/playlist/3X393B14lthT2jdYmC4TZA";

const SFX_EXERCISE_START =
  "https://wmprietopardo.github.io/fxsport/Sounds/ready_go.wav";
const SFX_REST_START =
  "https://wmprietopardo.github.io/fxsport/Sounds/opening-bell.mp3";
const SFX_WORKOUT_END =
  "https://wmprietopardo.github.io/fxsport/Sounds/end_exersice.wav";

// Videos
const VIDEO_WARMUP_URL =
  "https://wmprietopardo.github.io/fxsport/Videos/calentamiento.mp4";
// Split stretch video parts
const VIDEO_STRETCH_1_URL =
  "https://wmprietopardo.github.io/fxsport/Videos/estiramiento1.MOV";
const VIDEO_STRETCH_2_URL =
  "https://wmprietopardo.github.io/fxsport/Videos/estiramiento2.MOV";

document.addEventListener("DOMContentLoaded", () => {
  // ... keep your other init code

  const stretch = $("vidStretch");
  if (stretch) {
    stretch.src = VIDEO_STRETCH_1_URL;

    // iPhone requires user gesture to start playback.
    // This only auto-plays part 2 AFTER part 1 was started by the user.
    stretch.addEventListener("ended", () => {
      // Swap to part 2 and play
      stretch.src = VIDEO_STRETCH_2_URL;
      stretch.load();

      const p = stretch.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    });
  }
});


// Ring colors
const RING_WORK = "#2cff8f";   // Exercise = Green
const RING_REST = "#ff3b3b";   // Rest = Red
const RING_READY = "#ffd54a";  // Ready = Yellow

// Tabata constants
const TABATA_WORK = 20;
const TABATA_REST = 10;
const TABATA_ROUNDS = 4; // per set
const TABATA_BETWEEN_SETS_REST = 15;

// State
let settings = [];
let exercises = [];
let plan = [];
let idx = 0;

let running = false;
let paused = false;
let pausedRemainingMs = 0;
let tickHandle = null;

let blockStartMs = 0;
let blockTotalMs = 0;
let blockEndMs = 0;

let preWorkCuePlayed = false;

const R = 52;
const CIRC = 2 * Math.PI * R;

let currentSetTimings = [];
let currentProgramKey = "custom";

// ---------- DOM helper
function $(id){ return document.getElementById(id); }

// ---------- Keep focus on timer (no scrolling)
function keepTimerFocus(){
  const t = $("timer");
  if(!t) return;
  try { t.focus({ preventScroll: true }); }
  catch(e) { try { t.focus(); } catch(e2) {} }
}

// ---------- Program key helper
function getPresetKey(){
  const v = $("presetSelect") ? $("presetSelect").value : "custom";
  currentProgramKey = v || currentProgramKey || "custom";
  return currentProgramKey;
}

// ---------- WebAudio
let audioCtx = null;
let masterGain = null;
let compressor = null;
let sfxBuffers = { work: null, rest: null, end: null };
let audioInitPromise = null;

function uiVolume(){
  const el = $("volume");
  const v = el ? Number(el.value) : 1;
  return Math.min(1, Math.max(0, isFinite(v) ? v : 1));
}
function setAudioStatus(t){
  const el = $("audioStatus");
  if(el) el.textContent = t;
}
async function fetchArrayBuffer(url){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`SFX HTTP ${res.status}`);
  return await res.arrayBuffer();
}
async function ensureAudioReady(){
  if(audioInitPromise) return audioInitPromise;

  audioInitPromise = (async () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) throw new Error("AudioContext not supported");

    audioCtx = new AC();
    await audioCtx.resume();

    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 30;
    compressor.ratio.value = 12;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    masterGain = audioCtx.createGain();
    compressor.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    const [abWork, abRest, abEnd] = await Promise.all([
      fetchArrayBuffer(SFX_EXERCISE_START),
      fetchArrayBuffer(SFX_REST_START),
      fetchArrayBuffer(SFX_WORKOUT_END),
    ]);

    sfxBuffers.work = await audioCtx.decodeAudioData(abWork.slice(0));
    sfxBuffers.rest = await audioCtx.decodeAudioData(abRest.slice(0));
    sfxBuffers.end  = await audioCtx.decodeAudioData(abEnd.slice(0));

    setAudioStatus("Sound enabled");
  })().catch(e => {
    audioInitPromise = null;
    setAudioStatus("Sound failed");
    throw e;
  });

  return audioInitPromise;
}
async function playBuffer(kind){
  const soundOn = $("soundOn");
  if(soundOn && !soundOn.checked) return;
  if(!audioCtx || !compressor) return;

  if(audioCtx.state !== "running"){
    try { await audioCtx.resume(); } catch(e) {}
  }

  const buf = sfxBuffers[kind];
  if(!buf) return;

  const src = audioCtx.createBufferSource();
  src.buffer = buf;

  const gain = audioCtx.createGain();
  gain.gain.value = uiVolume() * 4;

  src.connect(gain);
  gain.connect(compressor);
  src.start(0);
}

function sWorkStart(){ playBuffer("work"); }
function sRestStart(){ playBuffer("rest"); }
function sWorkoutEnd(){ playBuffer("end"); }

// ---------- Helpers
function pad2(n){ return String(n).padStart(2, "0"); }
function fmtTime(s){
  s = Math.max(0, Math.floor(s));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}
function norm(s){ return String(s || "").trim().toLowerCase(); }
function isEnabled(v){
  const s = norm(v);
  return s === "true" || s === "1" || s === "yes";
}
function getAnyField(row, candidates){
  const keys = Object.keys(row);
  for(const c of candidates){
    if(row[c] !== undefined) return row[c];
    const lower = c.toLowerCase();
    const matchKey = keys.find(k => k.toLowerCase() === lower);
    if(matchKey) return row[matchKey];
  }
  return "";
}
function parseCsv(text){
  const t = String(text || "").trim();
  if(!t) return [];

  const lines = t.split(/\r?\n/);
  const headerLine = lines.shift();

  const commaCount = (headerLine.match(/,/g) || []).length;
  const semiCount = (headerLine.match(/;/g) || []).length;
  const delim = semiCount > commaCount ? ";" : ",";

  const headers = headerLine.split(delim).map(h => h.trim().replace(/^"|"$/g, ""));

  return lines
    .filter(line => line.trim().length)
    .map(line => {
      const cols = line.split(new RegExp(`${delim}(?=(?:(?:[^"]*"){2})*[^"]*$)`));
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = (cols[i] ?? "").trim().replace(/^"|"$/g, "").replace(/""/g, '"');
      });
      return obj;
    });
}
function shuffle(arr){
  const a = arr.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function escapeHtml(s){
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
async function fetchText(url, label){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const text = await res.text();
  if(!text.includes("\n")) throw new Error(`${label} does not look like CSV`);
  return text;
}

// ---------- Ring
function initRing(){
  const prog = $("ringProg");
  if(!prog) return;
  prog.style.strokeDasharray = String(CIRC);
  prog.style.strokeDashoffset = String(CIRC);
}
function ringColorFor(type){
  if(type === "work") return RING_WORK;
  if(type === "ready") return RING_READY;
  return RING_REST;
}
function ringTypeForBlockType(t){
  if(t === "work") return "work";
  if(t === "ready") return "ready";
  return "rest";
}
function setRing(type, fraction){
  const prog = $("ringProg");
  if(!prog) return;

  prog.style.stroke = ringColorFor(type);

  const clamped = Math.min(1, Math.max(0, fraction));
  prog.style.strokeDashoffset = String(CIRC * (1 - clamped));
}

// ---------- Workout progress
function getTotalSessionSeconds(){
  return plan.reduce((sum, b) => sum + (b.seconds || 0), 0);
}
function updateWorkoutProgress(){
  if(!plan.length) return;

  const total = getTotalSessionSeconds();
  const doneFullBlocks = plan.slice(0, idx).reduce((sum, b) => sum + (b.seconds || 0), 0);

  const now = Date.now();
  const currentElapsed = running ? Math.min(blockTotalMs, Math.max(0, now - blockStartMs)) : 0;
  const done = doneFullBlocks + Math.floor(currentElapsed / 1000);

  const pctFloat = total ? Math.min(1, Math.max(0, done / total)) : 0;
  const pct = Math.round(pctFloat * 100);

  const bar = $("workoutBar");
  const pctEl = $("workoutPct");
  const remEl = $("workoutRemain");

  if(bar) bar.style.width = pct + "%";
  if(pctEl) pctEl.textContent = pct + "%";

  const remaining = Math.max(0, total - done);
  if(remEl) remEl.textContent = "Remaining: " + fmtTime(remaining);
}

// ---------- Exercise mapping + groups
function toExerciseRow(r){
  return {
    group: norm(getAnyField(r, ["group", "Group"])) || "full",
    name: getAnyField(r, ["name", "Name"]),
    how_to: getAnyField(r, ["how_to", "howTo", "How_to", "How To", "how"]),
    image: getAnyField(r, ["image", "Image", "image_url", "Image URL"]),
    enabled: isEnabled(getAnyField(r, ["enabled", "Enabled"]))
  };
}
function getEnabledExercises(){
  return exercises.map(toExerciseRow).filter(x => x.enabled && x.name);
}
function getGroupsFromData(rows){
  const set = new Set(rows.map(x => x.group).filter(Boolean));
  return Array.from(set).sort();
}
function getGroupsFromSettings(){
  if(!settings || !settings.length) return [];
  const groups = new Set();
  settings.forEach(r => {
    const g = norm(getAnyField(r, ["Group", "group", "Muscle", "Category"]));
    if(g) groups.add(g);
  });
  return Array.from(groups).sort();
}
function populateGroupSelect(groups){
  const select = $("groupSelect");
  if(!select) return;
  const keep = select.value || "any";

  select.innerHTML = `<option value="any">Any (balanced)</option>`;
  groups.forEach(g => { select.innerHTML += `<option value="${g}">${g}</option>`; });

  select.value = groups.includes(keep) ? keep : "any";
}

function pickBalancedUnique(N, rows){
  const byGroup = new Map();
  rows.forEach(ex => {
    if(!byGroup.has(ex.group)) byGroup.set(ex.group, []);
    byGroup.get(ex.group).push(ex);
  });

  for(const [g, list] of byGroup.entries()){
    byGroup.set(g, shuffle(list));
  }

  const preferred = ["upper", "legs", "core", "full"].filter(g => byGroup.has(g));
  const cycle = preferred.length ? preferred : Array.from(byGroup.keys());

  const picks = [];
  const used = new Set();

  function takeFrom(group){
    const list = byGroup.get(group) || [];
    while(list.length){
      const ex = list.shift();
      const key = `${ex.name}||${ex.group}`;
      if(used.has(key)) continue;
      used.add(key);
      return ex;
    }
    return null;
  }

  for(let i = 0; i < N; i++){
    const g = cycle[i % cycle.length];
    let ex = takeFrom(g);

    if(!ex){
      for(const alt of cycle){
        ex = takeFrom(alt);
        if(ex) break;
      }
    }

    if(!ex){
      for(const key of byGroup.keys()){
        ex = takeFrom(key);
        if(ex) break;
      }
    }

    if(!ex) break;
    picks.push(ex);
  }

  return picks;
}

function pickFromSingleGroupUnique(N, rows, group){
  const list = shuffle(rows.filter(x => x.group === group));
  const picks = [];
  const used = new Set();
  for(const ex of list){
    const key = `${ex.name}||${ex.group}`;
    if(used.has(key)) continue;
    used.add(key);
    picks.push(ex);
    if(picks.length >= N) break;
  }
  return picks;
}

function calcSuggestedSlotSeconds(totalMin, N, sets){
  const total = Math.max(1, Math.round(totalMin * 60));
  const slots = Math.max(1, N * sets);
  return Math.max(2, Math.round(total / slots));
}

// ---------- Tabata selection (deterministic AB / CD / EF)
function makeOrderedPairsAB_CD_EF(list6){
  if(list6.length !== 6) return null;

  const [a,b,c,d,e,f] = list6;

  const ok1 = !a.group || !b.group || a.group !== b.group;
  const ok2 = !c.group || !d.group || c.group !== d.group;
  const ok3 = !e.group || !f.group || e.group !== f.group;

  if(!ok1 || !ok2 || !ok3) return null;

  return [[a,b],[c,d],[e,f]];
}

function pickTabataSixBalancedWithPairConstraint(enabled){
  for(let attempt = 0; attempt < 80; attempt++){
    const six = pickBalancedUnique(6, enabled);
    if(six.length !== 6) continue;

    const pairs = makeOrderedPairsAB_CD_EF(six);
    if(pairs) return { six, pairs };
  }
  return null;
}

// ---------- Presets
function setInputs({ totalMin, n, sets, restDefault, readySec, group }){
  if(totalMin !== undefined && $("totalMin")) $("totalMin").value = String(totalMin);
  if(n !== undefined && $("n")) $("n").value = String(n);
  if(sets !== undefined && $("sets")) $("sets").value = String(sets);
  if(restDefault !== undefined && $("restDefault")) $("restDefault").value = String(restDefault);
  if(readySec !== undefined && $("readySec")) $("readySec").value = String(readySec);
  if(group !== undefined && $("groupSelect")) $("groupSelect").value = String(group);
}

function setTabataUiState(on){
  const groupSel = $("groupSelect");
  if(groupSel) groupSel.disabled = !!on;

  const setWrap = $("setTimings");
  if(setWrap && on){
    setWrap.innerHTML = `
      <div style="padding:10px 12px; border-radius:14px; border:1px solid rgba(255,255,255,0.10); background:rgba(0,0,0,0.18);">
        <div style="font-weight:1000; margin-bottom:6px;">Tabata timings (read only)</div>
        <div style="color:rgba(255,255,255,0.62); font-size:12px; line-height:1.35;">
          Work: ${TABATA_WORK}s. Rest: ${TABATA_REST}s. Rounds per set: ${TABATA_ROUNDS}.
          Between sets: ${TABATA_BETWEEN_SETS_REST}s.
        </div>
      </div>
    `;
  }
}

function applyPreset(key){
  currentProgramKey = key;

  const readyEl = $("readySec");
  const READY_DEFAULT = readyEl ? (Number(readyEl.value) || 15) : 15;

  const presets = {
    keops: {
      totalMin: 12, n: 4, sets: 3, readySec: READY_DEFAULT, restDefault: 30,
      setTimings: [{ slot:60, work:30, rest:30 }, { slot:60, work:35, rest:25 }, { slot:60, work:45, rest:15 }]
    },
    "30x30x4": {
      totalMin: 12, n: 4, sets: 3, readySec: READY_DEFAULT, restDefault: 30,
      setTimings: [{ slot:60, work:30, rest:30 }, { slot:60, work:30, rest:30 }, { slot:60, work:30, rest:30 }]
    },
    "30x30x6": {
      totalMin: 12, n: 6, sets: 2, readySec: READY_DEFAULT, restDefault: 30,
      setTimings: [{ slot:60, work:30, rest:30 }, { slot:60, work:30, rest:30 }]
    },
    cambalache: {
      totalMin: 12, n: 12, sets: 1, readySec: READY_DEFAULT, restDefault: 30,
      setTimings: [{ slot:90, work:60, rest:30 }]
    },
    area51: {
      totalMin: 12, n: 6, sets: 1, readySec: READY_DEFAULT, restDefault: 30,
      setTimings: [{ slot:120, work:90, rest:30 }]
    },
    tabata6: {
      totalMin: 8, n: 6, sets: 3, readySec: READY_DEFAULT, restDefault: 10, group: "any",
      setTimings: null
    }
  };

  const p = presets[key];
  if(!p) return;

  setInputs(p);

  if(key === "tabata6"){
    setTabataUiState(true);
    updateMetaPreview();
    const preset = $("presetSelect");
    if(preset) preset.value = key;
    return;
  }

  setTabataUiState(false);

  if(p.setTimings){
    currentSetTimings = p.setTimings.map(t => ({ slot: t.slot, work: t.work, rest: t.rest }));
    renderSetTimingInputs();
  }

  updateMetaPreview();

  const preset = $("presetSelect");
  if(preset) preset.value = key;
}

// ---------- Per-set timings UI (non-tabata)
function ensureSetTimings(sets, suggestedSlot, restDefault){
  const next = [];
  for(let s = 0; s < sets; s++){
    const prev = currentSetTimings[s];
    if(prev){
      const slot = Math.max(2, Number(prev.slot) || suggestedSlot);
      let work = Math.max(1, Number(prev.work) || 1);
      work = Math.min(slot, work);
      const rest = Math.max(0, slot - work);
      next.push({ slot, work, rest });
    } else {
      const slot = suggestedSlot;
      const rest = Math.min(slot - 1, Math.max(0, restDefault));
      const work = Math.max(1, slot - rest);
      next.push({ slot, work, rest: slot - work });
    }
  }
  currentSetTimings = next;
}

function renderSetTimingInputs(){
  const wrap = $("setTimings");
  if(!wrap) return;

  if(currentProgramKey === "tabata6"){
    setTabataUiState(true);
    return;
  }

  wrap.innerHTML = "";

  currentSetTimings.forEach((t, s) => {
    const row = document.createElement("div");
    row.style.display = "grid";
    row.style.gridTemplateColumns = "80px 1fr 1fr 1fr";
    row.style.gap = "8px";
    row.style.alignItems = "center";

    row.innerHTML = `
      <div style="font-weight:800;">Set ${s + 1}</div>
      <label style="display:grid; gap:4px;">
        <span style="font-size:12px; color:#aaa;">Slot</span>
        <input type="number" min="2" max="2400" value="${t.slot}" data-set="${s}" data-kind="slot" class="control" />
      </label>
      <label style="display:grid; gap:4px;">
        <span style="font-size:12px; color:#aaa;">Work</span>
        <input type="number" min="1" max="2400" value="${t.work}" data-set="${s}" data-kind="work" class="control" />
      </label>
      <label style="display:grid; gap:4px;">
        <span style="font-size:12px; color:#aaa;">Rest</span>
        <input type="number" min="0" max="2400" value="${t.rest}" data-set="${s}" data-kind="rest" class="control" />
      </label>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", () => {
      const preset = $("presetSelect");
      if(preset) preset.value = "custom";
      currentProgramKey = "custom";

      const s = Number(inp.dataset.set);
      const kind = inp.dataset.kind;

      const slotInp = wrap.querySelector(`input[data-set="${s}"][data-kind="slot"]`);
      const workInp = wrap.querySelector(`input[data-set="${s}"][data-kind="work"]`);
      const restInp = wrap.querySelector(`input[data-set="${s}"][data-kind="rest"]`);

      let slot = Math.max(2, Number(slotInp.value) || 2);
      let work = Math.max(1, Number(workInp.value) || 1);
      let rest = Math.max(0, Number(restInp.value) || 0);

      if(kind === "slot"){
        rest = Math.min(slot - 1, rest);
        work = Math.max(1, slot - rest);
      } else if(kind === "work"){
        work = Math.min(slot, Math.max(1, work));
        rest = Math.max(0, slot - work);
      } else {
        rest = Math.min(slot - 1, Math.max(0, rest));
        work = Math.max(1, slot - rest);
      }

      slotInp.value = String(slot);
      workInp.value = String(work);
      restInp.value = String(rest);

      currentSetTimings[s] = { slot, work, rest };
      updateMetaPreview();
    });
  });
}

function readSetTimings(){
  return currentSetTimings.map(t => ({
    slot: Math.max(2, Number(t.slot) || 2),
    work: Math.max(1, Number(t.work) || 1),
    rest: Math.max(0, Number(t.rest) || 0)
  }));
}

// ---------- Plan builders
function buildPlan({ N, sets, readySec, circuit, setTimings }){
  const blocks = [];

  if(readySec > 0){
    blocks.push({
      type: "ready",
      seconds: readySec,
      ex: { name: "Get ready", group: "", how_to: "Get into position.", image: "" },
      setIndex: -1,
      exIndex: -1,
      n: N,
      sets
    });
  }

  for(let s = 0; s < sets; s++){
    const { work, rest } = setTimings[s];
    for(let i = 0; i < circuit.length; i++){
      const ex = circuit[i];
      blocks.push({ type: "work", seconds: work, ex, setIndex: s, exIndex: i, n: N, sets });

      const isLastWorkBlock = (s === sets - 1) && (i === circuit.length - 1);
      if(!isLastWorkBlock){
        blocks.push({ type: "rest", seconds: rest, ex, setIndex: s, exIndex: i, n: N, sets });
      }
    }
  }
  return blocks;
}

function buildTabataPlan({ readySec, pairs }){
  // pairs: [[a,b],[c,d],[e,f]]
  const blocks = [];

  if(readySec > 0){
    blocks.push({
      type: "ready",
      seconds: readySec,
      ex: { name: "Get ready", group: "", how_to: "Get into position.", image: "" },
      setIndex: -1,
      exIndex: -1,
      n: 2,
      sets: 3
    });
  }

  for(let s = 0; s < 3; s++){
    const pair = pairs[s]; // [x,y]
    const a = pair[0];
    const b = pair[1];

    let workCount = 0;
    for(let r = 0; r < TABATA_ROUNDS; r++){
      // a
      blocks.push({ type: "work", seconds: TABATA_WORK, ex: a, setIndex: s, exIndex: workCount % 2, n: 2, sets: 3 });
      workCount++;
      blocks.push({ type: "rest", seconds: TABATA_REST, ex: a, setIndex: s, exIndex: workCount % 2, n: 2, sets: 3 });

      // b
      const isLastB = (r === TABATA_ROUNDS - 1);
      blocks.push({ type: "work", seconds: TABATA_WORK, ex: b, setIndex: s, exIndex: workCount % 2, n: 2, sets: 3 });
      workCount++;

      if(!isLastB){
        blocks.push({ type: "rest", seconds: TABATA_REST, ex: b, setIndex: s, exIndex: workCount % 2, n: 2, sets: 3 });
      }
    }

    if(s < 2){
      blocks.push({
        type: "between_sets",
        seconds: TABATA_BETWEEN_SETS_REST,
        ex: { name: "Set break", group: "", how_to: "", image: "" },
        setIndex: s,
        exIndex: -1,
        n: 2,
        sets: 3
      });
    }
  }

  return blocks;
}

// ---------- Next work exercise helpers
function nextWorkExerciseObj(startIdx){
  for(let i = startIdx; i < plan.length; i++){
    const b = plan[i];
    if(b && b.type === "work" && b.ex && b.ex.name) return b.ex;
  }
  return null;
}
function nextWorkExerciseName(startIdx){
  const ex = nextWorkExerciseObj(startIdx);
  return ex ? ex.name : "";
}
function nextWorkPlanIndex(startIdx){
  for(let i = startIdx; i < plan.length; i++){
    const b = plan[i];
    if(b && b.type === "work") return i;
  }
  return -1;
}

// ---------- Workout list (EXERCISES ONLY, in the exact order they will happen)
function renderWorkoutList(){
  const ol = $("workoutList");
  if(!ol) return;

  const onlyWork = plan.filter(b => b.type === "work");
  ol.innerHTML = "";

  onlyWork.forEach((b) => {
    const li = document.createElement("li");
    li.dataset.planIndex = String(plan.indexOf(b));

    const name = b.ex?.name || "";
    const group = b.ex?.group ? `(${b.ex.group})` : "";

    li.textContent = `${name} ${group}`.trim();
    ol.appendChild(li);
  });

  highlightWorkoutList();
}

function highlightWorkoutList(){
  const items = document.querySelectorAll("#workoutList li");
  if(!items.length) return;

  let activePlanIndex = -1;
  const cur = plan[idx];

  if(cur && cur.type === "work"){
    activePlanIndex = idx;
  } else {
    activePlanIndex = nextWorkPlanIndex(idx + 1);
  }

  items.forEach(li => {
    const planIndex = Number(li.dataset.planIndex);
    const active = planIndex === activePlanIndex;
    li.style.border = active ? "1px solid rgba(44,255,143,0.55)" : "1px solid rgba(255,255,255,0.08)";
    li.style.fontWeight = active ? "900" : "500";
  });
}

// ---------- Render current (REST shows NEXT exercise)
function renderBlock(block){
  const phaseEl = $("phase");
  const setLineEl = $("setLine");
  const exNameEl = $("exName");
  const exHowEl = $("exHow");
  const img = $("exImg");
  const fallback = $("exFallback");
  const nextEl = $("next");

  const isReady = block.type === "ready";
  const isRest = (block.type === "rest" || block.type === "between_sets");

  if(phaseEl){
    phaseEl.textContent = isReady ? "Ready" : (isRest ? "Rest" : "Exercise");
    phaseEl.style.fontWeight = "1000";
  }

  if(setLineEl){
    if(block.type === "between_sets"){
      setLineEl.textContent = `Between sets. Next is set ${Math.min(3, (block.setIndex + 2))}/3.`;
    } else if(block.setIndex >= 0){
      setLineEl.textContent = `Set ${block.setIndex + 1}/${block.sets}.`;
    } else {
      setLineEl.textContent = " ";
    }
  }

  let displayEx = block.ex;
  if(isReady || isRest){
    const nxt = nextWorkExerciseObj(idx + 1);
    if(nxt) displayEx = nxt;
  }

  if(exNameEl){
    const name = displayEx?.name || "";
    const group = displayEx?.group || "";
    const groupHtml = group
      ? ` <span style="font-size:14px; font-weight:500; color:rgba(255,255,255,0.62);">(${escapeHtml(group)})</span>`
      : "";
    exNameEl.innerHTML = `<span style="font-size:20px; font-weight:1000;">${escapeHtml(name)}</span>${groupHtml}`;
  }

  if(exHowEl){
    if(isReady){
      const nxtName = nextWorkExerciseName(idx + 1);
      exHowEl.textContent = nxtName ? `Next: ${nxtName}` : "Get ready.";
    } else if(isRest){
      const nxtName = nextWorkExerciseName(idx + 1);
      exHowEl.textContent = nxtName ? `Up next: ${nxtName}` : "";
    } else {
      exHowEl.textContent = block.ex?.how_to || "";
    }
  }

  const src = displayEx?.image || "";
  const displayName = displayEx?.name || "";

  if(img && fallback){
    if(src){
      img.src = src;
      img.style.display = "block";
      fallback.style.display = "none";
      fallback.textContent = "";
    } else {
      img.style.display = "none";
      fallback.style.display = "grid";
      fallback.textContent = displayName || "Exercise";
    }
  }

  if(nextEl){
    const n = isRest ? nextWorkExerciseName(idx + 2) : nextWorkExerciseName(idx + 1);
    nextEl.textContent = n ? `Next: ${n}` : "";
  }

  updateWorkoutProgress();
}

// ---------- Timer controls
function clearTickInterval(){
  if(tickHandle) clearInterval(tickHandle);
  tickHandle = null;
}

function stopTick({ fullStop } = { fullStop: false }){
  running = false;
  clearTickInterval();

  if(fullStop){
    paused = false;
    pausedRemainingMs = 0;
  }

  updateWorkoutProgress();
}

function pauseTick(){
  if(!running) return;
  paused = true;
  pausedRemainingMs = Math.max(0, blockEndMs - Date.now());
  stopTick({ fullStop: false });
  keepTimerFocus();
}

function startBlock(i){
  idx = Math.max(0, Math.min(i, plan.length - 1));
  const b = plan[idx];

  paused = false;
  pausedRemainingMs = 0;

  blockStartMs = Date.now();
  blockTotalMs = b.seconds * 1000;
  blockEndMs = blockStartMs + blockTotalMs;

  preWorkCuePlayed = false;

  renderBlock(b);
  highlightWorkoutList();

  if($("timer")) $("timer").textContent = fmtTime(b.seconds);
  setRing(ringTypeForBlockType(b.type), 0);

  updateWorkoutProgress();
  keepTimerFocus();
}

function resumeCurrentBlock(){
  if(!plan.length) return;
  const b = plan[idx];
  if(!b) return;

  const now = Date.now();
  const remaining = Math.max(0, Math.min(blockTotalMs, pausedRemainingMs || 0));

  blockStartMs = now - (blockTotalMs - remaining);
  blockEndMs = now + remaining;

  paused = false;
  pausedRemainingMs = 0;

  running = true;

  clearTickInterval();
  tickHandle = setInterval(tickStep, 100);

  updateWorkoutProgress();
  keepTimerFocus();
}

function startTick(){
  if(!plan.length || running) return;

  if(paused){
    resumeCurrentBlock();
    return;
  }

  running = true;
  startBlock(idx);

  const firstType = plan[idx].type;
  if(firstType === "work") sWorkStart();
  else sRestStart();

  clearTickInterval();
  tickHandle = setInterval(tickStep, 100);
}

function tickStep(){
  const now = Date.now();
  const b = plan[idx];
  if(!b){
    stopTick({ fullStop: true });
    return;
  }

  const remainingMs = Math.max(0, blockEndMs - now);
  const elapsedMs = Math.min(blockTotalMs, Math.max(0, now - blockStartMs));
  const frac = blockTotalMs ? (elapsedMs / blockTotalMs) : 1;

  if($("timer")) $("timer").textContent = fmtTime(Math.ceil(remainingMs / 1000));
  setRing(ringTypeForBlockType(b.type), frac);

  updateWorkoutProgress();

  const nextBlock = plan[idx + 1];
  const nextIsWork = nextBlock && nextBlock.type === "work";
  const curIsWork = b.type === "work";

  if(!curIsWork && nextIsWork && !preWorkCuePlayed && remainingMs <= 5000 && remainingMs > 0){
    preWorkCuePlayed = true;
    sWorkStart();
  }

  if(remainingMs <= 0){
    idx += 1;

    if(idx >= plan.length){
      stopTick({ fullStop: true });
      if($("phase")) $("phase").textContent = "Done";
      if($("setLine")) $("setLine").textContent = "";
      if($("next")) $("next").textContent = "";
      setRing("rest", 1);
      sWorkoutEnd();
      highlightWorkoutList();
      updateWorkoutProgress();
      keepTimerFocus();
      return;
    }

    const nextType = plan[idx].type;

    if(nextType !== "work"){
      sRestStart();
    } else {
      if(!preWorkCuePlayed) sWorkStart();
    }

    startBlock(idx);
  }
}

// ---------- Meta preview
function updateMetaPreview(){
  const readySec = $("readySec") ? Number($("readySec").value) : 15;

  if(currentProgramKey === "tabata6"){
    const workPerSet = TABATA_WORK * (TABATA_ROUNDS * 2);
    const restsPerSet = TABATA_REST * ((TABATA_ROUNDS * 2) - 1);
    const setTotal = workPerSet + restsPerSet;
    const session = (readySec || 0) + (setTotal * 3) + (TABATA_BETWEEN_SETS_REST * 2);
    const workTotal = workPerSet * 3;

    if($("meta")){
      $("meta").textContent =
        `Tabata. Work: ${fmtTime(workTotal)}. Total session: ${fmtTime(session)}. Between sets: ${TABATA_BETWEEN_SETS_REST}s.`;
    }
    return;
  }

  const totalMin = $("totalMin") ? Number($("totalMin").value) : 12;
  const N = $("n") ? Number($("n").value) : 4;

  const timings = readSetTimings();

  const plannedWorkSeconds = timings.reduce((sum, t) => sum + (t.work * N), 0);
  const plannedTargetSeconds = Math.round(totalMin * 60);
  const plannedSessionSeconds =
    timings.reduce((sum, t) => sum + (t.slot * N), 0) + Math.max(0, readySec);

  if($("meta")){
    $("meta").textContent =
      `Target work: ${fmtTime(plannedTargetSeconds)}. Planned work: ${fmtTime(plannedWorkSeconds)}. Total session: ${fmtTime(plannedSessionSeconds)}.`;
  }
}

// ---------- Load
async function loadAll(){
  if($("meta")) $("meta").textContent = "Loading…";

  const [settingsText, exText] = await Promise.all([
    fetchText(RAW_SETTINGS, "Settings"),
    fetchText(RAW_EXERCISES, "Exercises"),
  ]);

  settings = parseCsv(settingsText);
  exercises = parseCsv(exText);

  const enabled = getEnabledExercises();
  const groupsFromSettings = getGroupsFromSettings();
  const groups = groupsFromSettings.length ? groupsFromSettings : getGroupsFromData(enabled);
  populateGroupSelect(groups);

  if($("meta")) $("meta").textContent = `Loaded ${enabled.length} enabled exercises.`;
}

// ---------- Build workout
function buildWorkout(){
  stopTick({ fullStop: true });

  const enabledAll = getEnabledExercises();
  if(!enabledAll.length){
    if($("meta")) $("meta").textContent = "No enabled exercises found in CSV.";
    return;
  }

  const presetKey = currentProgramKey || getPresetKey();

  if(presetKey === "tabata6"){
    const readySec = $("readySec") ? Number($("readySec").value) : 15;

    const pick = pickTabataSixBalancedWithPairConstraint(enabledAll);
    if(!pick){
      if($("meta")) $("meta").textContent = "Tabata needs 6 unique exercises where each pair has different groups (a!=b, c!=d, e!=f). Try again.";
      return;
    }

    plan = buildTabataPlan({ readySec, pairs: pick.pairs });
    idx = 0;

    updateMetaPreview();
    startBlock(0);
    renderWorkoutList();
    updateWorkoutProgress();
    keepTimerFocus();
    return;
  }

  const area51NoFull = presetKey === "area51";

  const enabled = area51NoFull
    ? enabledAll.filter(x => x.group !== "full")
    : enabledAll;

  const groupMode = $("groupSelect") ? $("groupSelect").value : "any";
  if(area51NoFull && norm(groupMode) === "full"){
    if($("meta")) $("meta").textContent = "Area 51 excludes group: full. Pick another group or use Any.";
    return;
  }

  const totalMin = $("totalMin") ? Number($("totalMin").value) : 12;
  const N = $("n") ? Number($("n").value) : 4;
  const sets = $("sets") ? Number($("sets").value) : 3;
  const readySec = $("readySec") ? Number($("readySec").value) : 15;
  const restDefault = $("restDefault") ? Number($("restDefault").value) : 25;

  const suggestedSlot = calcSuggestedSlotSeconds(totalMin, N, sets);
  ensureSetTimings(sets, suggestedSlot, restDefault);
  renderSetTimingInputs();

  const setTimings = readSetTimings();

  const availableUnique = groupMode === "any"
    ? enabled.length
    : enabled.filter(x => x.group === groupMode).length;

  if(availableUnique < N){
    if($("meta")) $("meta").textContent = `Not enough unique exercises for N=${N}. Available: ${availableUnique}.`;
    return;
  }

  let circuit = [];
  if(groupMode === "any") circuit = pickBalancedUnique(N, enabled);
  else circuit = pickFromSingleGroupUnique(N, enabled, groupMode);

  if(circuit.length < N){
    if($("meta")) $("meta").textContent = `Could not pick ${N} unique exercises. Picked: ${circuit.length}.`;
    return;
  }

  plan = buildPlan({ N, sets, readySec, circuit, setTimings });
  idx = 0;

  updateMetaPreview();
  startBlock(0);
  renderWorkoutList();
  updateWorkoutProgress();
  keepTimerFocus();
}

// ---------- Init + wiring
document.addEventListener("DOMContentLoaded", () => {
  if($("spotifyEmbed")) $("spotifyEmbed").src = SPOTIFY_EMBED_URL;
  if($("openSpotify")) $("openSpotify").href = SPOTIFY_PLAYLIST_URL;

  // Videos
  //const warmup = $("vidWarmup");
  //if(warmup) warmup.src = VIDEO_WARMUP_URL;

  const warmup = document.getElementById("vidWarmup");
  if (warmup) {
  warmup.src = VIDEO_WARMUP_URL;
  warmup.load();
  }
  
  const stretch = $("vidStretch");
  if(stretch) stretch.src = VIDEO_STRETCH_URL;

  initRing();
  setRing("rest", 0);
  if($("timer")) $("timer").textContent = "00:00";
  setAudioStatus("");
  updateWorkoutProgress();

  if($("unlockAudio")){
    $("unlockAudio").onclick = async () => {
      try{
        setAudioStatus("Enabling…");
        await ensureAudioReady();
        await sWorkStart();
      } catch(e){
        if($("meta")) $("meta").textContent = `Sounds failed: ${e.message}`;
      }
    };
  }

  if($("testStart")){
    $("testStart").onclick = async () => {
      try{ await ensureAudioReady(); await sWorkStart(); } catch(e){}
    };
  }
  if($("testRest")){
    $("testRest").onclick = async () => {
      try{ await ensureAudioReady(); await sRestStart(); } catch(e){}
    };
  }

  if($("load")){
    $("load").onclick = async () => {
      try{
        await loadAll();

        currentProgramKey = getPresetKey();

        const totalMin = $("totalMin") ? Number($("totalMin").value) : 12;
        const N = $("n") ? Number($("n").value) : 4;
        const sets = $("sets") ? Number($("sets").value) : 3;
        const restDefault = $("restDefault") ? Number($("restDefault").value) : 25;
        const suggestedSlot = calcSuggestedSlotSeconds(totalMin, N, sets);

        if(currentProgramKey !== "tabata6"){
          ensureSetTimings(sets, suggestedSlot, restDefault);
          renderSetTimingInputs();
        } else {
          setTabataUiState(true);
        }

        updateMetaPreview();
        keepTimerFocus();
      } catch(e){
        if($("meta")) $("meta").textContent = `Load failed: ${e.message}`;
      }
    };
  }

  if($("presetSelect")){
    $("presetSelect").addEventListener("change", (e) => {
      const key = e.target.value || "custom";
      currentProgramKey = key;

      if(key === "custom"){
        setTabataUiState(false);
        updateMetaPreview();
        keepTimerFocus();
        return;
      }

      applyPreset(key);
      keepTimerFocus();
    });
  }

  if($("build")) $("build").onclick = buildWorkout;

  if($("start")){
    $("start").onclick = async () => {
      const timerEl = $("timer");
      if(timerEl) timerEl.scrollIntoView({ block: "center", behavior: "smooth" });

      try { await ensureAudioReady(); } catch(e) {}
      startTick();
    };
  }

  if($("pause")) $("pause").onclick = pauseTick;

  if($("prev")){
    $("prev").onclick = () => {
      if(!plan.length) return;
      stopTick({ fullStop: true });
      startBlock(idx - 1);
    };
  }

  if($("skip")){
    $("skip").onclick = () => {
      if(!plan.length) return;
      stopTick({ fullStop: true });
      startBlock(idx + 1);
    };
  }

  if($("restart")){
    $("restart").onclick = () => {
      if(!plan.length) return;
      stopTick({ fullStop: true });
      idx = 0;
      startBlock(0);
    };
  }

  ["totalMin","n","sets","restDefault","readySec","groupSelect"].forEach(id => {
    const el = $(id);
    if(!el) return;

    el.addEventListener("change", () => {
      const preset = $("presetSelect");
      if(preset) preset.value = "custom";
      currentProgramKey = "custom";
      setTabataUiState(false);

      const totalMin = $("totalMin") ? Number($("totalMin").value) : 12;
      const N = $("n") ? Number($("n").value) : 4;
      const sets = $("sets") ? Number($("sets").value) : 3;
      const restDefault = $("restDefault") ? Number($("restDefault").value) : 25;
      const suggestedSlot = calcSuggestedSlotSeconds(totalMin, N, sets);

      ensureSetTimings(sets, suggestedSlot, restDefault);
      renderSetTimingInputs();
      updateMetaPreview();
    });
  });
});
