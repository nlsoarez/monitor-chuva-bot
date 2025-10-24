// bot.js — INMET + OpenWeather Forecast (ESM) + CACHE DE GEOCODING
// Requer secrets: TELEGRAM_BOT_TOKEN, OPENWEATHER_KEY
// Resumo diário: às 22:00 BRT (01:00 UTC) — só envia "Sem alertas" se NÃO houver alertas
// Chuva: CAPITAIS + MUNICÍPIOS do INMET (com cache de coordenadas em geo_cache.json)

import fetch from "node-fetch";
import fs from "fs";

// ===== CONFIG =====
const config = {
  CHAT_ID: process.env.CHAT_ID || -1003065918727,
  THRESHOLD_MM_PER_HOUR: parseInt(process.env.RAIN_THRESHOLD) || 10,
  FORECAST_HOURS: parseInt(process.env.FORECAST_HOURS) || 6,
  SEND_DELAY_MS: parseInt(process.env.SEND_DELAY) || 5000,
  API_CALL_DELAY_MS: parseInt(process.env.API_DELAY) || 400,
  GEOCODE_CALL_DELAY_MS: parseInt(process.env.GEOCODE_DELAY) || 300,
  DAILY_SUMMARY_BRT_HOUR: parseInt(process.env.SUMMARY_HOUR) || 22,
  CACHE_FILE: "./geo_cache.json",
  CACHE_EXPIRY_DAYS: 30,
  RETRY_ATTEMPTS: 3,
  RETRY_DELAY: 1000
};

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

// ===== LOGGING =====
function log(message, level = 'info') {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  console.log(logMessage);
}

// ===== ERROR HANDLING & RETRY =====
async function fetchWithRetry(url, retries = config.RETRY_ATTEMPTS) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      log(`Attempt ${i + 1} failed with status: ${response.status}`, 'warn');
    } catch (error) {
      log(`Attempt ${i + 1} failed: ${error.message}`, 'warn');
      if (i === retries - 1) throw error;
    }
    await sleep(config.RETRY_DELAY * (i + 1));
  }
  return null;
}

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
  try {
    const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: config.CHAT_ID, text, parse_mode: "HTML" }),
    });
    
    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status}`);
    }
    
    log(`Message sent successfully: ${text.substring(0, 50)}...`);
    return true;
  } catch (error) {
    log(`Failed to send Telegram message: ${error.message}`, 'error');
    return false;
  }
}

// ===== MESSAGE FORMATTING =====
function formatRainAlert(city, maxMMh, best) {
  const startTime = new Date(best.dt * 1000);
  const endTime = new Date((best.dt + 10800) * 1000);
  const timeOptions = { hour: '2-digit', minute: '2-digit' };
  
  return `🌧️ <b>ALERTA DE CHUVA FORTE — ${city.name.toUpperCase()}</b>\n` +
         `Volume previsto: <b>~${fmtMM(maxMMh)} mm/h</b>\n` +
         `Janela: ${startTime.toLocaleTimeString('pt-BR', timeOptions)}–${endTime.toLocaleTimeString('pt-BR', timeOptions)}\n` +
         `UF: ${city.uf}`;
}

function formatINMETAlert(uf, list) {
  return `⚠️ <b>ALERTA OFICIAL — INMET</b>\n` +
         `<b>ESTADO:</b> ${uf}\n` +
         `<b>Municípios sob alerta:</b> ${list.length}\n` +
         `<b>Nível(is):</b> ${[...new Set(list.map(a => a.nivel))].join(", ")}`;
}

// ===== GEOCODE CACHE =====
function loadCache() {
  try {
    if (fs.existsSync(config.CACHE_FILE)) {
      const cache = JSON.parse(fs.readFileSync(config.CACHE_FILE, "utf8"));
      // Clean expired entries (older than CACHE_EXPIRY_DAYS)
      const now = Date.now();
      const expiryMs = config.CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
      const cleanedCache = {};
      
      for (const [key, value] of Object.entries(cache)) {
        if (value.timestamp && (now - value.timestamp) < expiryMs) {
          cleanedCache[key] = value;
        }
      }
      
      const removed = Object.keys(cache).length - Object.keys(cleanedCache).length;
      if (removed > 0) {
        log(`Removed ${removed} expired cache entries`);
      }
      
      return cleanedCache;
    }
  } catch (error) {
    log(`Error loading cache: ${error.message}`, 'error');
  }
  return {};
}

function saveCache(cache) {
  try {
    fs.writeFileSync(config.CACHE_FILE, JSON.stringify(cache, null, 2));
    log(`Cache saved with ${Object.keys(cache).length} entries`);
  } catch (error) {
    log(`Error saving cache: ${error.message}`, 'error');
  }
}

async function geocodeCity(city, uf, cache) {
  const key = `${city.toLowerCase()}|${uf}`;
  
  // Check cache first
  if (cache[key] && cache[key].geo) {
    log(`Cache hit for ${city}, ${uf}`);
    return cache[key].geo;
  }
  
  log(`Geocoding ${city}, ${uf}`);
  
  try {
    const response = await fetchWithRetry(geocodeUrl(city, uf));
    if (!response) return null;
    
    const arr = await response.json();
    if (Array.isArray(arr) && arr[0]?.lat) {
      const geo = { lat: arr[0].lat, lon: arr[0].lon };
      cache[key] = { geo, timestamp: Date.now() };
      saveCache(cache);
      await sleep(config.GEOCODE_CALL_DELAY_MS);
      log(`Geocoded ${city}, ${uf} → ${geo.lat}, ${geo.lon}`);
      return geo;
    }
  } catch (error) {
    log(`Geocoding failed for ${city}, ${uf}: ${error.message}`, 'error');
  }
  
  return null;
}

// ===== HEALTH CHECK =====
async function healthCheck() {
  try {
    log('Starting health check...');
    
    // Test OpenWeather API
    const testUrl = forecastUrl(-23.5505, -46.6333); // São Paulo
    const response = await fetch(testUrl);
    if (!response.ok) throw new Error('OpenWeather API unavailable');
    
    // Test Telegram API
    const telegramResponse = await fetch(`https://api.telegram.org/bot${TOKEN}/getMe`);
    if (!telegramResponse.ok) throw new Error('Telegram API unavailable');
    
    log('All health checks passed');
    return true;
  } catch (error) {
    log(`Health check failed: ${error.message}`, 'error');
    return false;
  }
}

// ===== INMET =====
async function fetchINMETAlerts() {
  try {
    log('Fetching INMET alerts...');
    const response = await fetchWithRetry("https://apiprevmet3.inmet.gov.br/alerts");
    if (!response) {
      log('Failed to fetch INMET alerts after retries', 'error');
      return [];
    }
    
    const data = await response.json();
    const alerts = Array.isArray(data) ? data : [];
    log(`Fetched ${alerts.length} INMET alerts`);
    return alerts;
  } catch (error) {
    log(`Error fetching INMET alerts: ${error.message}`, 'error');
    return [];
  }
}

// ===== CHUVA =====
async function fetchRainAlerts(targets) {
  const alerts = [];
  const now = Date.now() / 1000;
  const horizon = now + config.FORECAST_HOURS * 3600;
  
  log(`Checking rain alerts for ${targets.length} locations...`);
  
  for (const c of targets) {
    try {
      const response = await fetchWithRetry(forecastUrl(c.lat, c.lon));
      if (!response) continue;
      
      const data = await response.json();
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
      
      if (best && maxMMh >= config.THRESHOLD_MM_PER_HOUR) {
        const msg = formatRainAlert(c, maxMMh, best);
        alerts.push(msg);
        log(`Rain alert for ${c.name}, ${c.uf}: ${fmtMM(maxMMh)} mm/h`);
      }
    } catch (error) {
      log(`Error processing ${c.name}: ${error.message}`, 'error');
    }
    
    await sleep(config.API_CALL_DELAY_MS);
  }
  
  log(`Found ${alerts.length} rain alerts`);
  return alerts;
}

// ===== MAIN =====
async function main() {
  log('Starting weather alert bot...');
  
  // Optional health check (continue even if it fails)
  await healthCheck();
  
  const cache = loadCache();
  let sentAny = false;

  // INMET Alerts
  const allAlerts = await fetchINMETAlerts();
  const allowedLevels = ["Perigo", "Grande Perigo"];
  const alertsByUF = new Map();
  const alertCities = [];

  for (const alert of allAlerts) {
    if (!allowedLevels.includes(alert.nivel)) continue;
    const uf = alert.estado?.toUpperCase?.() || "";
    if (!uf) continue;
    
    if (!alertsByUF.has(uf)) alertsByUF.set(uf, []);
    alertsByUF.get(uf).push(alert);
    
    if (alert.municipio) {
      alertCities.push({ name: alert.municipio, uf });
    }
  }

  // Send INMET alerts
  for (const [uf, alertsList] of alertsByUF) {
    const message = formatINMETAlert(uf, alertsList);
    const sent = await sendTelegramHTML(message);
    if (sent) {
      sentAny = true;
      await sleep(config.SEND_DELAY_MS);
    }
  }

  // Build target list for rain alerts
  const rainTargets = [...CAPITALS];
  const seenTargets = new Set(rainTargets.map((c) => `${c.name.toLowerCase()}|${c.uf}`));

  for (const municipality of alertCities) {
    const key = `${municipality.name.toLowerCase()}|${municipality.uf}`;
    if (seenTargets.has(key)) continue;
    
    const geo = await geocodeCity(municipality.name, municipality.uf, cache);
    if (geo) {
      rainTargets.push({ 
        name: municipality.name, 
        uf: municipality.uf, 
        ...geo 
      });
      seenTargets.add(key);
    }
  }

  log(`Total targets for rain check: ${rainTargets.length}`);

  // Rain Alerts
  const rainAlerts = await fetchRainAlerts(rainTargets);
  for (const alertMessage of rainAlerts) {
    const sent = await sendTelegramHTML(alertMessage);
    if (sent) {
      sentAny = true;
      await sleep(config.SEND_DELAY_MS);
    }
  }

  // Daily Summary
  if (!sentAny && nowBrtHour() === config.DAILY_SUMMARY_BRT_HOUR) {
    await sendTelegramHTML("✅ Sem alertas no momento");
    log("Sent daily summary: No alerts");
  }

  log(`Execution completed: INMET=${alertsByUF.size}, RAIN=${rainAlerts.length}, SENT=${sentAny}`);
}

// ===== CONTINUOUS MODE =====
async function runScheduler() {
  log('Starting continuous mode...');
  
  while (true) {
    await main();
    
    // Calculate next run (30 minutes from now, aligned to minute)
    const now = new Date();
    const nextRun = new Date(now);
    nextRun.setMinutes(nextRun.getMinutes() + 30);
    nextRun.setSeconds(0);
    nextRun.setMilliseconds(0);
    
    const delay = nextRun.getTime() - now.getTime();
    log(`Next run at: ${nextRun.toISOString()}`);
    
    await sleep(Math.max(delay, 60000)); // Minimum 1 minute delay
  }
}

// ===== STARTUP =====
if (!TOKEN || !OPENWEATHER_KEY) {
  log('Missing required environment variables: TELEGRAM_BOT_TOKEN and OPENWEATHER_KEY must be set', 'error');
  process.exit(1);
}

// Run based on command line argument
if (process.argv.includes('--continuous')) {
  runScheduler().catch(error => {
    log(`Fatal error in continuous mode: ${error.message}`, 'error');
    process.exit(1);
  });
} else {
  main().catch(error => {
    log(`Fatal error: ${error.message}`, 'error');
    process.exit(1);
  });
}
