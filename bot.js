// bot.js — versão de TESTE (envia sempre uma mensagem forçada)

import fetch from "node-fetch";

const CHAT_ID = -1003065918727;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;

if (!TOKEN) {
  console.log("ERRO: TELEGRAM_BOT_TOKEN ausente.");
  process.exit(1);
}
if (!OPENWEATHER_KEY) {
  console.log("ERRO: OPENWEATHER_KEY ausente.");
  process.exit(1);
}

async function sendTelegramHTML(text) {
  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
    }),
  });
  const data = await resp.json();
  console.log("RESPOSTA TELEGRAM:", data);
  return data;
}

async function main() {
  // ====== FORÇANDO ENVIO DE TESTE ======
  await sendTelegramHTML("🚨 TESTE — sistema ativo e funcionando");
  console.log("TESTE ENVIADO");
}

main();
