import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// ===================== CONFIG GERAL =====================
const CHAT_ID = -1003065918727;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TOMORROW_API_KEY = process.env.TOMORROW_API_KEY;
const RUN_MODE = process.env.RUN_MODE || "monitor";

const HORIZON_HOURS = 6;
const THRESHOLD_MM_H = 10;
const API_DELAY = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===================== PERSISTÊNCIA =====================
const dataDir = path.join(process.cwd(), "data");
const cacheDir = path.join(process.cwd(), ".cache");
const todayStr = () => new Date().toISOString().slice(0, 10);
const stateFile = (d = todayStr()) => path.join(dataDir, `${d}.json`);
const alertsCacheFile = () => path.join(cacheDir, "alerts.json");

function ensureData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(stateFile()))
    fs.writeFileSync(
      stateFile(),
      JSON.stringify({ cities: [], closed: false }, null, 2)
    );
  if (!fs.existsSync(alertsCacheFile()))
    fs.writeFileSync(alertsCacheFile(), JSON.stringify({ sent: {} }, null, 2));
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

function loadAlertCache() {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(alertsCacheFile(), "utf-8"));
  } catch {
    return { sent: {} };
  }
}

function saveAlertCache(cache) {
  ensureData();
  fs.writeFileSync(alertsCacheFile(), JSON.stringify(cache, null, 2));
}

function wasAlertSent(key) {
  const cache = loadAlertCache();
  const today = todayStr();
  return cache.sent[key] === today;
}

function markAlertSent(key) {
  const cache = loadAlertCache();
  const today = todayStr();
  cache.sent[key] = today;
  
  // Limpa alertas antigos (mais de 7 dias)
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const cutoff = weekAgo.toISOString().slice(0, 10);
  
  for (const k in cache.sent) {
    if (cache.sent[k] < cutoff) delete cache.sent[k];
  }
  
  saveAlertCache(cache);
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
  try {
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
    const result = await r.json();
    if (!result.ok) {
      console.error("Telegram API error:", result);
    }
    return result;
  } catch (e) {
    console.error("Erro ao enviar mensagem:", e.message);
    return null;
  }
}

async function tgPin(message_id) {
  try {
    await fetch(
      `https://api.telegram.org/bot${TOKEN}/pinChatMessage?chat_id=${CHAT_ID}&message_id=${message_id}&disable_notification=false`
    );
  } catch (e) {
    console.error("Erro ao fixar mensagem:", e.message);
  }
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

// ===================== TOMORROW.IO =====================
function forecastUrl(lat, lon) {
  return `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&timesteps=1h&apikey=${TOMORROW_API_KEY}`;
}

function alertsUrl(lat, lon) {
  return `https://api.tomorrow.io/v4/weather/alerts?location=${lat},${lon}&apikey=${TOMORROW_API_KEY}`;
}

function extractHeavyRainHours(forecastJson) {
  const timelines = forecastJson?.timelines || [];
  let hourly = [];
  
  // Procura pela timeline horária
  for (const timeline of timelines) {
    if (timeline.timestep === "1h" || timeline.timestep === "1hour") {
      hourly = timeline.intervals || [];
      break;
    }
  }
  
  if (hourly.length === 0) {
    console.log("⚠️ Nenhum dado horário encontrado na resposta");
    return [];
  }

  const now = Date.now();
  const limit = now + HORIZON_HOURS * 3600 * 1000;
  const hits = [];

  for (const interval of hourly) {
    const t = new Date(interval?.startTime).getTime();
    if (!t || t > limit) continue;
    
    const precip = Number(interval?.values?.precipitationIntensity ?? 0);
    
    if (precip >= THRESHOLD_MM_H) {
      const hh = new Date(t).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      hits.push({ time: hh, value: precip });
    }
  }
  
  return hits;
}

function normalizeSeverity(s) {
  const x = (s || "").toString().toLowerCase();
  if (x.includes("red") || x.includes("vermelh") || x.includes("extreme")) return "red";
  if (x.includes("orange") || x.includes("laranj") || x.includes("severe")) return "orange";
  if (x.includes("yellow") || x.includes("amarel") || x.includes("moderate")) return "yellow";
  return x || "unknown";
}

function summarizeAlert(a, cityLabel) {
  const sev = normalizeSeverity(a?.severity);
  const event = a?.event || a?.eventType || "Alerta meteorológico";
  const desc = a?.description || "";
  
  const end = a?.timeEnd || a?.expiresTime || a?.expires || a?.ends || null;
  const endTxt = end
    ? new Date(end).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        day: "2-digit",
        month: "2-digit",
      })
    : "em aberto";

  let text = `🚨 <b>ALERTA ${sev.toUpperCase()}</b> — ${cityLabel}\n`;
  text += `📍 Evento: ${event}\n`;
  if (desc && desc.length < 200) text += `ℹ️ ${desc}\n`;
  text += `⏰ Válido até: ${endTxt}`;
  
  return { sev, text };
}

// ===================== PROCESSAMENTO =====================
async function processAlertsForCity(city) {
  try {
    console.log(`🔍 Verificando alertas para ${city.name}...`);
    const r = await fetch(alertsUrl(city.lat, city.lon));
    
    if (!r.ok) {
      console.log(`❌ API retornou status ${r.status} para ${city.name}`);
      return;
    }
    
    const data = await r.json();
    const alerts = data?.alerts || data?.data?.alerts || data?.data || [];
    
    if (!Array.isArray(alerts) || alerts.length === 0) {
      console.log(`✅ Nenhum alerta para ${city.name}`);
      return;
    }
    
    console.log(`⚠️ ${alerts.length} alerta(s) encontrado(s) para ${city.name}`);
    
    for (const a of alerts) {
      const alertKey = `alert_${city.name}_${a?.event || 'unknown'}_${a?.severity || 'unknown'}`;
      
      if (wasAlertSent(alertKey)) {
        console.log(`⏭️ Alerta já enviado hoje: ${alertKey}`);
        continue;
      }
      
      const { sev, text } = summarizeAlert(a, city.name.toUpperCase());
      const sent = await tgSend(text);
      
      if (sent?.ok) {
        markAlertSent(alertKey);
        addCityToday(city.name);
        
        if (sev === "red" && sent?.result?.message_id) {
          await tgPin(sent.result.message_id);
        }
        
        console.log(`✉️ Alerta enviado: ${city.name} (${sev})`);
      }
      
      await sleep(600);
    }
  } catch (e) {
    console.error(`❌ Erro ao processar alertas de ${city.name}:`, e.message);
  }
}

async function processRainForCity(city) {
  try {
    console.log(`🌧️ Verificando chuva para ${city.name}...`);
    const r = await fetch(forecastUrl(city.lat, city.lon));
    
    if (!r.ok) {
      console.log(`❌ API retornou status ${r.status} para ${city.name}`);
      return;
    }
    
    const data = await r.json();
    const hours = extractHeavyRainHours(data);
    
    if (hours.length === 0) {
      console.log(`✅ Sem chuva forte prevista para ${city.name}`);
      return;
    }
    
    console.log(`🌧️ ${hours.length} período(s) de chuva forte para ${city.name}`);
    
    for (const h of hours) {
      const rainKey = `rain_${city.name}_${h.time}_${todayStr()}`;
      
      if (wasAlertSent(rainKey)) {
        console.log(`⏭️ Chuva já reportada: ${rainKey}`);
        continue;
      }
      
      const msg = `🌧️ <b>Chuva forte prevista</b> em <b>${city.name.toUpperCase()}</b>\n⏰ Horário: ${h.time}\n💧 Intensidade: ${h.value.toFixed(1)} mm/h`;
      const sent = await tgSend(msg);
      
      if (sent?.ok) {
        markAlertSent(rainKey);
        addCityToday(city.name);
        console.log(`✉️ Alerta de chuva enviado: ${city.name} às ${h.time}`);
      }
      
      await sleep(600);
    }
  } catch (e) {
    console.error(`❌ Erro ao processar chuva de ${city.name}:`, e.message);
  }
}

// ===================== EXECUÇÕES =====================
async function monitorRun() {
  console.log(`\n🚀 Iniciando monitoramento às ${new Date().toLocaleString('pt-BR')}`);
  let alertsCount = 0;
  let rainCount = 0;
  
  for (const c of CAPITALS) {
    console.log(`\n--- Processando: ${c.name} (${c.uf}) ---`);
    
    const beforeAlerts = loadState().cities.length;
    await processAlertsForCity(c);
    const afterAlerts = loadState().cities.length;
    if (afterAlerts > beforeAlerts) alertsCount++;
    
    const beforeRain = loadState().cities.length;
    await processRainForCity(c);
    const afterRain = loadState().cities.length;
    if (afterRain > beforeRain) rainCount++;
    
    await sleep(API_DELAY);
  }
  
  console.log(`\n✅ Monitor concluído às ${new Date().toLocaleString('pt-BR')}`);
  console.log(`📊 Resumo: ${alertsCount} alertas, ${rainCount} previsões de chuva`);
}

async function dailySummary() {
  console.log(`\n📋 Gerando resumo diário às ${new Date().toLocaleString('pt-BR')}`);
  
  const st = loadState();
  const cities = (st.cities || []).slice().sort();
  
  if (cities.length === 0) {
    await tgSend("✅ <b>Resumo Diário</b>\n\nNenhum alerta registrado hoje. Tudo tranquilo! 🌤️");
  } else {
    const msg = `⚠️ <b>Resumo Diário</b>\n\n${cities.length} cidade(s) com alertas hoje:\n\n${cities.join(", ")}`;
    await tgSend(msg);
  }
  
  st.closed = true;
  saveState(st);
  rollTomorrow();
  
  console.log(`✅ Resumo enviado. ${cities.length} cidades com alertas.`);
}

// ===================== MAIN =====================
async function main() {
  if (!TOKEN) {
    throw new Error("❌ Falta TELEGRAM_BOT_TOKEN");
  }
  
  if (!TOMORROW_API_KEY && RUN_MODE !== "daily") {
    throw new Error("❌ Falta TOMORROW_API_KEY");
  }

  if (RUN_MODE === "daily") {
    await dailySummary();
  } else {
    await monitorRun();
  }
}

main().catch(async (e) => {
  console.error("❌ ERRO FATAL:", e.message);
  console.error(e.stack);
  
  try {
    await tgSend(`❌ <b>Erro no Monitor</b>\n\n${e.message}`, true);
  } catch (telegramError) {
    console.error("❌ Não foi possível enviar erro ao Telegram:", telegramError.message);
  }
  
  process.exit(1);
});
