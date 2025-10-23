// bot.js — gratuito (Forecast 2.5) com previsão de chuva forte
// Requer secrets: TELEGRAM_BOT_TOKEN, OPENWEATHER_KEY
// Regras: envia 1 alerta por cidade se houver chuva >=10 mm/h nas próximas 6h
// Delay 5s entre mensagens; envio "Sem alertas" só às ~01:00 UTC (≈22:00 BRT) se nada detectado

import fetch from "node-fetch";

const CHAT_ID = -1003065918727;   // grupo
const THRESHOLD_MM_PER_HOUR = 10; // limiar
const FORECAST_HOURS = 6;         // horizonte de previsão (3h + 3h)
const SEND_DELAY_MS = 5000;
const API_CALL_DELAY_MS = 400;

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

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const toBRTime = (tsSec) =>
  new Date(tsSec * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false });

function forecastUrl(lat, lon) {
  // 5-day/3-hour forecast
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

function isDailySummaryHourUTC() {
  // ~22:00 BRT ≈ 01:00 UTC (ajuste simples)
  return new Date().getUTCHours() === 1;
}

function mmhFromRain3h(rain3h) {
  const mm3h = Number(rain3h ?? 0);
  if (!Number.isFinite(mm3h)) return 0;
  return mm3h / 3; // converte mm/3h para mm/h aproximado
}

function fmtMM(n) {
  return Number.isFinite(n) ? (n % 1 === 0 ? String(n) : n.toFixed(1)) : "0";
}

async function main() {
  if (!TOKEN) {
    console.log("ERRO: TELEGRAM_BOT_TOKEN ausente.");
    process.exit(1);
  }
  if (!OPENWEATHER_KEY) {
    console.log("ERRO: OPENWEATHER_KEY ausente.");
    process.exit(1);
  }

  let sentCount = 0;

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

      // pega janelas até 6h à frente (2 entradas de 3h)
      const now = Date.now() / 1000;
      const horizon = now + FORECAST_HOURS * 3600;
      const next = list.filter(it => it.dt >= now && it.dt <= horizon);

      // calcula pico de mm/h na janela (a partir de rain["3h"])
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

      if (maxMMh >= THRESHOLD_MM_PER_HOUR && best) {
        // envia APENAS 1 alerta por cidade (P6 = 1)
        const start = toBRTime(best.dt);
        const end = toBRTime(best.dt + 3 * 3600);
        const msg =
          `🌧️ Chuva forte prevista em <b>${c.name.toUpperCase()}</b>\n` +
          `~${fmtMM(maxMMh)} mm/h entre ${start}–${end}`;
        await sendTelegramHTML(msg);
        sentCount++;
        await sleep(SEND_DELAY_MS);
      }

    } catch (e) {
      console.log(`Erro em ${c.name}:`, e.message);
    }

    await sleep(API_CALL_DELAY_MS);
  }

  // resumo diário às ~22:00 BRT se nada foi enviado
  if (sentCount === 0 && isDailySummaryHourUTC()) {
    await sendTelegramHTML("✅ Sem alertas no momento");
  }

  console.log(`Execução finalizada. Alertas enviados: ${sentCount}`);
}

main();
