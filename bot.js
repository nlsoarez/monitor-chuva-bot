import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// ====== CONFIG BÁSICA ======
const CHAT_ID = -1003065918727;                 // seu grupo
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;
const RUN_MODE = process.env.RUN_MODE || "monitor"; // "monitor" (2h) | "daily" (22h)

// Chuva
const THRESHOLD_MM = 10;                 // mm/h
const API_DELAY = 400;                   // ms entre chamadas

// Persistência
const dataDir = path.join(process.cwd(), "data");
const todayStr = () => new Date().toISOString().slice(0,10);
const stateFile = (d = todayStr()) => path.join(dataDir, `${d}.json`);
const sentAlertsFile = path.join(dataDir, "alertas.json");

// ====== LISTAS ======
const UFs = ["AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB","PR","PE","PI","RJ","RN","RO","RR","RS","SC","SE","SP","TO"];

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

// ====== UTILS ======
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function ensureDataFiles(){
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive:true });
  if (!fs.existsSync(stateFile())) fs.writeFileSync(stateFile(), JSON.stringify({ cities: [], closed:false }, null, 2));
  if (!fs.existsSync(sentAlertsFile)) fs.writeFileSync(sentAlertsFile, JSON.stringify({ sent:{} }, null, 2));
}
function loadDayState(){
  ensureDataFiles();
  try { return JSON.parse(fs.readFileSync(stateFile(), "utf-8")); }
  catch { return { cities:[], closed:false }; }
}
function saveDayState(st){ ensureDataFiles(); fs.writeFileSync(stateFile(), JSON.stringify(st, null, 2)); }
function addCityToday(label){
  const st = loadDayState();
  if (!st.cities.includes(label)) { st.cities.push(label); saveDayState(st); }
}
function rollTomorrow(){
  const d = new Date(); d.setDate(d.getDate()+1);
  const ymd = d.toISOString().slice(0,10);
  const f = path.join(dataDir, `${ymd}.json`);
  if (!fs.existsSync(f)) fs.writeFileSync(f, JSON.stringify({ cities:[], closed:false }, null, 2));
}
function loadSent(){
  ensureDataFiles();
  try { return JSON.parse(fs.readFileSync(sentAlertsFile, "utf-8")); }
  catch { return { sent:{} }; }
}
function saveSent(obj){ ensureDataFiles(); fs.writeFileSync(sentAlertsFile, JSON.stringify(obj, null, 2)); }

function norm(s){ return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase(); }

async function tgSend(text, html = true){
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: html ? "HTML" : undefined, disable_web_page_preview:true })
  });
  return r.json();
}

// ====== OPENWEATHER (chuva horária) ======
function owUrl(lat, lon){
  return `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br&exclude=minutely,daily`;
}

async function checkRainCapitals(){
  const msgs = [];
  for (const c of CAPITALS){
    try{
      const r = await fetch(owUrl(c.lat,c.lon));
      if (!r.ok){ await sleep(API_DELAY); continue; }
      const d = await r.json();
      const mm = d?.hourly?.[0]?.rain?.["1h"] ?? 0;
      if (mm >= THRESHOLD_MM){
        msgs.push(`🌧️ <b>${c.name.toUpperCase()}</b>\n~${Number(mm).toFixed(1)} mm/h`);
        addCityToday(c.name);
      }
    }catch{}
    await sleep(API_DELAY);
  }
  return msgs;
}

// ====== INMET via RSS (27 UFs) ======
// O INMET tem trocado rotas; vamos tentar múltiplos padrões por UF e usar o primeiro que responder 200.
function inmetUfCandidates(uf){
  return [
    `https://alertas2.inmet.gov.br/rss/${uf}`,              // ex.: /rss/RJ
    `https://alertas2.inmet.gov.br/rss/${uf}.xml`,          // ex.: /rss/RJ.xml
    `https://alertas2.inmet.gov.br/estado/${uf}/rss`,       // ex.: /estado/RJ/rss
    `https://alertas2.inmet.gov.br/rss?uf=${uf}`,           // ex.: /rss?uf=RJ
  ];
}

async function fetchText(url){
  try{
    const r = await fetch(url, { timeout: 15000 });
    if (!r.ok) return null;
    const txt = await r.text();
    if (!txt || txt.length < 50) return null;
    return txt;
  }catch{ return null; }
}

// RSS parser simples (sem dependência): extrai <item>...</item>, título, desc, pubDate, guid/link
function parseRssItems(xml){
  const items = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const tag = (block, name) => {
    const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`,"i").exec(block);
    return m ? m[1].replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim() : "";
  };
  let m;
  while ((m = itemRegex.exec(xml)) !== null){
    const block = m[0];
    const title = tag(block, "title");
    const desc = tag(block, "description");
    const pubDate = tag(block, "pubDate");
    const guid = tag(block, "guid") || tag(block, "link") || (title + "|" + pubDate);
    items.push({ guid, title, desc, pubDate });
  }
  return items;
}

function detectLevel(t, d){
  const s = norm(`${t} ${d}`);
  if (s.includes("vermelho")) return "Vermelho";
  if (s.includes("laranja"))  return "Laranja";
  if (s.includes("amarelo"))  return "Amarelo";
  return "Desconhecido";
}

function detectValidity(t, d){
  // tenta capturar algo como "até 18:00" / "vigência" etc. (heurística simples)
  const s = `${t} ${d}`;
  const m = s.match(/(até|ate)\s+(\d{1,2}:\d{2})/i);
  return m ? m[0] : "";
}

function matchCitiesFromText(t, d){
  const s = norm(`${t} ${d}`);
  const found = new Set();
  for (const c of CAPITALS){
    if (s.includes(norm(c.name))) found.add(c.name);
  }
  return [...found];
}

function ufFromContext(uf, t, d){
  // já sabemos a UF do feed, mas se o texto mencionar outra UF também, mantemos a do feed.
  return uf;
}

function buildInmetSummary(item, uf){
  const level = detectLevel(item.title, item.desc);
  const validity = detectValidity(item.title, item.desc);
  const areas = matchCitiesFromText(item.title, item.desc); // capitais encontradas
  const abr = areas.length ? ` — ${areas.join(", ")}` : "";
  const valTxt = validity ? `\nVigência: ${validity}` : "";
  return {
    text: `⚠️ <b>ALERTA OFICIAL — INMET</b>\nUF: <b>${uf}</b>${abr}\nNível: <b>${level}</b>${valTxt}\n${item.title}`,
    level,
    areas,
  };
}

async function fetchInmetAlertsByUF(){
  const results = []; // { uf, items:[{guid,title,desc,pubDate}] }
  for (const uf of UFs){
    let xml = null;
    for (const url of inmetUfCandidates(uf)){
      xml = await fetchText(url);
      if (xml) break;
    }
    if (!xml){ await sleep(150); continue; }
    const items = parseRssItems(xml);
    results.push({ uf, items });
    await sleep(150);
  }
  return results;
}

async function processInmetAndSend(){
  const sentDb = loadSent(); // { sent: { guid: timestamp } }
  const msgsNew = [];
  const msgsContinue = [];

  const perUF = await fetchInmetAlertsByUF();

  for (const group of perUF){
    const uf = group.uf;
    for (const it of group.items){
      const id = `${uf}|${it.guid}`;
      const already = !!sentDb.sent[id];

      // resumo curto (sua opção B)
      const summary = buildInmetSummary(it, uf);

      // registrar cidades/uf para o resumo das 22h:
      if (summary.areas.length){
        summary.areas.forEach((city) => addCityToday(city));
      } else {
        addCityToday(uf); // regional/UF
      }

      if (!already){
        msgsNew.push(summary.text);
        sentDb.sent[id] = Date.now();
      } else {
        // opção 3: não repete, envia aviso curto de continuidade
        const label = summary.areas.length ? summary.areas.join(", ") : uf;
        msgsContinue.push(`⚠️ Alerta continua ativo em ${label}`);
      }
    }
  }

  // Enviar INMET primeiro (novos, depois continuações)
  for (const m of msgsNew){ await tgSend(m); await sleep(1200); }
  for (const m of msgsContinue){ await tgSend(m); await sleep(900); }

  // salvar DB de enviados
  saveSent(sentDb);

  return { newCount: msgsNew.length, contCount: msgsContinue.length };
}

// ====== RESUMO 22h ======
async function dailySummary(){
  const st = loadDayState();
  const list = (st.cities || []).slice().sort();
  if (list.length === 0){
    await tgSend("✅ Nenhum alerta hoje.");
  } else {
    await tgSend(`⚠️ Houve alertas hoje\nCidades: ${list.join(", ")}`);
  }
  // marca e prepara próximo dia
  st.closed = true; saveDayState(st);
  // cria arquivo do próximo dia (facilita commit no workflow)
  rollTomorrow();
}

// ====== MONITOR 2h (INMET → CHUVA) ======
async function monitorRun(){
  // 1) INMET (RSS por UF, opção 3 de repetidos)
  const inmet = await processInmetAndSend();

  // 2) CHUVA (capitais)
  const rain = await checkRainCapitals();
  for (const m of rain){ await tgSend(m); await sleep(900); }

  // (logs de console apenas para debug no Actions)
  console.log(`INMET: new=${inmet.newCount}, continue=${inmet.contCount} | RAIN: ${rain.length}`);
}

// ====== MAIN ======
async function main(){
  if (!TOKEN) throw new Error("TELEGRAM_BOT_TOKEN ausente.");
  if (!OPENWEATHER_KEY && RUN_MODE !== "daily") {
    // daily não usa OpenWeather
    throw new Error("OPENWEATHER_KEY ausente.");
  }

  if (RUN_MODE === "daily"){
    await dailySummary();
  } else {
    await monitorRun();
  }

  console.log(`OK ${RUN_MODE} — ${new Date().toISOString()}`);
}

main().catch(async (e)=>{
  try { await tgSend(`❌ Erro: ${e.message}`, false); } catch {}
  process.exit(1);
});
