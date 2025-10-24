// bot.js — INMET + OpenWeather Forecast (ESM) + CACHE DE GEOCODING
// Requer secrets: TELEGRAM_BOT_TOKEN, OPENWEATHER_KEY
// Resumo diário: às 22:00 BRT (01:00 UTC) — só envia “Sem alertas” se NÃO houver alertas
// Chuva: CAPITAIS + MUNICÍPIOS do INMET (com cache de coordenadas em geo_cache.json)

import fetch from "node-fetch";
import fs from "fs";

// ===== CONFIG =====
const CHAT_ID = -1003065918727;
const THRESHOLD_MM_PER_HOUR = 10;
const FORECAST_HOURS = 6;
const SEND_DELAY_MS = 5000;
const API_CALL_DELAY_MS = 400;
const GEOCODE_CALL_DELAY_MS = 300;
const DAILY_SUMMARY_BRT_HOUR = 22;
const CACHE_FILE = "./geo_cache.json";

// ===== BASE =====
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

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function nowBrtHour() {
  const now = new Date();
  return new Date(now.getTime() - 3 * 60 * 60 * 1000).getHours();
}

function fmtMM(n) {
  return Number.isFinite(n) ? (n % 1 === 0 ? String(n) : n.toFixed(1)) : "0";
}

function forecastUrl(lat, lon) {
  return `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br`;
}

function geocodeUrl(city, uf) {
  const q = encodeURIComponent(`${city}, ${uf}, BR`);
  return `https://api.openweathermap.org/geo/1.0/direct?q=${q}&limit=1&appid=${OPENWEATHER_KEY}`;
}

async function sendTelegramHTML(text) {
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
  });
}

// ===== GEOCODE CACHE =====
function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    }
  } catch {}
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (e) {
    console.log("Erro ao salvar cache:", e.message);
  }
}

async function geocodeCity(city, uf, cache) {
  const key = `${city.toLowerCase()}|${uf}`;
  if (cache[key]) return cache[key];
  try {
    const r = await fetch(geocodeUrl(city, uf));
    if (!r.ok) return null;
    const arr = await r.json();
    if (Array.isArray(arr) && arr[0]?.lat) {
      const geo = { lat: arr[0].lat, lon: arr[0].lon };
      cache[key] = geo;
      saveCache(cache);
      await sleep(GEOCODE_CALL_DELAY_MS);
      return geo;
    }
  } catch {}
  return null;
}

// ===== INMET =====
async function fetchINMETAlerts() {
  const r = await fetch("https://apiprevmet3.inmet.gov.br/alerts");
  if (!r.ok) return [];
  const data = await r.json();
  return Array.isArray(data) ? data : [];
}

// ===== CHUVA =====
async function fetchRainAlerts(targets) {
  const alerts = [];
  const now = Date.now() / 1000;
  const horizon = now + FORECAST_HOURS * 3600;
  for (const c of targets) {
    try {
      const r = await fetch(forecastUrl(c.lat, c.lon));
      if (!r.ok) continue;
      const data = await r.json();
      const list = Array.isArray(data?.list) ? data.list : [];
      const next = list.filter((it) => it.dt >= now && it.dt <= horizon);
      let maxMMh = 0;
      let best = null;
      for (const it of next) {
        const mm3h = it?.rain?.["3h"] ?? 0;
        const mmh = mm3h / 3;
        if (mmh > maxMMh) {
          maxMMh = mmh;
          best = it;
        }
      }
      if (best && maxMMh >= THRESHOLD_MM_PER_HOUR) {
        const msg =
          `🌧️ <b>ALERTA DE CHUVA FORTE — ${c.name.toUpperCase()}</b>\n` +
          `Volume previsto: <b>~${fmtMM(maxMMh)} mm/h</b>\n` +
          `Janela: ${new Date(best.dt * 1000).toLocaleTimeString("pt-BR", {hour:"2-digit",minute:"2-digit"})}–${new Date((best.dt + 10800) * 1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`;
        alerts.push(msg);
      }
    } catch {}
    await sleep(API_CALL_DELAY_MS);
  }
  return alerts;
}

// ===== MAIN =====
async function main() {
  const cache = loadCache();
  let sentAny = false;

  // INMET
  const all = await fetchINMETAlerts();
  const allowed = ["Perigo", "Grande Perigo"];
  const byUF = new Map();
  const cities = [];

  for (const a of all) {
    if (!allowed.includes(a.nivel)) continue;
    const uf = a.estado?.toUpperCase?.() || "";
    if (!uf) continue;
    if (!byUF.has(uf)) byUF.set(uf, []);
    byUF.get(uf).push(a);
    if (a.municipio) cities.push({ name: a.municipio, uf });
  }

  for (const [uf, list] of byUF) {
    const msg =
      `⚠️ <b>ALERTA OFICIAL — INMET</b>\n` +
      `<b>ESTADO:</b> ${uf}\n` +
      `<b>Municípios sob alerta:</b> ${list.length}\n` +
      `<b>Nível(is):</b> ${[...new Set(list.map(a=>a.nivel))].join(", ")}`;
    await sendTelegramHTML(msg);
    await sleep(SEND_DELAY_MS);
    sentAny = true;
  }

  // MONTAR ALVOS
  const targets = [...CAPITALS];
  const seen = new Set(targets.map((c)=>`${c.name.toLowerCase()}|${c.uf}`));

  for (const m of cities) {
    const key = `${m.name.toLowerCase()}|${m.uf}`;
    if (seen.has(key)) continue;
    const geo = await geocodeCity(m.name, m.uf, cache);
    if (geo) targets.push({ name:m.name, uf:m.uf, ...geo });
  }

  // CHUVA
  const rain = await fetchRainAlerts(targets);
  for (const m of rain) {
    await sendTelegramHTML(m);
    await sleep(SEND_DELAY_MS);
    sentAny = true;
  }

  // SEM ALERTAS
  if (!sentAny && nowBrtHour() === DAILY_SUMMARY_BRT_HOUR) {
    await sendTelegramHTML("✅ Sem alertas no momento");
  }

  console.log(`Execução: INMET=${byUF.size}, CHUVA=${rain.length}, sentAny=${sentAny}`);
}

main();
