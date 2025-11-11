import { createClient } from "https://esm.sh/@supabase/supabase-js";

/** 🔧 Config */
const SUPABASE_URL = "https://lvzktprqdfzbgasorbgo.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2emt0cHJxZGZ6Ymdhc29yYmdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2OTQzMTYsImV4cCI6MjA3ODI3MDMxNn0.r2ZXYc1mYna72oxijRH2u1N63_ZEmCeTL-zcVj-6WUY";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/** 📋 Formation & display rules */
const FORMATION = ["GK","RB","CB","CB","LB","CDM","CM","CAM","LW","ST","RW"];
const BACKLINE = new Set(["GK","RB","CB","LB"]);

/** 🛠 Helpers */
const $ = (id) => document.getElementById(id);
const keyOf = (p) => `${p.Name}|${p.Club}`;
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function sumRating(t){ return t.reduce((s,p)=> s + (Number(p.Rating)||0), 0); }
function has95(team){ return team.some(p => Number(p.Rating) >= 95); }
function statsHTML(p, showCS){
  const parts = [
    p.Club, p.League,
    `Apps ${p.Appearances ?? 0}`,
    `G ${p.Goals ?? 0}`,
    `A ${p.Assists ?? 0}`
  ];
  if (showCS) parts.push(`CS ${p["Clean Sheets"] ?? 0}`);
  return parts.filter(Boolean).join(" · ");
}

/** 📦 Data pools */
let poolByPos = new Map();
async function loadPools(){
  poolByPos.clear();
  const distinct = [...new Set(FORMATION)];
  for (const pos of distinct) {
    const { data, error } = await supabase
      .from("players").select("*").eq("Position", pos).limit(500);
    if (error) throw new Error(`Failed to load ${pos}: ${error.message}`);
    poolByPos.set(pos, shuffle([...(data || [])]));
  }
}

/** 🧩 Build random teams (no duplicates) */
function drawTeam(excludedKeys){
  const team=[]; const taken=new Set(excludedKeys||[]);
  const pools=new Map([...poolByPos.entries()].map(([k,v])=>[k,[...v]]));
  for (const pos of FORMATION){
    const pool=pools.get(pos)||[]; let pick=null;
    while (pool.length){
      const c=pool.pop();
      if (!taken.has(keyOf(c))){ pick=c; break; }
    }
    if (!pick) throw new Error(`Not enough ${pos} players. Add more ${pos}s.`);
    team.push(pick); taken.add(keyOf(pick));
  }
  return { team, taken };
}

/** 🖼 Render */
function renderTeams(A,B){
  const aHTML=[], bHTML=[];
  for (let i=0;i<FORMATION.length;i++){
    const pA=A[i], pB=B[i];
    const rA=Number(pA.Rating||0), rB=Number(pB.Rating||0);
    let classA="", classB="";
    if (rA>rB){ classA="winner"; classB="loser"; }
    else if (rB>rA){ classA="loser"; classB="winner"; }
    const back=BACKLINE.has(FORMATION[i]);
    aHTML.push(`<li class="${classA}">
      <span class="pos">${pA.Position}</span>
      <span class="name">${pA.Name}<span class="sub"> ${statsHTML(pA, back)}</span></span>
      <span class="meta">${rA}</span>
    </li>`);
    bHTML.push(`<li class="${classB}">
      <span class="pos">${pB.Position}</span>
      <span class="name">${pB.Name}<span class="sub"> ${statsHTML(pB, back)}</span></span>
      <span class="meta">${rB}</span>
    </li>`);
  }
  $("teamA").innerHTML=aHTML.join("");
  $("teamB").innerHTML=bHTML.join("");
  $("sumA").textContent=`Total ${sumRating(A)}`;
  $("sumB").textContent=`Total ${sumRating(B)}`;
}

/** 🐐 Ensure EACH team has a 95+ player */
async function ensureGoatsOnBoth(A, B){
  if (has95(A) && has95(B)) return;
  const { data: goats, error } = await supabase
    .from("players").select("*").gte("Rating", 95).limit(500);
  if (error) return;
  const pool = shuffle(goats || []);
  function inject(team, other){
    if (has95(team)) return true;
    for (const g of pool){
      const slots = FORMATION.map((pos,i)=>pos===g.Position? i : -1).filter(i=>i>=0);
      if (team.some(p=>keyOf(p)===keyOf(g))) continue;
      if (other.some(p=>keyOf(p)===keyOf(g))) continue;
      let idx = slots.find(i => Number(team[i].Rating||0) < 95);
      if (idx === undefined) idx = slots[0];
      if (idx !== undefined){
        team[idx] = g;
        pool.splice(pool.indexOf(g), 1);
        return true;
      }
    }
    return false;
  }
  if (!has95(A)) inject(A, B);
  if (!has95(B)) inject(B, A);
}

/** 🎛 Random/Rematch buttons */
async function generate(goatBoth=false){
  $("error").textContent="";
  try{
    await loadPools();
    const { team: A, taken } = drawTeam();
    const { team: B } = drawTeam(taken);
    if (goatBoth) await ensureGoatsOnBoth(A, B);
    renderTeams(A,B);
  }catch(e){
    $("error").textContent = e.message;
    $("teamA").innerHTML = $("teamB").innerHTML = "";
    $("sumA").textContent = $("sumB").textContent = "";
  }
}

/* ------------------------------------------------------------------ */
/*                          🖐️ DRAFT MODE                             */
/* ------------------------------------------------------------------ */

let draftActive = false;
let draftIndex = 0;          // which slot we’re on (0..10)
let yourTeam = Array(FORMATION.length).fill(null);
let oppTeam  = Array(FORMATION.length).fill(null);
let takenKeys = new Set();
let globalPoolCache = [];    // flat list of all fetched players for quick randoms
let yourSubs = [];
let oppSubs = [];

function resetDraftState(){
  draftActive=false; draftIndex=0;
  yourTeam = Array(FORMATION.length).fill(null);
  oppTeam  = Array(FORMATION.length).fill(null);
  takenKeys = new Set();
  yourSubs = []; oppSubs = [];
}

async function buildGlobalPool(){
  // pull all formation positions & merge
  globalPoolCache = [];
  for (const pos of new Set(FORMATION)){
    const { data } = await supabase.from("players").select("*").eq("Position", pos).limit(600);
    if (data?.length) globalPoolCache.push(...data);
  }
}

function availableFor(pos){
  return globalPoolCache.filter(p => p.Position===pos && !takenKeys.has(keyOf(p)));
}

function randomValidFor(pos){
  const list = availableFor(pos);
  if (!list.length) return null;
  return list[Math.floor(Math.random()*list.length)];
}

function candidateFive(pos){
  const list = shuffle(availableFor(pos)).slice(0,5);
  return list;
}

function renderDraftUI(){
  const panel = $("draftPanel");
  const subsArea = $("subsArea");
  const isSubs = draftIndex >= FORMATION.length;

  panel.classList.remove("hidden");
  $("draftStep").textContent = isSubs
    ? `Subs — pick 5`
    : `Pick for ${FORMATION[draftIndex]} (${draftIndex+1}/11)`;
  $("draftInstruction").textContent = isSubs
    ? `Choose 5 substitutes from remaining players (any positions).`
    : `Pick ONE of the 5 players for position ${FORMATION[draftIndex]}. Opponents will auto-pick a different player at random.`;

  if (!isSubs){
    subsArea.classList.add("hidden");
    const pos = FORMATION[draftIndex];
    const cands = candidateFive(pos);
    $("candidates").innerHTML = cands.map(c => candHTML(c)).join("");
    // attach click handlers
    cands.forEach(c => {
      const id = "cand-" + safeId(keyOf(c));
      $(id).addEventListener("click", () => pickCandidate(c));
    });
  } else {
    $("candidates").innerHTML = "";
    subsArea.classList.remove("hidden");
    $("subsCount").textContent = `${yourSubs.length} / 5`;
    const subsCands = shuffle(globalPoolCache.filter(p => !takenKeys.has(keyOf(p)))).slice(20); // big pool
    $("subsCandidates").innerHTML = subsCands.slice(0,20).map(c => candHTML(c, true)).join("");
    subsCands.slice(0,20).forEach(c => {
      const id = "cand-" + safeId(keyOf(c));
      $(id).addEventListener("click", () => pickSub(c));
    });
  }
}

function safeId(s){ return s.replace(/[^a-z0-9]/gi,'_'); }
function candHTML(p, small=false){
  const showCS = BACKLINE.has(p.Position);
  return `
    <button id="cand-${safeId(keyOf(p))}" class="cand">
      <div class="line1"><span>${p.Position} — ${p.Name}</span><span>${p.Rating}</span></div>
      <div class="line2">${p.Club} · ${p.League}</div>
      <div class="line3">${showCS
        ? `Apps ${p.Appearances??0} · G ${p.Goals??0} · A ${p.Assists??0} · CS ${p["Clean Sheets"]??0}`
        : `Apps ${p.Appearances??0} · G ${p.Goals??0} · A ${p.Assists??0}`
      }</div>
    </button>`;
}

function pickCandidate(player){
  // lock your pick
  const idx = draftIndex;
  const pos = FORMATION[idx];
  yourTeam[idx] = player;
  takenKeys.add(keyOf(player));

  // opponent auto-pick same position
  const opp = randomValidFor(pos);
  if (opp){
    oppTeam[idx] = opp;
    takenKeys.add(keyOf(opp));
  }

  draftIndex++;
  if (draftIndex >= FORMATION.length){
    // move to subs stage
    renderDraftUI();
  } else {
    renderDraftUI();
  }
}

function pickSub(player){
  if (yourSubs.length >= 5) return;
  yourSubs.push(player);
  takenKeys.add(keyOf(player));
  // opponent sub random from remaining
  const remain = globalPoolCache.filter(p => !takenKeys.has(keyOf(p)));
  const opp = remain.length ? remain[Math.floor(Math.random()*remain.length)] : null;
  if (opp){
    oppSubs.push(opp);
    takenKeys.add(keyOf(opp));
  }
  $("subsCount").textContent = `${yourSubs.length} / 5`;

  // refresh subs grid lightly
  if (yourSubs.length < 5){
    renderDraftUI();
  }
}

function autoPickSubs(){
  while (yourSubs.length < 5){
    const remain = globalPoolCache.filter(p => !takenKeys.has(keyOf(p)));
    if (!remain.length) break;
    const pick = remain[Math.floor(Math.random()*remain.length)];
    pickSub(pick);
  }
}

function finishDraft(){
  // If user exits early, fill missing slots randomly
  for (let i=0;i<FORMATION.length;i++){
    if (!yourTeam[i]){
      const pos = FORMATION[i];
      const cand = randomValidFor(pos);
      if (cand){ yourTeam[i]=cand; takenKeys.add(keyOf(cand)); }
      const oppCand = randomValidFor(pos);
      if (oppCand){ oppTeam[i]=oppCand; takenKeys.add(keyOf(oppCand)); }
    }
  }
  // Render on main panels
  renderTeams(yourTeam, oppTeam);
  // Hide draft panel
  $("draftPanel").classList.add("hidden");
  draftActive = false;
}

/** 🚀 Launch Draft Mode */
async function startDraft(){
  $("error").textContent = "";
  resetDraftState();
  draftActive = true;
  try{
    await buildGlobalPool();
    if (!globalPoolCache.length) throw new Error("No players found.");
    $("draftPanel").classList.remove("hidden");
    renderDraftUI();
  }catch(e){
    $("error").textContent = e.message;
  }
}

/* ------------------------------------------------------------------ */
/*                       Wire up top-level buttons                     */
/* ------------------------------------------------------------------ */

$("btn-generate").addEventListener("click", () => generate(false));
$("btn-rematch").addEventListener("click",   () => generate(false));
$("btn-goat").addEventListener("click",      () => generate(true));
$("btn-draft").addEventListener("click",     () => startDraft());

$("btn-exit-draft").addEventListener("click", () => {
  $("draftPanel").classList.add("hidden");
  draftActive=false;
});
$("btn-auto-subs").addEventListener("click", () => autoPickSubs());
$("btn-finish-draft").addEventListener("click", () => finishDraft());

/** 🔄 Initial */
generate(false);

