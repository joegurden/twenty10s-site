import { createClient } from "https://esm.sh/@supabase/supabase-js";

const supabase = createClient(
  "https://lvzktprqdfzbgasorbgo.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2emt0cHJxZGZ6Ymdhc29yYmdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI2OTQzMTYsImV4cCI6MjA3ODI3MDMxNn0.r2ZXYc1mYna72oxijRH2u1N63_ZEmCeTL-zcVj-6WUY"
);

// Formation & display rules
const FORMATION = ["GK","RB","CB","CB","LB","CDM","CM","CAM","LW","ST","RW"];
const BACKLINE = new Set(["GK","RB","CB","LB"]);

// Helpers
const $ = (id) => document.getElementById(id);
const keyOf = (p) => `${p.Name}|${p.Club}`;
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function sumRating(t){ return t.reduce((s,p)=> s + (Number(p.Rating)||0), 0); }
function has95(team){ return team.some(p => Number(p.Rating) >= 95); }

// Data pools
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
}

// 🐐 Ensure EACH team has a 95+ player
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

async function generate(goatBoth=false){
  $("error").textContent="";
  try{
    await loadPools();
    const { team: A, taken } = drawTeam();
    const { team: B } = drawTeam(taken);
    if (goatBoth) await ensureGoatsOnBoth(A, B);
    renderTeams(A,B);
    $("sumA").textContent=`Total ${sumRating(A)}`;
    $("sumB").textContent=`Total ${sumRating(B)}`;
  }catch(e){
    $("error").textContent=e.message;
    $("teamA").innerHTML=$("teamB").innerHTML="";
    $("sumA").textContent=$("sumB").textContent="";
  }
}

$("btn-generate").addEventListener("click", () => generate(false));
$("btn-rematch").addEventListener("click",   () => generate(false));
$("btn-goat").addEventListener("click",      () => generate(true));
generate(false);
