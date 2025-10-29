import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// ====== CONFIG ======
const CHAT_ID = -1003065918727;                  // grupo/privado alvo
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TOMORROW_API_KEY = process.env.TOMORROW_API_KEY;
const RUN_MODE = process.env.RUN_MODE || "monitor"; // "monitor" (2h) | "daily" (22h)

const THRESHOLD_MM_H = 10;       // limiar de chuva (mm/h)
const HORIZON_HOURS = 6;         // olha as próximas N horas
const API_DELAY = 350;           // espaçamento entre chamadas (ms)

// ====== PERSISTÊNCIA DO DIA ======
const dataDir = path.join(process.cwd(), "data");
const todayStr = () => new Date().toISOString().slice(0,10);
const stateFile = (d = todayStr()) => path.join(dataDir, `${d}.json`);

function ensureData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(stateFile())) fs.writeFileSync(stateFile(), JSON.stringify({ cities: [], closed: false }, null, 2));
}
function loadState() {
  ensureData();
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf-8")); }
  catch { return { cities: [], closed: false }; }
}
function saveState(st) {
  ensureData();
  fs.writeFileSync(stateFile(), JSON.stringify(st, null, 2));
}
function addCityToday(label) {
  const st = loadState();
  if (!st.cities.includes(label)) {
    st.cities.push(label);
    saveState(st);
  }
}
function rollTomorrow() {
  const d = new Date(); d.setDate(d.getDate() + 1);
  const ymd = d.toISOString().slice(0,10);
  const f = path.join(dataDir, `${ymd}.json`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ cities: [], closed: false }, null, 2));
}

// ====== TELEGRAM ======
async function tgSend(text, html = true) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: html ? "HTML" : undefined,
      disable_web_page_preview: true,
    })
  });
  return r.json();
}

// ====== CIDADES (capitais) ======
const CAPITALS = [
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

// ====== TOMORROW.IO (Timelines v4) ======
function isoNowPlus(hours = 0) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function tlUrl(lat, lon) {
  const start = encodeURIComponent(isoNowPlus(0));
  const end   = encodeURIComponent(isoNowPlus(HORIZON_HOURS));
  const fields = encodeURIComponent("precipitationIntensity");
  const timesteps = "1h";
  // SI já retorna mm/h; não precisa setar units
  return `https://api.tomorrow.io/v4/timelines?location=${lat},${lon}&fields=${fields}&timesteps=${timesteps}&startTime=${start}&endTime=${end}&apikey=${TOMORROW_API_KEY}`;
}

function maxIntensityFromTimeline(json) {
  // Estrutura esperada: data.timelines[0].intervals[{ startTime, values: { precipitationIntensity } }]
  const intervals = json?.data?.timelines?.[0]?.intervals || [];
  let max = 0;
  let when = null;
  for (const it of intervals) {
    const v = Number(it?.values?.precipitationIntensity ?? 0);
    if (v > max) { max = v; when = it?.startTime; }
  }
  return { max, when };
}

async function checkRainTomorrowIO() {
  const hits = []; // mensagens
  for (const c of CAPITALS) {
    try {
      const r = await fetch(tlUrl(c.lat, c.lon));
      if (!r.ok) { await sleep(API_DELAY); continue; }
      const data = await r.json();
      const { max, when } = maxIntensityFromTimeline(data);
      if (max >= THRESHOLD_MM_H) {
        const hr = when ? new Date(when).toLocaleTimeString("pt-BR",{ hour:"2-digit", minute:"2-digit" }) : "próx. horas";
        hits.push(`🌧️ <b>${c.name.toUpperCase()}</b>\n~${max.toFixed(1)} mm/h por volta de ${hr}`);
        addCityToday(c.name);
      }
    } catch {}
    await sleep(API_DELAY);
  }
  return hits;
}

// ====== EXECUÇÕES ======
async function monitorRun() {
  const msgs = await checkRainTomorrowIO();
  for (const m of msgs) {
    await tgSend(m);
    await sleep(900);
  }
  console.log(`TomorrowIO hits: ${msgs.length}`);
}

async function dailySummary() {
  const st = loadState();
  const cities = (st.cities || []).slice().sort();
  if (cities.length === 0) {
    await tgSend("✅ Nenhum alerta hoje.");
  } else {
    await tgSend(`⚠️ Houve alertas hoje\nCidades: ${cities.join(", ")}`);
  }
  st.closed = true; saveState(st);
  rollTomorrow();
}

// ====== MAIN ======
async function main() {
  if (!TOKEN) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  if (!TOMORROW_API_KEY && RUN_MODE !== "daily") throw new Error("Falta TOMORROW_API_KEY");

  if (RUN_MODE === "daily") {
    await dailySummary();
  } else {
    await monitorRun();
  }
  console.log(`OK ${RUN_MODE} — ${new Date().toISOString()}`);
}

main().catch(async (e) => {
  try { await tgSend(`❌ Erro: ${e.message}`, false); } catch {}
  process.exit(1);
});
