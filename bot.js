import fetch from "node-fetch";

const CHAT_ID = -1003065918727; // grupo
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const send = await fetch(
  `https://api.telegram.org/bot${TOKEN}/sendMessage?chat_id=${CHAT_ID}&text=Teste+via+GitHub+Actions`,
  { method: "GET" }
);

console.log("STATUS:", send.status);
