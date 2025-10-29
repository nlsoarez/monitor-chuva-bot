import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// ===================== CONFIG GERAL =====================
const CHAT_ID = -1003065918727; // seu grupo/privado
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TOMORROW_API_KEY = process.env.TOMORROW_API_KEY;
const RUN_MODE = process.env.RUN_MODE || "monitor"; // "monitor" (2h) | "daily" (22h)

// Regras definidas por você
const HORIZON_HOURS = 6;     // próximas 6h
const THRESHOLD_MM_H = 10;   // chuva forte
const API_DELAY = 350;       // espaçamento entre chamadas (ms)

// util
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===================== PERSISTÊNCIA =====================
const dataDir = path.join(process.cwd(), "data");
const todayStr = () => new Date().toISOString().slice(0, 10);
const stateFile = (d = todayStr()) => path.join(dataDir, `${d}.json`);

function ensureData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(stateFile()))
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ cities: [], closed: false }, null, 2)
    );
}

function loadState() {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf-8"));
  } catch {
    return { cities: [], closed: false };
  }
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
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const ymd = d.toISOString().slice(0, 10);
  const f = path.join(dataDir, `${ymd}.json`);
  if (!fs.existsSync(f))
    fs.writeFileSync(f, JSON.stringify({ cities: [], closed: false }, null, 2));
}

// ===================== TELEGRAM =====================
async function tgSend(text, html = true) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: html ? "HTML" : undefined,
      disable_web_page_preview: true,
    }),
  });
  return r.json();
}

async function tgPin(message_id) {
  try {
    await fetch(
      `https://api.telegram.org/bot${TOKEN}/pinChatMessage?chat_id=${CHAT_ID}&message_id=${message_id}&disable_notification=false`
    );
  } catch {}
}

// ===================== CIDADES (capitais) =====================
const CAPITALS = [
  { uf: "AC", name: "Rio Branco", lat: -9.97499, lon: -67.8243 },
  { uf: "AL", name: "Maceió", lat: -9.64985, lon: -35.70895 },
  { uf: "AP", name: "Macapá", lat: 0.03493, lon: -51.0694 },
  { uf: "AM", name: "Manaus", lat: -3.11903, lon: -60.02173 },
  { uf: "BA", name: "Salvador", lat: -12.97304, lon: -38.5023 },
  { uf: "CE", name: "Fortaleza", lat: -3.73186, lon: -38.52667 },
  { uf: "DF", name: "Brasília", lat: -15.79389, lon: -47.88278 },
  { uf: "ES", name: "Vitória", lat: -20.3155, lon: -40.3128 },
  { uf: "GO", name: "Goiânia", lat: -16.6864, lon: -49.2643 },
  { uf: "MA", name: "São Luís", lat: -2.53874, lon: -44.2825 },
  { uf: "MT", name: "Cuiabá", lat: -15.601, lon: -56.0974 },
  { uf: "MS", name: "Campo Grande", lat: -20.4697, lon: -54.6201 },
  { uf: "MG", name: "Belo Horizonte", lat: -19.91668, lon: -43.93449 },
  { uf: "PA", name: "Belém", lat: -1.45502, lon: -48.5024 },
  { uf: "PB", name: "João Pessoa", lat: -7.11509, lon: -34.8641 },
  { uf: "PR", name: "Curitiba", lat: -25.42836, lon: -49.27325 },
  { uf: "PE", name: "Recife", lat: -8.04756, lon: -34.877 },
  { uf: "PI", name: "Teresina", lat: -5.09194, lon: -42.80336 },
  { uf: "RJ", name: "Rio de Janeiro", lat: -22.90685, lon: -43.1729 },
  { uf: "RN", name: "Natal", lat: -5.795, lon: -35.20944 },
  { uf: "RO", name: "Porto Velho", lat: -8.76077, lon: -63.8999 },
  { uf: "RR", name: "Boa Vista", lat: 2.82384, lon: -60.6753 },
  { uf: "RS", name: "Porto Alegre", lat: -30.03465, lon: -51.21766 },
  { uf: "SC", name: "Florianópolis", lat: -27.5945, lon: -48.5477 },
  { uf: "SE", name: "Aracaju", lat: -10.9091, lon: -37.0677 },
  { uf: "SP", name: "São Paulo", lat: -23.55052, lon: -46.63331 },
  { uf: "TO", name: "Palmas", lat: -10.184, lon: -48.3336 },
];

// ===================== TOMORROW.IO — Forecast & Alerts =====================
// Forecast (horário) — endpoint oficial
function forecastUrl(lat, lon) {
  return `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&apikey=${TOMORROW_API_KEY}`;
}
// Alerts — endpoint oficial
function alertsUrl(lat, lon) {
  return `https://api.tomorrow.io/v4/weather/alerts?location=${lat},${lon}&apikey=${TOMORROW_API_KEY}`;
}

// Extrai horas com precipitação >= limiar nas próximas HORIZON_HOURS
function extractHeavyRainHours(forecastJson) {
  // Estrutura esperada: data.timelines.hourly = [{ time, values: { precipitationIntensity } }, ...]
  const hourly = forecastJson?.timelines?.hourly || [];
  const now = Date.now();
  const limit = now + HORIZON_HOURS * 3600 * 1000;

  const hits = [];
  for (const it of hourly) {
    const t = new Date(it?.time).getTime();
    if (!t || t > limit) continue;
    const v = Number(it?.values?.precipitationIntensity ?? 0);
    if (v >= THRESHOLD_MM_H) {
      const hh = new Date(t).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      hits.push({ time: hh, value: v });
    }
  }
  return hits;
}

// Normaliza severidade (para decidir se fixa)
function normalizeSeverity(s) {
  const x = (s || "").toString().toLowerCase();
  if (x.includes("red") || x.includes("vermelh")) return "red";
  if (x.includes("orange") || x.includes("laranj")) return "orange";
  if (x.includes("yellow") || x.includes("amarel")) return "yellow";
  return x || "unknown";
}

// Resume alerta do Tomorrow.io
function summarizeAlert(a, cityLabel) {
  // Estruturas prováveis:
  // a.severity, a.event, a.description, a.timeOnset / a.timeEnd / a.effectiveTime / a.expiresTime
  const sev = normalizeSeverity(a?.severity);
  const event = a?.event || "Alerta meteorológico";
  const end =
    a?.timeEnd ||
    a?.expiresTime ||
    a?.expires ||
    a?.ends ||
    a?.effectiveTimeEnd ||
    null;

  const endTxt = end
    ? new Date(end).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "em aberto";

  const text = `🚨 ALERTA (${sev.toUpperCase()}) — ${cityLabel}\nEvento: ${event}\nVálido até: ${endTxt}`;
  return { sev, text };
}

// ===================== ROTINAS DE MONITORAMENTO =====================
// 1) ALERTAS (Tomorrow.io) — prioridade 1
async function processAlertsForCity(city) {
  try {
    const r = await fetch(alertsUrl(city.lat, city.lon));
    if (!r.ok) return;
    const data = await r.json();
    const alerts = data?.alerts || data?.data?.alerts || []; // atende variações
    for (const a of alerts) {
      const { sev, text } = summarizeAlert(a, city.name.toUpperCase());
      const sent = await tgSend(text);
      if (sev === "red" && sent?.result?.message_id) {
        // fixa se vermelho
        await tgPin(sent.result.message_id);
      }
      addCityToday(city.name); // conta pro resumo
      await sleep(600);
    }
  } catch {}
}

// 2) CHUVA (Tomorrow.io) — prioridade 2
async function processRainForCity(city) {
  try {
    const r = await fetch(forecastUrl(city.lat, city.lon));
    if (!r.ok) return;
    const data = await r.json();
    const hours = extractHeavyRainHours(data); // [{time,value}]

    // sua escolha: 1 mensagem POR HORA detectada
    for (const h of hours) {
      const msg = `🌧️ Chuva forte prevista em <b>${city.name.toUpperCase()}</b> às ${h.time} — ${h.value.toFixed(
        1
      )} mm/h`;
      await tgSend(msg);
      addCityToday(city.name);
      await sleep(600);
    }
  } catch {}
}

// ===================== EXECUÇÕES =====================
async function monitorRun() {
  // Para cada capital:
  for (const c of CAPITALS) {
    // 1) ALERTAS oficiais primeiro
    await processAlertsForCity(c);
    // 2) Depois CHUVA prevista
    await processRainForCity(c);
    await sleep(API_DELAY);
  }
  console.log(`Monitor run OK — ${new Date().toISOString()}`);
}

async function dailySummary() {
  const st = loadState();
  const cities = (st.cities || []).slice().sort();
  if (cities.length === 0) {
    await tgSend("✅ Nenhum alerta hoje.");
  } else {
    await tgSend(`⚠️ Houve alertas hoje\nCidades: ${cities.join(", ")}`);
  }
  st.closed = true;
  saveState(st);
  rollTomorrow();
  console.log(`Daily summary OK — ${new Date().toISOString()}`);
}

// ===================== MAIN =====================
async function main() {
  if (!TOKEN) throw new Error("Falta TELEGRAM_BOT_TOKEN");
  if (!TOMORROW_API_KEY && RUN_MODE !== "daily")
    throw new Error("Falta TOMORROW_API_KEY");

  if (RUN_MODE === "daily") {
    await dailySummary();
  } else {
    await monitorRun();
  }
}
main().catch(async (e) => {
  try {
    await tgSend(`❌ Erro: ${e.message}`, false);
  } catch {}
  process.exit(1);
});
