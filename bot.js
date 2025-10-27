import fetch from "node-fetch";
import fs from "fs";
import path from "path";

const CHAT_ID = -1003065918727;              // seu grupo
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;
const RUN_MODE = process.env.RUN_MODE || "monitor"; // "monitor" (2h) | "daily" (22h)

// ===== util =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const todayStr = () => new Date().toISOString().slice(0,10); // YYYY-MM-DD
const dataDir = path.join(process.cwd(), "data");
const stateFile = (d = todayStr()) => path.join(dataDir, `${d}.json`);

function ensureDataDir(){
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(stateFile())) fs.writeFileSync(stateFile(), JSON.stringify({ cities: [], closed: false }, null, 2));
}

function loadState() {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf-8"));
  } catch {
    return { cities: [], closed: false };
  }
}

function saveState(st) {
  ensureDataDir();
  fs.writeFileSync(stateFile(), JSON.stringify(st, null, 2));
}

function resetTomorrow() {
  // cria arquivo do próximo dia vazio (opcional)
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const ymd = d.toISOString().slice(0,10);
  const f = stateFile(ymd);
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ cities: [], closed: false }, null, 2));
}

function addCityToday(cityName){
  const st = loadState();
  if (!st.cities.includes(cityName)) {
    st.cities.push(cityName);
    saveState(st);
  }
}

function markClosed(){
  const st = loadState();
  st.closed = true;   // marca que o resumo foi emitido hoje
  saveState(st);
}

// ===== Telegram =====
async function tgSend(text, html = true){
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: html ? "HTML" : undefined,
      disable_web_page_preview: true
    })
  });
  return r.json();
}

// ===== Sua base de CIDADES (capitais) =====
const CITIES = [
  { uf:"AC", name:"Rio Branco",lat:-9.97499,lon:-67.82430},
  { uf:"AL", name:"Maceió",lat:-9.64985,lon:-35.70895},
  { uf:"AP", name:"Macapá",lat:0.03493,lon:-51.06940},
  { uf:"AM", name:"Manaus",lat:-3.11903,lon:-60.02173},
  { uf:"BA", name:"Salvador",lat:-12.97304,lon:-38.50230},
  { uf:"CE", name:"Fortaleza",lat:-3.73186,lon:-38.52667},
  { uf:"DF", name:"Brasília",lat:-15.79389,lon:-47.88278},
  { uf:"ES", name:"Vitória",lat:-20.31550,lon:-40.31280},
  { uf:"GO", name:"Goiânia",lat:-16.68640,lon:-49.26430},
  { uf:"MA", name:"São Luís",lat:-2.53874,lon:-44.28250},
  { uf:"MT", name:"Cuiabá",lat:-15.60100,lon:-56.09740},
  { uf:"MS", name:"Campo Grande",lat:-20.46970,lon:-54.62010},
  { uf:"MG", name:"Belo Horizonte",lat:-19.91668,lon:-43.93449},
  { uf:"PA", name:"Belém",lat:-1.45502,lon:-48.50240},
  { uf:"PB", name:"João Pessoa",lat:-7.11509,lon:-34.86410},
  { uf:"PR", name:"Curitiba",lat:-25.42836,lon:-49.27325},
  { uf:"PE", name:"Recife",lat:-8.04756,lon:-34.87700},
  { uf:"PI", name:"Teresina",lat:-5.09194,lon:-42.80336},
  { uf:"RJ", name:"Rio de Janeiro",lat:-22.90685,lon:-43.17290},
  { uf:"RN", name:"Natal",lat:-5.79500,lon:-35.20944},
  { uf:"RO", name:"Porto Velho",lat:-8.76077,lon:-63.89990},
  { uf:"RR", name:"Boa Vista",lat:2.82384,lon:-60.67530},
  { uf:"RS", name:"Porto Alegre",lat:-30.03465,lon:-51.21766},
  { uf:"SC", name:"Florianópolis",lat:-27.59450,lon:-48.54770},
  { uf:"SE", name:"Aracaju",lat:-10.90910,lon:-37.06770},
  { uf:"SP", name:"São Paulo",lat:-23.55052,lon:-46.63331},
  { uf:"TO", name:"Palmas",lat:-10.18400,lon:-48.33360},
];

// ===== APIs =====
// Chuva horária via OpenWeather OneCall (precipitação na última hora)
function owUrl(lat, lon){
  return `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br&exclude=minutely,daily`;
}

const THRESHOLD_MM = 10;
const API_DELAY = 400;

async function monitorRun(){
  const diag = [];
  const toSend = [];

  for (const c of CITIES){
    try{
      const r = await fetch(owUrl(c.lat, c.lon));
      if (!r.ok) {
        diag.push(`${c.uf}-${c.name}: HTTP ${r.status}`);
      } else {
        const d = await r.json();
        const mm = d?.hourly?.[0]?.rain?.["1h"] ?? 0;
        diag.push(`${c.uf}-${c.name}: ${mm ?? 0} mm/h`);
        if (mm >= THRESHOLD_MM){
          toSend.push(`🌧️ <b>${c.name.toUpperCase()}</b>\n~${mm.toFixed(1)} mm/h`);
          addCityToday(c.name); // registra cidade com alerta de chuva
        }
      }
    } catch(e){
      diag.push(`${c.uf}-${c.name}: ERRO ${e.message}`);
    }
    await sleep(API_DELAY);
  }

  // envia alertas de chuva
  for (const m of toSend) await tgSend(m);

  // diagnóstico curto por debug (opcional desabilitar)
  if (toSend.length === 0) {
    // nada
  }

  return { diag, sent: toSend.length };
}

async function dailySummary(){
  // lê o estado do dia
  const st = loadState();
  const cidades = st.cities ?? [];

  if (cidades.length === 0) {
    await tgSend("✅ Nenhum alerta hoje.");
  } else {
    await tgSend(`⚠️ Houve alertas hoje\nCidades: ${cidades.sort().join(", ")}`);
  }

  // marca como fechado e prepara próximo dia
  markClosed();
  resetTomorrow();
}

// ===== main =====
async function main(){
  if (RUN_MODE === "daily") {
    await dailySummary();
  } else {
    await monitorRun();
  }
  console.log(`OK ${RUN_MODE} — ${new Date().toISOString()}`);
}

main().catch(async (e)=>{
  await tgSend(`❌ Erro: ${e.message}`, false);
  process.exit(1);
});
