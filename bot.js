// bot.js — DIAGNÓSTICO (mostra mm/h e alerts[] por cidade)
// Requer TELEGRAM_BOT_TOKEN e OPENWEATHER_KEY nos Secrets
import fetch from "node-fetch";

const CHAT_ID = -1003065918727;   // grupo
const THRESHOLD_MM = 10;
const SEND_DELAY_MS = 5000;
const API_CALL_DELAY_MS = 500;

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function oneCallUrl(lat, lon) {
  return `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br`;
}
function fmtMM(mm){ const n=Number(mm??0); return Number.isFinite(n)?(n%1===0?String(n):n.toFixed(1)):"0"; }
function fmtHour(ts){ if(!ts)return""; const d=new Date(ts*1000); return d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",hour12:false}); }

async function sendTelegramHTML(text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode:"HTML" })
  });
  const data = await resp.json();
  if(!data.ok) console.log("ERRO TELEGRAM:", data);
  return data;
}

export default async () => {
  if (!TOKEN || !OPENWEATHER_KEY) {
    console.log("Secrets ausentes."); 
    return;
  }

  const rainMsgs = [];
  const officialMsgs = [];
  const diag = [];

  for (const c of CITIES) {
    try {
      const r = await fetch(oneCallUrl(c.lat, c.lon));
      const status = r.status;
      if (!r.ok) {
        diag.push(`${c.uf}-${c.name}: HTTP ${status}`);
        await sleep(API_CALL_DELAY_MS);
        continue;
      }
      const data = await r.json();

      const mm = data?.hourly?.[0]?.rain?.["1h"] ?? 0;
      const alerts = Array.isArray(data.alerts) ? data.alerts.length : 0;

      // acumula diagnósticos
      const lastAlertEnd = (Array.isArray(data.alerts) && data.alerts[0]?.end) ? `, end ${fmtHour(data.alerts[0].end)}` : "";
      diag.push(`${c.uf}-${c.name}: ${fmtMM(mm)} mm/h, alerts=${alerts}${lastAlertEnd}`);

      // regras normais
      if (mm >= THRESHOLD_MM) {
        rainMsgs.push(`🌧️ Chuva forte em <b>${c.name.toUpperCase()}</b>\n~${fmtMM(mm)} mm/h na próxima hora`);
      }
      if (Array.isArray(data.alerts)) {
        for (const a of data.alerts) {
          const endTxt = fmtHour(a.end || a.expires);
          const header = `🚨 ALERTA OFICIAL — ${c.name.toUpperCase()}`;
          const body = a.event || "Weather alert";
          const validity = endTxt ? `\nVálido até: ${endTxt}` : "";
          officialMsgs.push(`${header}\n${body}${validity}`);
        }
      }
    } catch (e) {
      diag.push(`${c.uf}-${c.name}: ERRO ${e.message}`);
    }
    await sleep(API_CALL_DELAY_MS);
  }

  // Envia o que tiver de fato
  let sent = 0;
  for (const m of rainMsgs) { await sendTelegramHTML(m); await sleep(SEND_DELAY_MS); sent++; }
  for (const m of officialMsgs) { await sendTelegramHTML(m); await sleep(SEND_DELAY_MS); sent++; }

  // Envia RESUMO TÉCNICO desta execução (sempre), pra entendermos o que a API retornou
  const chunkSize = 3500; // HTML do Telegram tem limite ~4096
  const full = `<b>Diagnóstico OneCall</b>\n<pre>${diag.join('\n')}</pre>\nEnviadas agora: chuva=${rainMsgs.length}, oficiais=${officialMsgs.length}`;
  // quebra se ficar grande demais
  for (let i=0; i<full.length; i+=chunkSize) {
    const part = full.slice(i, i+chunkSize);
    await sendTelegramHTML(part);
    await sleep(1000);
  }

  return `diag: ${diag.length} cidades, enviados=${sent}`;
};        await sleep(API_CALL_DELAY_MS);
        continue;
      }
      const data = await r.json();

      // --- chuva forte (próxima hora) ---
      const mm = data?.hourly?.[0]?.rain?.["1h"] ?? 0;
      if (mm >= THRESHOLD_MM) {
        const text =
          `🌧️ Chuva forte em <b>${c.name.toUpperCase()}</b>\n` +
          `~${fmtMM(mm)} mm/h na próxima hora`;
        rainMsgs.push(text);
      }

      // --- alertas oficiais (enviar todos, O3 com validade) ---
      if (Array.isArray(data.alerts)) {
        for (const a of data.alerts) {
          const endTxt = fmtHour(a.end || a.expires);
          const header = `🚨 ALERTA OFICIAL — ${c.name.toUpperCase()}`;
          const body = a.event || "Weather alert";
          const validity = endTxt ? `\nVálido até: ${endTxt}` : "";
          officialMsgs.push(`${header}\n${body}${validity}`);
        }
      }
    } catch (e) {
      console.log(`Erro em ${c.name}:`, e.message);
    }
    await sleep(API_CALL_DELAY_MS);
  }

  let sentCount = 0;

  // 1) Envia chuva forte
  for (const msg of rainMsgs) {
    await sendTelegramHTML(msg);
    await sleep(SEND_DELAY_MS);
    sentCount++;
  }

  // 2) Envia alertas oficiais
  for (const msg of officialMsgs) {
    await sendTelegramHTML(msg);
    await sleep(SEND_DELAY_MS);
    sentCount++;
  }

  // 3) Se nada enviado e for 22:00 BRT (~01:00 UTC), mandar "Sem alertas"
  if (sentCount === 0 && isDailySummaryHourUTC()) {
    await sendTelegramHTML("✅ Sem alertas no momento");
  }

  console.log(`Enviadas agora: chuva=${rainMsgs.length}, oficiais=${officialMsgs.length}, daily=${sentCount === 0 && isDailySummaryHourUTC() ? 1 : 0}`);
}

main();
