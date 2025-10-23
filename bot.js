// bot.js
import fetch from "node-fetch";

// ===== CONFIGURAÇÕES =====
const CHAT_ID = -1003065918727;     // grupo "Alertas de Chuva Brasil"
const THRESHOLD_MM = 10;            // chuva forte
const DELAY_MS = 5000;              // 5s entre alertas (P4 = B)

// Lista de capitais (UF, nome, lat, lon)
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

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function sendTelegramHTML(text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML"   // P2 = 3 (formatação rica)
    }),
  });
  const data = await resp.json();
  if (!data.ok) {
    console.log("ERRO TELEGRAM:", data);
  }
  return data;
}

function oneCallUrl(lat, lon) {
  return `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br`;
}

// ===== EXECUÇÃO =====
async function main() {
  if (!TOKEN) {
    console.log("ERRO: TELEGRAM_BOT_TOKEN não definido (Secret ausente).");
    process.exit(1);
  }
  if (!OPENWEATHER_KEY) {
    console.log("ERRO: OPENWEATHER_KEY não definido (Secret ausente).");
    process.exit(1);
  }

  const alerts = [];

  for (const c of CITIES) {
    try {
      const r = await fetch(oneCallUrl(c.lat, c.lon));
      if (!r.ok) {
        console.log(`Falha OneCall em ${c.name}: HTTP ${r.status}`);
        continue;
      }
      const data = await r.json();

      // chuva forte na próxima hora
      const mm = data?.hourly?.[0]?.rain?.["1h"] ?? 0;
      if (mm >= THRESHOLD_MM) {
        // Mensagem M1 (curta e direta)
        const text =
          `🌧️ Chuva forte em <b>${c.name.toUpperCase()}</b>\n` +
          `~${mm} mm/h na próxima hora`;
        alerts.push(text);
      }
    } catch (e) {
      console.log(`Erro em ${c.name}:`, e.message);
    }

    // delay leve entre chamadas de API pra evitar pico
    await sleep(500);
  }

  // envia com delay entre cada alerta (P3 = C, P4 = 5s)
  for (const msg of alerts) {
    await sendTelegramHTML(msg);
    await sleep(DELAY_MS);
  }

  console.log(`Finalizado. Alertas enviados: ${alerts.length}`);
}

main();
