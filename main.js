import { createClient } from "https://esm.sh/@supabase/supabase-js";

/* ---------------- Debug + global error handlers ---------------- */
console.log("✅ main.js loaded", new Date().toISOString());
window.addEventListener("error", (e) => console.error("Global error:", e.message, e));
window.addEventListener("unhandledrejection", (e) => console.error("Promise rejection:", e.reason));

/* ---------------- Supabase config ---------------- */
const supabase = createClient(
  "https://lvzktprqdfzbgasorbgo.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2emt0cHJxZGZ6Ymdhc29yYmdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2OTQzMTYsImV4cCI6MjA3ODI3MDMxNn0.r2ZXYc1mYna72oxijRH2u1N63_ZEmCeTL-zcVj-6WUY"
);

/* ---------------- Formations ---------------- */
const FORMATIONS = {
  "3-4-3": [["GK"],["RWB","RM"],["CB"],["CB"],["CB"],["LWB","LM"],["CM"],["CM"],["LW"],["ST"],["RW"]],
  "3-5-2": [["GK"],["RWB","RM"],["CB"],["CB"],["CB"],["LWB","LM"],["CDM"],["CDM"],["CAM"],["ST"],["ST"]],
  "4-4-2": [["GK"],["RB"],["CB"],["CB"],["LB"],["RM","RW"],["CM"],["CM"],["LM","LW"],["ST"],["ST"]],
  "4-1-2-1-2": [["GK"],["RB"],["CB"],["CB"],["LB"],["CDM"],["RM","RW"],["LM","LW"],["CAM"],["ST"],["ST"]],
  "4-2-3-1": [["GK"],["RB"],["CB"],["CB"],["LB"],["CDM"],["CDM"],["RM","RW"],["CAM"],["LM","LW"],["ST"]],
  "4-3-3 (Holding)": [["GK"],["RB"],["CB"],["CB"],["LB"],["CDM"],["CM"],["CM"],["RW"],["ST"],["LW"]],
  "4-3-3 (Flat)": [["GK"],["RB"],["CB"],["CB"],["LB"],["CM"],["CM"],["CM"],["RW"],["ST"],["LW"]],
  "4-3-3 (Attack)": [["GK"],["RB"],["CB"],["CB"],["LB"],["CM"],["CM"],["CAM"],["RW"],["ST"],["LW"]],
};

const BACKLINE = new Set(["GK","RB","CB","LB","RWB","LWB"]);
const $ = (id) => document.getElementById(id);
const keyOf = (p) => `${p.Name}|${p.Club}`;
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function sumRating(t){return t.reduce((s,p)=>s+(Number(p.Rating)||0),0);}
function has95(team){return team.some(p=>Number(p.Rating)>=95);}

function statsHTML(p, showCS){
  const parts=[p.Club,p.League,`Apps ${p.Appearances??0}`,`G ${p.Goals??0}`,`A ${p.Assists??0}`];
  if(showCS) parts.push(`CS ${p["Clean Sheets"]??0}`);
  return parts.filter(Boolean).join(" · ");
}

/* ---------------- Random / Goat mode core ---------------- */
function currentFormationSlots(){ return FORMATIONS["4-3-3 (Holding)"]; }

async function loadByPositions(posSlots){
  const pools=new Map();
  for(const pos of new Set(posSlots.flat())){
    const {data,error}=await supabase.from("players").select("*").eq("Position",pos).limit(500);
    if(error) throw new Error(error.message);
    pools.set(pos,shuffle([...(data||[])]));
  }
  return pools;
}

function drawTeamFromPools(formationSlots,pools,excludeKeys=new Set()){
  const team=[]; const taken=new Set(excludeKeys);
  for(const slot of formationSlots){
    const choices = slot.flatMap(pos => pools.get(pos)||[]);
    let pick=null;
    while(choices.length){
      const c=choices.pop();
      if(!taken.has(keyOf(c))){pick=c;break;}
    }
    if(!pick) throw new Error(`Not enough players for ${slot.join("/")}`);
    team.push(pick); taken.add(keyOf(pick));
  }
  return {team,taken};
}

function renderTeams(A,B){
  const a=[],b=[], slots = (draft.active && series.lastA.length) ? series.lastSlots : currentFormationSlots();
  for(let i=0;i<slots.length;i++){
    const pA=A[i], pB=B[i], rA=Number(pA.Rating||0), rB=Number(pB.Rating||0);
    let classA="",classB="";
    if(rA>rB){classA="winner";classB="loser";} else if(rB>rA){classA="loser";classB="winner";}
    const back = slots[i].some(pos=>BACKLINE.has(pos));
    a.push(`<li class="${classA}"><span class="pos">${pA.Position}</span><span class="name">${pA.Name}<span class="sub"> ${statsHTML(pA,back)}</span></span><span class="meta">${rA}</span></li>`);
    b.push(`<li class="${classB}"><span class="pos">${pB.Position}</span><span class="name">${pB.Name}<span class="sub"> ${statsHTML(pB,back)}</span></span><span class="meta">${rB}</span></li>`);
  }
  $("teamA").innerHTML=a.join(""); $("teamB").innerHTML=b.join("");
  $("sumA").textContent=`Total ${sumRating(A)}`; $("sumB").textContent=`Total ${sumRating(B)}`;
}

async function ensureGoatsOnBoth(A,B){
  if(has95(A)&&has95(B)) return;
  const {data:goats}=await supabase.from("players").select("*").gte("Rating",95).limit(500);
  if(!goats?.length) return; const pool=shuffle(goats);
  function inject(team,other){
    if(has95(team)) return;
    for(const g of pool){
      if(team.some(p=>keyOf(p)===keyOf(g))||other.some(p=>keyOf(p)===keyOf(g))) continue;
      const slots = currentFormationSlots();
      let idx = slots.findIndex(arr=>arr.includes(g.Position));
      if(idx<0) idx=0;
      team[idx]=g; return;
    }
  }
  inject(A,B); inject(B,A);
}

async function generate(goat=false){
  $("error").textContent="";
  try{
    const slots = currentFormationSlots();
    const pools = await loadByPositions(slots);
    const {team:A,taken}=drawTeamFromPools(slots,pools);
    const {team:B}=drawTeamFromPools(slots,pools,taken);
    if(goat) await ensureGoatsOnBoth(A,B);
    // remember last slots for render context
    series.lastSlots = slots;
    renderTeams(A,B);
  }catch(e){$("error").textContent=e.message;}
}

/* ---------------- Draft state ---------------- */
const draft = {
  active:false,
  formation: "4-3-3 (Holding)",
  slotIndex: 0,
  yourXI: Array(11).fill(null),
  oppXI: Array(11).fill(null),
  subs: [],
  oppSubs: [],
  taken: new Set(),
  globalPool: [],
  slots(){ return FORMATIONS[this.formation]; }
};

const series = { matchNo:0, wins:0, lastA:[], lastB:[], lastSlots: currentFormationSlots(), prematchXI:[] };

/* ---------------- Panel toggler (fixed) ---------------- */
function togglePanels({ setup = false, prematch = false, series = false } = {}) {
  $("setupPanel").classList.toggle("hidden", !setup);
  $("prematchPanel").classList.toggle("hidden", !prematch);
  $("seriesPanel").classList.toggle("hidden", !series);
}

/* ---------------- Draft helpers ---------------- */
async function buildGlobalPool(){
  draft.globalPool=[];
  const distinct = new Set(Object.values(FORMATIONS).flat(1).flat());
  for(const pos of distinct){
    const {data}=await supabase.from("players").select("*").eq("Position",pos).limit(800);
    if(data?.length) draft.globalPool.push(...data);
  }
}
function availableForAny(positions){
  return draft.globalPool.filter(p => positions.includes(p.Position) && !draft.taken.has(keyOf(p)));
}
function randomOppFor(positions){
  const list = availableForAny(positions);
  return list.length ? list[Math.floor(Math.random()*list.length)] : null;
}
function candHTML(p){
  const showCS = BACKLINE.has(p.Position);
  return `
    <button class="cand" data-key="${keyOf(p)}">
      <div class="line1"><span>${p.Position} — ${p.Name}</span><span>${p.Rating}</span></div>
      <div class="line2">${p.Club} · ${p.League}</div>
      <div class="line3">${showCS ? `Apps ${p.Appearances??0} · G ${p.Goals??0} · A ${p.Assists??0} · CS ${p["Clean Sheets"]??0}` :
                                     `Apps ${p.Appearances??0} · G ${p.Goals??0} · A ${p.Assists??0}`}</div>
    </button>`;
}

/* ---------------- Draft screens ---------------- */
function resetSetupSelections(){
  draft.slotIndex=0;
  draft.yourXI = Array(11).fill(null);
  draft.oppXI  = Array(11).fill(null);
  draft.subs = []; draft.oppSubs = [];
  draft.taken = new Set();
  $("setupSubsCount").textContent = `0 / 5`;
}

function renderSetup(){
  const slots = draft.slots();
  const idx = draft.slotIndex;
  const pickingSubs = idx >= 11;

  $("setupStep").textContent = pickingSubs
    ? `Subs — pick 5`
    : `Pick for slot ${idx+1}/11 (${slots[idx].join(" / ")})`;

  $("setupInstruction").textContent = pickingSubs
    ? `Choose 5 substitutes from remaining players (4 options shown).`
    : `Pick ONE of these 4 candidates for ${slots[idx].join("/")} — your opponent will auto-pick a different one.`;

  $("setupSubs").classList.toggle("hidden", !pickingSubs);

  if(!pickingSubs){
    const cands = shuffle(availableForAny(slots[idx])).slice(0,4);
    $("setupCandidates").innerHTML = cands.map(candHTML).join("") || `<div class="pill">No candidates left for ${slots[idx].join("/")}. Add more players.</div>`;
    Array.from($("setupCandidates").querySelectorAll(".cand")).forEach(btn=>{
      btn.addEventListener("click", ()=> {
        const p = draft.globalPool.find(x => keyOf(x)===btn.dataset.key);
        if(!p) return;
        draft.yourXI[idx]=p; draft.taken.add(keyOf(p));
        const opp = randomOppFor(slots[idx]);
        if(opp){ draft.oppXI[idx]=opp; draft.taken.add(keyOf(opp)); }
        draft.slotIndex++;
        renderSetup();
      });
    });
  } else {
    $("setupSubsCount").textContent = `${draft.subs.length} / 5`;
    const remain = shuffle(draft.globalPool.filter(p=>!draft.taken.has(keyOf(p))));
    const cands = remain.slice(0,4);
    $("setupSubsCandidates").innerHTML = cands.map(candHTML).join("") || `<div class="pill">No players remaining.</div>`;
    Array.from($("setupSubsCandidates").querySelectorAll(".cand")).forEach(btn=>{
      btn.addEventListener("click", ()=>{
        if(draft.subs.length>=5) return;
        const p = draft.globalPool.find(x => keyOf(x)===btn.dataset.key);
        if(!p) return;
        draft.subs.push(p); draft.taken.add(keyOf(p));
        const r = shuffle(draft.globalPool.filter(x=>!draft.taken.has(keyOf(x)))).pop();
        if(r){ draft.oppSubs.push(r); draft.taken.add(keyOf(r)); }
        $("setupSubsCount").textContent = `${draft.subs.length} / 5`;
        renderSetup();
      });
    });
  }
}

async function startSetup(){
  $("error").textContent="";
  try{
    draft.active=true; draft.formation = $("setupFormation").value;
    await buildGlobalPool();
    resetSetupSelections();
    togglePanels({ setup: true });
    renderSetup();
  }catch(e){ $("error").textContent=e.message; }
}
function endSetup(){ togglePanels({ setup: false }); draft.active=false; }

function autoPickSubs(){
  while(draft.subs.length<5){
    const r = shuffle(draft.globalPool.filter(x=>!draft.taken.has(keyOf(x)))).pop();
    if(!r) break;
    draft.subs.push(r); draft.taken.add(keyOf(r));
    const opp = shuffle(draft.globalPool.filter(x=>!draft.taken.has(keyOf(x)))).pop();
    if(opp){ draft.oppSubs.push(opp); draft.taken.add(keyOf(opp)); }
  }
  $("setupSubsCount").textContent = `${draft.subs.length} / 5`;
  renderSetup();
}

function finishSetup(){
  if(draft.yourXI.some(x=>!x)){ $("error").textContent="Finish all 11 picks first."; return; }
  if(draft.subs.length<5){ $("error").textContent="Pick 5 subs first."; return; }
  series.matchNo = 0; series.wins = 0;
  togglePanels({ setup: false, prematch: true });
  renderPrematchPool();
}

function renderPrematchPool(){
  const pool = [...draft.yourXI, ...draft.subs];
  $("prematchFormation").value = draft.formation;
  $("seriesStatus").textContent = `Match ${series.matchNo+1} of 3`;
  $("prematchPool").innerHTML = pool.map((p,i)=>`
    <label class="pick">
      <input type="checkbox" data-idx="${i}">
      <strong>${p.Position} — ${p.Name}</strong> (${p.Rating})<br>
      <span class="pill">${p.Club} · ${p.League}</span>
    </label>
  `).join("");
}

function chosenXIFromPool(){
  const pool = [...draft.yourXI, ...draft.subs];
  const checks = Array.from($("prematchPool").querySelectorAll('input[type="checkbox"]:checked'));
  const indices = checks.map(c=>Number(c.dataset.idx));
  if(indices.length!==11) return null;
  return indices.map(i=>pool[i]);
}

function assignToFormation(players, formationKey){
  const slots = FORMATIONS[formationKey];
  const used = new Set();
  const team = Array(11).fill(null);
  for(let i=0;i<slots.length;i++){
    const need = slots[i];
    const idx = players.findIndex((p,pi)=>!used.has(pi) && need.includes(p.Position));
    if(idx===-1) return null;
    team[i]=players[idx]; used.add(idx);
  }
  return team;
}

async function playMatch(){
  const chosen = chosenXIFromPool();
  if(!chosen){ $("error").textContent="Select exactly 11 players first."; return; }
  const f = $("prematchFormation").value;
  const yourAssigned = assignToFormation(chosen, f);
  if(!yourAssigned){ $("error").textContent=`Your 11 don't fit ${f}. Try another formation or different players.`; return; }

  // Opponent XI for same formation
  const slots = FORMATIONS[f];
  const pools = await loadByPositions(slots);
  const {team:opp} = drawTeamFromPools(slots, pools, new Set(chosen.map(keyOf)));

  // Render to main panels + series state
  series.lastSlots = slots;
  renderTeams(yourAssigned, opp);
  series.lastA = yourAssigned; series.lastB = opp;

  // Decide win (simple: higher total rating)
  const win = sumRating(yourAssigned) > sumRating(opp);
  if(win) series.wins++;

  $("seriesLabel").textContent = `Played ${series.matchNo+1}/3`;
  $("seriesResult").textContent = win ? "You win this match on total rating." : "You lose this match on total rating.";
  $("finalScore").textContent = (series.matchNo+1>=3) ? `Final: ${series.wins}/3` : "";

  // Show series panel with Next Match (fixed)
  togglePanels({ prematch: false, series: true });
  $("btn-next-match").disabled = (series.matchNo + 1 >= 3);
}

function nextMatch(){
  series.matchNo++;
  if(series.matchNo>=3){
    $("finalScore").textContent = `Final: ${series.wins}/3`;
    $("btn-next-match").disabled = true;
    return;
  }
  togglePanels({ series: false, prematch: true });
  $("seriesStatus").textContent = `Match ${series.matchNo + 1} of 3`;
  renderPrematchPool();
}

/* ---------------- Wire up after DOM ready ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  $("btn-generate")?.addEventListener("click", () => generate(false));
  $("btn-rematch")?.addEventListener("click",  () => generate(false));
  $("btn-goat")?.addEventListener("click",     () => generate(true));
  $("btn-draft")?.addEventListener("click",    () => startSetup());

  $("btn-exit-setup")?.addEventListener("click", () => togglePanels({ setup: false }));
  $("setupFormation")?.addEventListener("change", e=>{
    draft.formation = e.target.value;
    resetSetupSelections();
    renderSetup();
  });
  $("btn-setup-auto-subs")?.addEventListener("click", () => autoPickSubs());
  $("btn-setup-finish")?.addEventListener("click", () => finishSetup());

  $("btn-exit-prematch")?.addEventListener("click", () => togglePanels({ prematch: false }));
  $("prematchFormation")?.addEventListener("change", () => { /* stored on play */ });
  $("btn-play-match")?.addEventListener("click", () => playMatch());

  $("btn-exit-series")?.addEventListener("click", () => togglePanels({ series: false }));
  $("btn-next-match")?.addEventListener("click", () => nextMatch());

  // Initial quick view
  generate(false);
});

