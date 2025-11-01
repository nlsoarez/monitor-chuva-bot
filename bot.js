import fetch from "node-fetch";
import fs from "fs";
import path from "path";

// ===================== CONFIG GERAL =====================
const CHAT_ID = -1003065918727;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TOMORROW_API_KEY = process.env.TOMORROW_API_KEY;
const RUN_MODE = process.env.RUN_MODE || "monitor";

const HORIZON_HOURS = 6;
const THRESHOLD_MM_H = 10;
const API_DELAY = 350;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===================== PERSISTÊNCIA =====================
const dataDir = path.join(process.cwd(), "data");
const cacheDir = path.join(process.cwd(), ".cache");
const todayStr = () => new Date().toISOString().slice(0, 10);
const stateFile = (d = todayStr()) => path.join(dataDir, `${d}.json`);
const alertsCacheFile = () => path.join(cacheDir, "alerts.json");

function ensureData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  if (!fs.existsSync(stateFile()))
    fs.writeFileSync(stateFile(), JSON.stringify({ cities: [], closed: false }, null, 2));
  if (!fs.existsSync(alertsCacheFile()))
    fs.writeFileSync(alertsCacheFile(), JSON.stringify({ sent: {} }, null, 2));
}

function loadState() {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf-8"));
  } catch {
    return { cities: [], closed: false };
  }
}

function saveState(st) {
  ensureData();
  fs.writeFileSync(stateFile(), JSON.stringify(st, null, 2));
}

function loadAlertCache() {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(alertsCacheFile(), "utf-8"));
  } catch {
    return { sent: {} };
  }
}

function saveAlertCache(cache) {
  ensureData();
  fs.writeFileSync(alertsCacheFile(), JSON.stringify(cache, null, 2));
}

function wasAlertSent(key) {
  const cache = loadAlertCache();
  const today = todayStr();
  return cache.sent[key] === today;
}

function markAlertSent(key) {
  const cache = loadAlertCache();
  const today = todayStr();
  cache.sent[key] = today;
  
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const cutoff = weekAgo.toISOString().slice(0, 10);
  
  for (const k in cache.sent) {
    if (cache.sent[k] < cutoff) delete cache.sent[k];
  }
  
  saveAlertCache(cache);
}

function addCityToday(label) {
  const st = loadState();
  if (!st.cities.includes(label)) {
    st.cities.push(label);
    saveState(st);
  }
}

function rollTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const ymd = d.toISOString().slice(0, 10);
  const f = path.join(dataDir, `${ymd}.json`);
  if (!fs.existsSync(f))
    fs.writeFileSync(f, JSON.stringify({ cities: [], closed: false }, null, 2));
}

// ===================== TELEGRAM =====================
async function tgSend(text, html = true) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: html ? "HTML" : undefined,
        disable_web_page_preview: true,
      }),
    });
    const result = await r.json();
    if (!result.ok) {
      console.error("Telegram API error:", result);
    }
    return result;
  } catch (e) {
    console.error("Erro ao enviar mensagem:", e.message);
    return null;
  }
}

async function tgPin(message_id) {
  try {
    await fetch(
      `https://api.telegram.org/bot${TOKEN}/pinChatMessage?chat_id=${CHAT_ID}&message_id=${message_id}&disable_notification=false`
    );
  } catch (e) {
    console.error("Erro ao fixar mensagem:", e.message);
  }
}

// ===================== CIDADES (capitais) =====================
const CAPITALS = [
  { uf: "AC", name: "Rio Branco", lat: -9.97499, lon: -67.8243 },
  { uf: "AL", name: "Maceió", lat: -9.64985, lon: -35.70895 },
  { uf: "AP", name: "Macapá", lat: 0.03493, lon: -51.0694 },
  { uf: "AM", name: "Manaus", lat: -3.11903, lon: -60.02173 },
  { uf: "BA", name: "Salvador", lat: -12.97304, lon: -38.5023 },
  { uf: "CE", name: "Fortaleza", lat: -3.73186, lon: -38.52667 },
  { uf: "DF", name: "Brasília", lat: -15.79389, lon: -47.88278 },
  { uf: "ES", name: "Vitória", lat: -20.3155, lon: -40.3128 },
  { uf: "GO", name: "Goiânia", lat: -16.6864, lon: -49.2643 },
  { uf: "MA", name: "São Luís", lat: -2.53874, lon: -44.2825 },
  { uf: "MT", name: "Cuiabá", lat: -15.601, lon: -56.0974 },
  { uf: "MS", name: "Campo Grande", lat: -20.4697, lon: -54.6201 },
  { uf: "MG", name: "Belo Horizonte", lat: -19.91668, lon: -43.93449 },
  { uf: "PA", name: "Belém", lat: -1.45502, lon: -48.5024 },
  { uf: "PB", name: "João Pessoa", lat: -7.11509, lon: -34.8641 },
  { uf: "PR", name: "Curitiba", lat: -25.42836, lon: -49.27325 },
  { uf: "PE", name: "Recife", lat: -8.04756, lon: -34.877 },
  { uf: "PI", name: "Teresina", lat: -5.09194, lon: -42.80336 },
  { uf: "RJ", name: "Rio de Janeiro", lat: -22.90685, lon: -43.1729 },
  { uf: "RN", name: "Natal", lat: -5.795, lon: -35.20944 },
  { uf: "RO", name: "Porto Velho", lat: -8.76077, lon: -63.8999 },
  { uf: "RR", name: "Boa Vista", lat: 2.82384, lon: -60.6753 },
  { uf: "RS", name: "Porto Alegre", lat: -30.03465, lon: -51.21766 },
  { uf: "SC", name: "Florianópolis", lat: -27.5945, lon: -48.5477 },
  { uf: "SE", name: "Aracaju", lat: -10.9091, lon: -37.0677 },
  { uf: "SP", name: "São Paulo", lat: -23.55052, lon: -46.63331 },
  { uf: "TO", name: "Palmas", lat: -10.184, lon: -48.3336 },
];

// Mapa: Regiões INMET → Capitais
const INMET_TO_CAPITAL = {
  "Vale do Acre": ["Rio Branco"],
  "Vale do Juruá": ["Rio Branco"],
  "Leste Alagoano": ["Maceió"],
  "Sertão Alagoano": ["Maceió"],
  "Sul de Roraima": ["Boa Vista"],
  "Norte de Roraima": ["Boa Vista"],
  "Norte Amazonense": ["Manaus"],
  "Centro Amazonense": ["Manaus"],
  "Sudoeste Amazonense": ["Manaus"],
  "Sul Amazonense": ["Manaus"],
  "Sudoeste Paraense": ["Belém"],
  "Sudeste Paraense": ["Belém"],
  "Baixo Amazonas": ["Belém"],
  "Norte Maranhense": ["São Luís"],
  "Leste Maranhense": ["São Luís"],
  "Centro Maranhense": ["São Luís"],
  "Oeste Maranhense": ["São Luís"],
  "Sul Maranhense": ["São Luís"],
  "Norte Piauiense": ["Teresina"],
  "Centro-Norte Piauiense": ["Teresina"],
  "Sudeste Piauiense": ["Teresina"],
  "Sudoeste Piauiense": ["Teresina"],
  "Norte Cearense": ["Fortaleza"],
  "Metropolitana de Fortaleza": ["Fortaleza"],
  "Noroeste Cearense": ["Fortaleza"],
  "Centro-Sul Cearense": ["Fortaleza"],
  "Sul Cearense": ["Fortaleza"],
  "Jaguaribe": ["Fortaleza"],
  "Sertões Cearenses": ["Fortaleza"],
  "Oeste Potiguar": ["Natal"],
  "Central Potiguar": ["Natal"],
  "Leste Potiguar": ["Natal"],
  "Agreste Potiguar": ["Natal"],
  "Sertão Paraibano": ["João Pessoa"],
  "Borborema": ["João Pessoa"],
  "Agreste Paraibano": ["João Pessoa"],
  "Zona da Mata Paraibana": ["João Pessoa"],
  "Sertão Pernambucano": ["Recife"],
  "São Francisco Pernambucano": ["Recife"],
  "Agreste Pernambucano": ["Recife"],
  "Metropolitana de Recife": ["Recife"],
  "Metropolitana de Salvador": ["Salvador"],
  "Sul Baiano": ["Salvador"],
  "Centro Sul Baiano": ["Salvador"],
  "Centro Norte Baiano": ["Salvador"],
  "Vale São-Franciscano da Bahia": ["Salvador"],
  "Extremo Oeste Baiano": ["Salvador"],
  "Nordeste Baiano": ["Salvador"],
  "Leste Sergipano": ["Aracaju"],
  "Metropolitana de Aracaju": ["Aracaju"],
  "Noroeste de Minas": ["Belo Horizonte"],
  "Norte de Minas": ["Belo Horizonte"],
  "Jequitinhonha": ["Belo Horizonte"],
  "Vale do Mucuri": ["Belo Horizonte"],
  "Triângulo Mineiro/Alto Paranaíba": ["Belo Horizonte"],
  "Central Mineira": ["Belo Horizonte"],
  "Metropolitana de Belo Horizonte": ["Belo Horizonte"],
  "Vale do Rio Doce": ["Belo Horizonte"],
  "Oeste de Minas": ["Belo Horizonte"],
  "Sul/Sudoeste de Minas": ["Belo Horizonte"],
  "Campo das Vertentes": ["Belo Horizonte"],
  "Zona da Mata": ["Belo Horizonte"],
  "Noroeste Espírito-santense": ["Vitória"],
  "Litoral Norte Espírito-santense": ["Vitória"],
  "Central Espírito-santense": ["Vitória"],
  "Sul Espírito-santense": ["Vitória"],
  "Norte Fluminense": ["Rio de Janeiro"],
  "Noroeste Fluminense": ["Rio de Janeiro"],
  "Centro Fluminense": ["Rio de Janeiro"],
  "Baixadas": ["Rio de Janeiro"],
  "Sul Fluminense": ["Rio de Janeiro"],
  "Metropolitana do Rio de Janeiro": ["Rio de Janeiro"],
  "São José do Rio Preto": ["São Paulo"],
  "Ribeirão Preto": ["São Paulo"],
  "Araçatuba": ["São Paulo"],
  "Bauru": ["São Paulo"],
  "Araraquara": ["São Paulo"],
  "Piracicaba": ["São Paulo"],
  "Campinas": ["São Paulo"],
  "Presidente Prudente": ["São Paulo"],
  "Marília": ["São Paulo"],
  "Assis": ["São Paulo"],
  "Itapetininga": ["São Paulo"],
  "Macro Metropolitana Paulista": ["São Paulo"],
  "Vale do Paraíba Paulista": ["São Paulo"],
  "Litoral Sul Paulista": ["São Paulo"],
  "Metropolitana de São Paulo": ["São Paulo"],
  "Noroeste Paranaense": ["Curitiba"],
  "Centro Ocidental Paranaense": ["Curitiba"],
  "Norte Central Paranaense": ["Curitiba"],
  "Norte Pioneiro Paranaense": ["Curitiba"],
  "Centro Oriental Paranaense": ["Curitiba"],
  "Oeste Paranaense": ["Curitiba"],
  "Sudoeste Paranaense": ["Curitiba"],
  "Centro-Sul Paranaense": ["Curitiba"],
  "Sudeste Paranaense": ["Curitiba"],
  "Metropolitana de Curitiba": ["Curitiba"],
  "Oeste Catarinense": ["Florianópolis"],
  "Norte Catarinense": ["Florianópolis"],
  "Serrana": ["Florianópolis"],
  "Vale do Itajaí": ["Florianópolis"],
  "Grande Florianópolis": ["Florianópolis"],
  "Sul Catarinense": ["Florianópolis"],
  "Noroeste Rio-grandense": ["Porto Alegre"],
  "Nordeste Rio-grandense": ["Porto Alegre"],
  "Centro Ocidental Rio-grandense": ["Porto Alegre"],
  "Centro Oriental Rio-grandense": ["Porto Alegre"],
  "Metropolitana de Porto Alegre": ["Porto Alegre"],
  "Sudoeste Rio-grandense": ["Porto Alegre"],
  "Sudeste Rio-grandense": ["Porto Alegre"],
  "Centro-Sul Mato-grossense": ["Cuiabá"],
  "Norte Mato-grossense": ["Cuiabá"],
  "Nordeste Mato-grossense": ["Cuiabá"],
  "Sudeste Mato-grossense": ["Cuiabá"],
  "Sudoeste Mato-grossense": ["Cuiabá"],
  "Pantanais Sul Mato-grossense": ["Campo Grande"],
  "Centro Norte de Mato Grosso do Sul": ["Campo Grande"],
  "Leste de Mato Grosso do Sul": ["Campo Grande"],
  "Sudoeste de Mato Grosso do Sul": ["Campo Grande"],
  "Norte Goiano": ["Goiânia"],
  "Leste Goiano": ["Goiânia"],
  "Centro Goiano": ["Goiânia"],
  "Sul Goiano": ["Goiânia"],
  "Noroeste Goiano": ["Goiânia"],
  "Distrito Federal": ["Brasília"],
  "Ocidental do Tocantins": ["Palmas"],
  "Oriental do Tocantins": ["Palmas"],
  "Leste Rondoniense": ["Porto Velho"],
  "Madeira-Guaporé": ["Porto Velho"],
};

// ===================== INMET RSS =====================
async function fetchINMETAlerts() {
  try {
    console.log("🔍 Buscando alertas do INMET...");
    const r = await fetch("https://apiprevmet3.inmet.gov.br/avisos/rss");
    if (!r.ok) {
      console.error(`❌ INMET RSS retornou ${r.status}`);
      return [];
    }
    
    const xml = await r.text();
    const alerts = parseINMETRSS(xml);
    console.log(`✅ ${alerts.length} alertas encontrados no INMET`);
    return alerts;
  } catch (e) {
    console.error("❌ Erro ao buscar INMET:", e.message);
    return [];
  }
}

function parseINMETRSS(xml) {
  const alerts = [];
  const items = xml.split("<item>");
  
  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    
    const titleMatch = item.match(/<title>(.*?)<\/title>/);
    const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s);
    const linkMatch = item.match(/<link>(.*?)<\/link>/);
    const guidMatch = item.match(/<guid>(.*?)<\/guid>/);
    
    if (!descMatch) continue;
    
    const desc = descMatch[1];
    
    const eventoMatch = desc.match(/<th[^>]*>Evento<\/th><td>(.*?)<\/td>/);
    const severidadeMatch = desc.match(/<th[^>]*>Severidade<\/th><td>(.*?)<\/td>/);
    const inicioMatch = desc.match(/<th[^>]*>Início<\/th><td>(.*?)<\/td>/);
    const fimMatch = desc.match(/<th[^>]*>Fim<\/th><td>(.*?)<\/td>/);
    const descricaoMatch = desc.match(/<th[^>]*>Descrição<\/th><td>(.*?)<\/td>/);
    const areaMatch = desc.match(/<th[^>]*>Área<\/th><td>(.*?)<\/td>/);
    
    if (!areaMatch) continue;
    
    // Remove "Aviso para as Áreas: " se existir
    let areasText = areaMatch[1];
    if (areasText.includes("Aviso para as Áreas:")) {
      areasText = areasText.replace("Aviso para as Áreas:", "").trim();
    }
    const areas = areasText.split(",").map(a => a.trim());
    const affectedCapitals = new Set();
    
    for (const area of areas) {
      const capitals = INMET_TO_CAPITAL[area];
      if (capitals) {
        capitals.forEach(cap => affectedCapitals.add(cap));
      }
    }
    
    if (affectedCapitals.size === 0) continue;
    
    // Filtrar apenas eventos relacionados a chuva
    const evento = eventoMatch ? eventoMatch[1] : "Alerta";
    const isRainRelated = 
      evento.includes("Chuva") || 
      evento.includes("Tempestade") || 
      evento.includes("Acumulado");
    
    if (!isRainRelated) {
      console.log(`⏭️ Ignorando alerta não relacionado a chuva: ${evento}`);
      continue;
    }
    
    // Verificar se o alerta ainda é válido (não expirou)
    const fim = fimMatch ? fimMatch[1] : "";
    if (fim) {
      const fimDate = new Date(fim.replace(" ", "T"));
      const now = new Date();
      
      if (fimDate < now) {
        console.log(`⏭️ Alerta expirado (fim: ${fim}): ${evento}`);
        continue;
      }
    }
    
    alerts.push({
      id: guidMatch ? guidMatch[1] : linkMatch[1],
      evento,
      severidade: severidadeMatch ? severidadeMatch[1] : "Desconhecida",
      inicio: inicioMatch ? inicioMatch[1] : "",
      fim,
      descricao: descricaoMatch ? descricaoMatch[1] : "",
      link: linkMatch ? linkMatch[1] : "",
      capitais: Array.from(affectedCapitals),
    });
  }
  
  return alerts;
}

function normalizeSeverity(s) {
  const x = (s || "").toString().toLowerCase();
  if (x.includes("perigo") && !x.includes("potencial")) return "red";
  if (x.includes("potencial")) return "yellow";
  return "unknown";
}

// ===================== TOMORROW.IO =====================
function forecastUrl(lat, lon) {
  return `https://api.tomorrow.io/v4/weather/forecast?location=${lat},${lon}&timesteps=1h&apikey=${TOMORROW_API_KEY}`;
}

function extractHeavyRainHours(forecastJson) {
  const timelines = forecastJson?.timelines || [];
  let hourly = [];
  
  for (const timeline of timelines) {
    if (timeline.timestep === "1h" || timeline.timestep === "1hour") {
      hourly = timeline.intervals || [];
      break;
    }
  }
  
  if (hourly.length === 0) return [];

  const now = Date.now();
  const limit = now + HORIZON_HOURS * 3600 * 1000;
  const hits = [];

  for (const interval of hourly) {
    const t = new Date(interval?.startTime).getTime();
    if (!t || t > limit) continue;
    
    const precip = Number(interval?.values?.precipitationIntensity ?? 0);
    
    if (precip >= THRESHOLD_MM_H) {
      const hh = new Date(t).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      });
      hits.push({ time: hh, value: precip });
    }
  }
  
  return hits;
}

// ===================== PROCESSAMENTO =====================
async function processINMETAlerts() {
  const alerts = await fetchINMETAlerts();
  let sentCount = 0;
  
  for (const alert of alerts) {
    for (const cityName of alert.capitais) {
      const alertKey = `inmet_${cityName}_${alert.id}`;
      
      if (wasAlertSent(alertKey)) {
        console.log(`⏭️ Alerta INMET já enviado: ${cityName} - ${alert.evento}`);
        continue;
      }
      
      const sev = normalizeSeverity(alert.severidade);
      const emoji = sev === "red" ? "🔴" : sev === "yellow" ? "🟡" : "⚠️";
      
      let msg = `${emoji} <b>ALERTA INMET</b> — ${cityName.toUpperCase()}\n`;
      msg += `📋 Evento: ${alert.evento}\n`;
      msg += `🎯 Severidade: ${alert.severidade}\n`;
      if (alert.fim) {
        const fimDate = new Date(alert.fim.replace(" ", "T"));
        msg += `⏰ Válido até: ${fimDate.toLocaleString("pt-BR", { 
          day: "2-digit", 
          month: "2-digit", 
          hour: "2-digit", 
          minute: "2-digit" 
        })}\n`;
      }
      if (alert.descricao && alert.descricao.length < 250) {
        msg += `ℹ️ ${alert.descricao}\n`;
      }
      msg += `\n🔗 <a href="${alert.link}">Ver detalhes</a>`;
      
      const sent = await tgSend(msg);
      
      if (sent?.ok) {
        markAlertSent(alertKey);
        addCityToday(cityName);
        sentCount++;
        
        if (sev === "red" && sent?.result?.message_id) {
          await tgPin(sent.result.message_id);
        }
        
        console.log(`✉️ Alerta INMET enviado: ${cityName} - ${alert.evento}`);
      }
      
      await sleep(800);
    }
  }
  
  return sentCount;
}

async function processRainForCity(city) {
  if (!TOMORROW_API_KEY) return;
  
  try {
    console.log(`🌧️ Verificando chuva Tomorrow.io para ${city.name}...`);
    const r = await fetch(forecastUrl(city.lat, city.lon));
    
    if (!r.ok) {
      console.log(`❌ API retornou status ${r.status} para ${city.name}`);
      return;
    }
    
    const data = await r.json();
    const hours = extractHeavyRainHours(data);
    
    if (hours.length === 0) {
      console.log(`✅ Sem chuva forte prevista para ${city.name}`);
      return;
    }
    
    console.log(`🌧️ ${hours.length} período(s) de chuva forte para ${city.name}`);
    
    for (const h of hours) {
      const rainKey = `rain_${city.name}_${h.time}_${todayStr()}`;
      
      if (wasAlertSent(rainKey)) {
        console.log(`⏭️ Chuva já reportada: ${rainKey}`);
        continue;
      }
      
      const msg = `🌧️ <b>Chuva forte prevista</b> em <b>${city.name.toUpperCase()}</b>\n⏰ Horário: ${h.time}\n💧 Intensidade: ${h.value.toFixed(1)} mm/h`;
      const sent = await tgSend(msg);
      
      if (sent?.ok) {
        markAlertSent(rainKey);
        addCityToday(city.name);
        console.log(`✉️ Alerta de chuva enviado: ${city.name} às ${h.time}`);
      }
      
      await sleep(600);
    }
  } catch (e) {
    console.error(`❌ Erro ao processar chuva de ${city.name}:`, e.message);
  }
}

// ===================== EXECUÇÕES =====================
async function monitorRun() {
  console.log(`\n🚀 Iniciando monitoramento às ${new Date().toLocaleString('pt-BR')}`);
  
  // PRIORIDADE 1: INMET (oficial)
  console.log("\n=== FASE 1: Alertas INMET (oficial) ===");
  const inmetCount = await processINMETAlerts();
  console.log(`✅ ${inmetCount} alertas INMET enviados`);
  
  // PRIORIDADE 2: Tomorrow.io (previsão de chuva) - apenas se não houver alertas INMET
  if (TOMORROW_API_KEY) {
    console.log("\n=== FASE 2: Previsão de chuva (Tomorrow.io) ===");
    let rainCount = 0;
    
    for (const c of CAPITALS) {
      const beforeRain = loadState().cities.length;
      await processRainForCity(c);
      const afterRain = loadState().cities.length;
      if (afterRain > beforeRain) rainCount++;
      await sleep(API_DELAY);
    }
    
    console.log(`✅ ${rainCount} previsões de chuva enviadas`);
  }
  
  console.log(`\n✅ Monitor concluído às ${new Date().toLocaleString('pt-BR')}`);
}

async function dailySummary() {
  console.log(`\n📋 Gerando resumo diário às ${new Date().toLocaleString('pt-BR')}`);
  
  const st = loadState();
  const cities = (st.cities || []).slice().sort();
  
  if (cities.length === 0) {
    await tgSend("✅ <b>Resumo Diário</b>\n\nNenhum alerta registrado hoje. Tudo tranquilo! 🌤️");
  } else {
    const msg = `⚠️ <b>Resumo Diário</b>\n\n${cities.length} cidade(s) com alertas hoje:\n\n${cities.join(", ")}`;
    await tgSend(msg);
  }
  
  st.closed = true;
  saveState(st);
  rollTomorrow();
  
  console.log(`✅ Resumo enviado. ${cities.length} cidades com alertas.`);
}

// ===================== MAIN =====================
async function main() {
  if (!TOKEN) {
    throw new Error("❌ Falta TELEGRAM_BOT_TOKEN");
  }

  if (RUN_MODE === "daily") {
    await dailySummary();
  } else {
    await monitorRun();
  }
}

main().catch(async (e) => {
  console.error("❌ ERRO FATAL:", e.message);
  console.error(e.stack);
  
  try {
    await tgSend(`❌ <b>Erro no Monitor</b>\n\n${e.message}`, true);
  } catch (telegramError) {
    console.error("❌ Não foi possível enviar erro ao Telegram:", telegramError.message);
  }
  
  process.exit(1);
});
