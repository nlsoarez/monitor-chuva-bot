import fetch from "node-fetch";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = "-1003065918727";

async function main() {
  if (!TOKEN) {
    console.log("ERRO: TOKEN não está disponível no GitHub Secrets");
    process.exit(1);
  }

  const url = `https://api.telegram.org/bot${TOKEN}/sendMessage`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: "Teste automático via GitHub Actions ✅",
      parse_mode: "HTML"
    })
  });

  const data = await resp.json();
  console.log("RESPOSTA TELEGRAM:", data);
}

main();
