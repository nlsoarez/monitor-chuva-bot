// bot.js — Forecast 2.5 (grátis) + Alertas detalhados + DIAGNÓSTICO sempre
// Requer secrets: TELEGRAM_BOT_TOKEN, OPENWEATHER_KEY

import fetch from "node-fetch";

// ===== CONFIG =====
const CHAT_ID = -1003065918727;       // grupo
const THRESHOLD_MM_PER_HOUR = 10;     // limite para alerta
const FORECAST_HOURS = 6;             // horizonte (duas janelas de 3h)
const SEND_DELAY_MS = 5000;           // delay entre mensagens (alertas e blocos de diagnóstico)
const API_CALL_DELAY_MS = 400;        // leve intervalo entre chamadas de API
const DIAG_BLOCK_SIZE = 10;           // até 10 cidades por mensagem de diagnóstico

// Capitais
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

// ===== HELPERS =====
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const toBRTime = (tsSec) =>
  new Date(tsSec * 1000).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

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
  if (!data.ok) console.log("ERRO TELEGRAM:", data);
  return data;
}

function mmhFromRain3h(rain3h) {
  const mm3h = Number(rain3h ?? 0);
  if (!Number.isFinite(mm3h)) return 0;
  return mm3h / 3;
}

function fmtMM(n) {
  return Number.isFinite(n) ? (n % 1 === 0 ? String(n) : n.toFixed(1)) : "0";
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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

  const alerts = [];         // {city, maxMMh, start, end}
  const diagLines = [];      // linhas de diagnóstico por cidade (formato estilo alerta)
  const now = Date.now() / 1000;
  const horizon = now + FORECAST_HOURS * 3600;

  for (const c of CITIES) {
    try {
      const r = await fetch(forecastUrl(c.lat, c.lon));
      if (!r.ok) {
        console.log(`Forecast falhou em ${c.name}: HTTP ${r.status}`);
        diagLines.push(`🚫 ${c.uf} — ${c.name}: erro HTTP ${r.status}`);
        await sleep(API_CALL_DELAY_MS);
        continue;
      }
      const data = await r.json();
      const list = Array.isArray(data?.list) ? data.list : [];

      // filtra próximas 6h (entradas de 3h)
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
        alerts.push({ city: c.name, uf: c.uf, maxMMh, start, end });

        // linha de diagnóstico para alerta real
        diagLines.push(
          `🌧️ ${c.name.toUpperCase()} — pico previsto ${fmtMM(maxMMh)} mm/h (${start}–${end})\n` +
          `➡️ ALERTA DISPARADO`
        );
      } else {
        // diagnóstico sem chuva forte
        diagLines.push(`☀️ ${c.name.toUpperCase()} — sem chuva forte prevista`);
      }
    } catch (e) {
      console.log(`Erro em ${c.name}:`, e.message);
      diagLines.push(`🚫 ${c.name.toUpperCase()} — erro: ${e.message}`);
    }

    await sleep(API_CALL_DELAY_MS);
  }

  // 1) Envia ALERTAS detalhados (AR2) primeiro
  for (const a of alerts) {
    const msg =
      `🌧️ <b>ALERTA DE CHUVA FORTE — ${a.city.toUpperCase()}</b>\n` +
      `Volume previsto: <b>~${fmtMM(a.maxMMh)} mm/h</b>\n` +
      `Janela estimada: <b>${a.start}–${a.end}</b>\n` +
      `Fique atento a possíveis alagamentos.`;
    await sendTelegramHTML(msg);
    await sleep(SEND_DELAY_MS);
  }

  // 2) Envia DIAGNÓSTICO completo sempre (DIA1), em blocos de 10 linhas com delay entre blocos
  const blocks = chunk(diagLines, DIAG_BLOCK_SIZE);
  for (const b of blocks) {
    await sendTelegramHTML(b.join("\n\n"));
    await sleep(SEND_DELAY_MS);
  }

  console.log(`Execução OK. Alertas: ${alerts.length}. Blocos diagnóstico: ${blocks.length}`);
}

main();
