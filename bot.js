// bot.js — INMET + OpenWeather Forecast (ESM)
// Requer secrets: TELEGRAM_BOT_TOKEN, OPENWEATHER_KEY
// Ordem de envio: 1) INMET (oficial)  2) CHUVA (previsão forte)
// Resumo diário: envia "Sem alertas" 1x/dia na execução mais próxima de 22:00 BRT (usaremos 23:00 BRT pela cadência de 2h)

import fetch from "node-fetch";

// ===== CONFIG GERAL =====
const CHAT_ID = -1003065918727;          // id do grupo
const THRESHOLD_MM_PER_HOUR = 10;        // limite para alerta de chuva
const FORECAST_HOURS = 6;                // horizonte de previsão (próximas 6h)
const SEND_DELAY_MS = 5000;              // delay entre mensagens (evita flood)
const API_CALL_DELAY_MS = 400;           // pausa pequena entre chamadas
const DAILY_SUMMARY_BRT_HOUR = 23;       // execução mais próxima de 22:00 BRT (cron a cada 2h → 23:00 BRT)

// ===== CAPITAIS (chuva prevista por capitais) =====
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

// ===== SECRETS =====
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;

// ===== HELPERS =====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function toBRTime(tsSec) {
  return new Date(tsSec * 1000).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function nowBrtHour() {
  // Aproximação estática BRT = UTC-3
  const now = new Date();
  const brtMs = now.getTime() - 3 * 60 * 60 * 1000;
  return new Date(brtMs).getHours();
}

function fmtMM(n) {
  return Number.isFinite(n) ? (n % 1 === 0 ? String(n) : n.toFixed(1)) : "0";
}

function forecastUrl(lat, lon) {
  return `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br`;
}

async function sendTelegramHTML(text) {
  const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
  });
  const data = await resp.json();
  if (!data?.ok) console.log("ERRO TELEGRAM:", data);
  return data;
}

// ===== INMET =====
async function fetchINMETAlerts() {
  try {
    const r = await fetch("https://apiprevmet3.inmet.gov.br/alerts");
    if (!r.ok) {
      console.log("INMET HTTP", r.status);
      return [];
    }
    const data = await r.json();
    if (!Array.isArray(data)) return [];

    // Filtra níveis: apenas "Perigo" e "Grande Perigo"
    const allowed = new Set(["Perigo", "Grande Perigo"]);
    const filtered = data.filter((a) => allowed.has(a?.nivel));

    // Agrupa por estado (1 mensagem por estado)
    const byUF = new Map();
    for (const a of filtered) {
      const uf = (a?.estado || "").toUpperCase();
      if (!uf) continue;
      if (!byUF.has(uf)) {
        byUF.set(uf, {
          uf,
          count: 0,
          // contar por severidade
          danger: 0,       // Perigo
          greatDanger: 0,  // Grande Perigo
          earliestStart: null,
          latestEnd: null,
        });
      }
      const entry = byUF.get(uf);
      entry.count += 1;
      if (a.nivel === "Perigo") entry.danger += 1;
      else if (a.nivel === "Grande Perigo") entry.greatDanger += 1;

      const start = a?.inicio ? Date.parse(a.inicio) : null;
      const end = a?.fim ? Date.parse(a.fim) : null;
      if (start && (!entry.earliestStart || start < entry.earliestStart)) entry.earliestStart = start;
      if (end && (!entry.latestEnd || end > entry.latestEnd)) entry.latestEnd = end;
    }

    // Gera mensagens por UF (formato oficial com ⚠️)
    const messages = [];
    for (const [, st] of byUF) {
      const startTxt = st.earliestStart
        ? new Date(st.earliestStart).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false })
        : "-";
      const endTxt = st.latestEnd
        ? new Date(st.latestEnd).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false })
        : "-";

      const levels =
        st.greatDanger > 0 && st.danger > 0
          ? `Grande Perigo (${st.greatDanger}) / Perigo (${st.danger})`
          : st.greatDanger > 0
          ? `Grande Perigo (${st.greatDanger})`
          : `Perigo (${st.danger})`;

      const msg =
        `⚠️ <b>ALERTA OFICIAL — INMET</b>\n` +
        `<b>ESTADO:</b> ${st.uf}\n` +
        `<b>Municípios sob alerta:</b> ${st.count}\n` +
        `<b>Nível(is):</b> ${levels}\n` +
        `<b>Vigência aprox.:</b> ${startTxt}–${endTxt}`;
      messages.push(msg);
    }

    return messages;
  } catch (e) {
    console.log("Erro INMET:", e.message);
    return [];
  }
}

// ===== CHUVA (OpenWeather Forecast) =====
function mmhFromRain3h(rain3h) {
  const mm3h = Number(rain3h ?? 0);
  if (!Number.isFinite(mm3h)) return 0;
  return mm3h / 3;
}

async function fetchRainAlerts() {
  const alerts = [];
  const now = Date.now() / 1000;
  const horizon = now + FORECAST_HOURS * 3600;

  for (const c of CITIES) {
    try {
      const r = await fetch(forecastUrl(c.lat, c.lon));
      if (!r.ok) {
        console.log(`Forecast falhou em ${c.name}: HTTP ${r.status}`);
        await sleep(API_CALL_DELAY_MS);
        continue;
      }
      const data = await r.json();
      const list = Array.isArray(data?.list) ? data.list : [];

      const next = list.filter((it) => it.dt >= now && it.dt <= horizon);

      let maxMMh = 0;
      let best = null;
      for (const it of next) {
        const mm3h = it?.rain?.["3h"] ?? 0;
        const mmh = mmhFromRain3h(mm3h);
        if (mmh > maxMMh) {
          maxMMh = mmh;
          best = it;
        }
      }

      if (best && maxMMh >= THRESHOLD_MM_PER_HOUR) {
        const start = toBRTime(best.dt);
        const end = toBRTime(best.dt + 3 * 3600);
        const msg =
          `🌧️ <b>ALERTA DE CHUVA FORTE — ${c.name.toUpperCase()}</b>\n` +
          `Volume previsto: <b>~${fmtMM(maxMMh)} mm/h</b>\n` +
          `Janela estimada: <b>${start}–${end}</b>\n` +
          `Fique atento a possíveis alagamentos.`;
        alerts.push(msg);
      }
    } catch (e) {
      console.log(`Erro em ${c.name}:`, e.message);
    }
    await sleep(API_CALL_DELAY_MS);
  }

  return alerts;
}

// ===== RESUMO DIÁRIO =====
function shouldSendDailySummary() {
  // Janela mais próxima de 22:00 BRT considerando cron de 2h → usamos 23:00 BRT
  return nowBrtHour() === DAILY_SUMMARY_BRT_HOUR;
}

// ===== MAIN =====
async function main() {
  if (!TOKEN) {
    console.log("ERRO: TELEGRAM_BOT_TOKEN ausente.");
    process.exit(1);
  }
  if (!OPENWEATHER_KEY) {
    console.log("ERRO: OPENWEATHER_KEY ausente.");
    process.exit(1);
  }

  let sentAny = false;

  // 1) INMET primeiro
  const inmetMessages = await fetchINMETAlerts();
  for (const m of inmetMessages) {
    await sendTelegramHTML(m);
    await sleep(SEND_DELAY_MS);
    sentAny = true;
  }

  // 2) CHUVA (previsão forte nas capitais)
  const rainMessages = await fetchRainAlerts();
  for (const m of rainMessages) {
    await sendTelegramHTML(m);
    await sleep(SEND_DELAY_MS);
    sentAny = true;
  }

  // 3) Resumo diário (independente de ter havido alertas no dia, R1)
  if (!sentAny && shouldSendDailySummary()) {
    await sendTelegramHTML("✅ Sem alertas no momento");
    sentAny = true;
  }

  console.log(`Execução finalizada. INMET=${inmetMessages.length}, CHUVA=${rainMessages.length}, DAILY=${!sentAny ? 1 : 0}`);
}

main();
