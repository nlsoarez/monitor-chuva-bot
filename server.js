import http from "http";
import fs from "fs";
import path from "path";
import { monitorRun, dailySummary, initBot } from "./bot.js";

// ===================== CONFIGURAÇÃO =====================
const PORT = process.env.PORT || 3000;
const MONITOR_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 horas
const SUMMARY_HOURS_BRT = [12, 22]; // 12h e 22h horário de Brasília

// ===================== ESTADO =====================
let lastMonitorRun = null;
let lastDailyRun = null;
let monitorCount = 0;
let dailyCount = 0;
let isRunning = false;
const messageLog = []; // Log de mensagens enviadas
const MAX_LOG_SIZE = 100;

// ===================== UTILIDADES =====================
function getBRTHour() {
  const now = new Date();
  const brtOffset = -3 * 60;
  const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const brtMinutes = utcMinutes + brtOffset;
  const brtHour = Math.floor(((brtMinutes % 1440) + 1440) % 1440 / 60);
  return brtHour;
}

function getBRTTime() {
  const now = new Date();
  return now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatDate(date) {
  if (!date) return "Nunca";
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function loadAlertsCache() {
  try {
    const dataDir = path.join(process.cwd(), "data");
    const cacheFile = path.join(dataDir, "alerts-cache.json");
    if (fs.existsSync(cacheFile)) {
      return JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    }
  } catch (e) {
    console.error("Erro ao ler cache:", e.message);
  }
  return { sent: {} };
}

function loadTodayState() {
  try {
    const dataDir = path.join(process.cwd(), "data");
    const today = new Date().toISOString().slice(0, 10);
    const stateFile = path.join(dataDir, `${today}.json`);
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    }
  } catch (e) {
    console.error("Erro ao ler estado:", e.message);
  }
  return { cities: [], closed: false };
}

function addToLog(type, city, severity, message) {
  messageLog.unshift({
    timestamp: new Date().toISOString(),
    type,
    city,
    severity,
    message
  });
  if (messageLog.length > MAX_LOG_SIZE) {
    messageLog.pop();
  }
}

// Interceptar logs do console para capturar mensagens enviadas
const originalLog = console.log;
console.log = (...args) => {
  const msg = args.join(" ");
  if (msg.includes("✉️ Alerta INMET enviado:")) {
    const match = msg.match(/enviado: (.+?) - (.+?) \((.+?)\)/);
    if (match) {
      addToLog("INMET", match[1], match[3], msg);
    }
  } else if (msg.includes("✉️ Alerta de chuva enviado:")) {
    const match = msg.match(/enviado: (.+?) às/);
    if (match) {
      addToLog("Tomorrow.io", match[1], "Chuva Forte", msg);
    }
  }
  originalLog.apply(console, args);
};

// ===================== TAREFAS AGENDADAS =====================
async function runMonitor() {
  if (isRunning) {
    console.log("⏳ Já existe uma execução em andamento, pulando...");
    return;
  }

  isRunning = true;
  console.log("\n" + "=".repeat(60));
  console.log(`🕐 Executando monitoramento agendado...`);
  console.log("=".repeat(60));

  try {
    await monitorRun();
    lastMonitorRun = new Date();
    monitorCount++;
    console.log(`✅ Monitoramento #${monitorCount} concluído`);
  } catch (e) {
    console.error("❌ Erro no monitoramento:", e.message);
  } finally {
    isRunning = false;
  }
}

async function runDailySummary() {
  if (isRunning) {
    console.log("⏳ Já existe uma execução em andamento, pulando resumo diário...");
    return;
  }

  isRunning = true;
  console.log("\n" + "=".repeat(60));
  console.log(`📋 Executando resumo diário...`);
  console.log("=".repeat(60));

  try {
    await dailySummary();
    lastDailyRun = new Date();
    dailyCount++;
    console.log(`✅ Resumo diário #${dailyCount} concluído`);
  } catch (e) {
    console.error("❌ Erro no resumo diário:", e.message);
  } finally {
    isRunning = false;
  }
}

// ===================== AGENDADOR =====================
let lastDailyCheck = -1;

function checkDailySchedule() {
  const brtHour = getBRTHour();

  if (SUMMARY_HOURS_BRT.includes(brtHour) && lastDailyCheck !== brtHour) {
    lastDailyCheck = brtHour;
    console.log(`🕙 São ${brtHour}h em Brasília - iniciando resumo`);
    runDailySummary();
  } else if (!SUMMARY_HOURS_BRT.includes(brtHour)) {
    lastDailyCheck = -1;
  }
}

// Mapa de UF para coordenadas no SVG do Brasil
const UF_COORDS = {
  "AC": { x: 95, y: 205 }, "AL": { x: 510, y: 245 }, "AP": { x: 305, y: 85 },
  "AM": { x: 165, y: 145 }, "BA": { x: 450, y: 275 }, "CE": { x: 480, y: 175 },
  "DF": { x: 375, y: 305 }, "ES": { x: 475, y: 345 }, "GO": { x: 365, y: 305 },
  "MA": { x: 390, y: 165 }, "MT": { x: 280, y: 275 }, "MS": { x: 300, y: 365 },
  "MG": { x: 420, y: 335 }, "PA": { x: 290, y: 145 }, "PB": { x: 520, y: 195 },
  "PR": { x: 335, y: 420 }, "PE": { x: 500, y: 215 }, "PI": { x: 430, y: 195 },
  "RJ": { x: 450, y: 385 }, "RN": { x: 515, y: 175 }, "RO": { x: 175, y: 245 },
  "RR": { x: 185, y: 55 }, "RS": { x: 315, y: 490 }, "SC": { x: 355, y: 455 },
  "SE": { x: 500, y: 255 }, "SP": { x: 375, y: 385 }, "TO": { x: 365, y: 225 }
};

// Mapa de cidade para UF
const CITY_TO_UF = {
  "Rio Branco": "AC", "Maceió": "AL", "Macapá": "AP", "Manaus": "AM",
  "Salvador": "BA", "Fortaleza": "CE", "Brasília": "DF", "Vitória": "ES",
  "Goiânia": "GO", "São Luís": "MA", "Cuiabá": "MT", "Campo Grande": "MS",
  "Belo Horizonte": "MG", "Belém": "PA", "João Pessoa": "PB", "Curitiba": "PR",
  "Recife": "PE", "Teresina": "PI", "Rio de Janeiro": "RJ", "Natal": "RN",
  "Porto Velho": "RO", "Boa Vista": "RR", "Porto Alegre": "RS", "Florianópolis": "SC",
  "Aracaju": "SE", "São Paulo": "SP", "Palmas": "TO"
};

// ===================== DASHBOARD HTML =====================
function getDashboardHTML() {
  const cache = loadAlertsCache();
  const todayState = loadTodayState();
  const uptime = Math.floor(process.uptime());
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  const nextMonitorMin = lastMonitorRun
    ? Math.max(0, Math.round((MONITOR_INTERVAL_MS - (Date.now() - lastMonitorRun.getTime())) / 1000 / 60))
    : 0;

  // Processar alertas ativos
  const now = new Date();
  const alertsArray = Object.entries(cache.sent || {})
    .filter(([key, value]) => typeof value === 'object' && value.validUntil)
    .map(([city, data]) => {
      const expiry = new Date(data.validUntil);
      const isActive = expiry > now;
      const severityLabel = data.priority === 3 ? "Perigo" : data.priority === 2 ? "Perigo Potencial" : "Desconhecido";
      const severityClass = data.priority === 3 ? "danger" : data.priority === 2 ? "warning" : "info";
      const uf = CITY_TO_UF[city] || "";
      return { city, uf, ...data, expiry, isActive, severityLabel, severityClass };
    })
    .sort((a, b) => b.priority - a.priority || a.city.localeCompare(b.city));

  const activeAlerts = alertsArray.filter(a => a.isActive);
  const expiredAlerts = alertsArray.filter(a => !a.isActive);

  // Gerar marcadores do mapa para estados com alertas
  const alertMarkers = activeAlerts.map(a => {
    const coords = UF_COORDS[a.uf];
    if (!coords) return '';
    const color = a.priority === 3 ? "#ED1B2E" : a.priority === 2 ? "#F5A623" : "#4A90D9";
    return `<circle cx="${coords.x}" cy="${coords.y}" r="12" fill="${color}" class="pulse-marker" data-city="${a.city}" data-uf="${a.uf}"/>
            <text x="${coords.x}" y="${coords.y + 4}" text-anchor="middle" fill="white" font-size="10" font-weight="bold">${a.uf}</text>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Monitor de Alertas - Claro Brasil</title>
  <meta http-equiv="refresh" content="60">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --claro-red: #ED1B2E;
      --claro-red-light: #FF4D5E;
      --claro-dark: #1A1A1A;
      --claro-gray: #2D2D2D;
      --claro-gray-light: #3D3D3D;
      --claro-white: #FFFFFF;
      --claro-text: #E5E5E5;
      --claro-text-muted: #999999;
      --warning-yellow: #F5A623;
      --info-blue: #4A90D9;
      --success-green: #27AE60;
    }

    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif;
      background: var(--claro-dark);
      color: var(--claro-text);
      min-height: 100vh;
    }

    /* Header */
    .header {
      background: linear-gradient(135deg, var(--claro-gray) 0%, var(--claro-dark) 100%);
      padding: 16px 24px;
      border-bottom: 3px solid var(--claro-red);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .logo-icon {
      width: 40px;
      height: 40px;
      background: var(--claro-red);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }

    .logo-text {
      font-size: 1.4em;
      font-weight: 700;
      color: var(--claro-white);
    }

    .logo-text span {
      color: var(--claro-red);
    }

    .header-stats {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
    }

    .header-stat {
      text-align: center;
      padding: 8px 16px;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      min-width: 80px;
    }

    .header-stat .number {
      font-size: 1.5em;
      font-weight: 700;
      color: var(--claro-white);
    }

    .header-stat .number.alert-count {
      color: ${activeAlerts.length > 0 ? 'var(--claro-red)' : 'var(--success-green)'};
    }

    .header-stat .label {
      font-size: 0.75em;
      color: var(--claro-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Main Layout */
    .main-container {
      display: grid;
      grid-template-columns: 1fr 400px;
      gap: 0;
      height: calc(100vh - 85px);
    }

    @media (max-width: 1024px) {
      .main-container {
        grid-template-columns: 1fr;
        height: auto;
      }
    }

    /* Map Section */
    .map-section {
      background: var(--claro-gray);
      padding: 20px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .map-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--claro-gray-light);
    }

    .map-title {
      font-size: 1.1em;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .map-legend {
      display: flex;
      gap: 16px;
      font-size: 0.8em;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .legend-dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
    }

    .legend-dot.danger { background: var(--claro-red); }
    .legend-dot.warning { background: var(--warning-yellow); }
    .legend-dot.info { background: var(--info-blue); }

    .map-container {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      min-height: 400px;
    }

    .brazil-map {
      max-width: 100%;
      max-height: 100%;
      height: auto;
    }

    .brazil-map path {
      fill: var(--claro-gray-light);
      stroke: var(--claro-gray);
      stroke-width: 1;
      transition: fill 0.2s, transform 0.2s;
      cursor: pointer;
    }

    .brazil-map path:hover {
      fill: #4a4a4a;
      transform: scale(1.02);
      transform-origin: center;
    }

    .brazil-map path.has-alert {
      fill: rgba(237, 27, 46, 0.3);
    }

    .brazil-map path.has-warning {
      fill: rgba(245, 166, 35, 0.3);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.7; transform: scale(1.2); }
    }

    .pulse-marker {
      animation: pulse 2s ease-in-out infinite;
      cursor: pointer;
      filter: drop-shadow(0 0 4px rgba(0,0,0,0.5));
    }

    .map-tooltip {
      position: absolute;
      background: var(--claro-dark);
      border: 1px solid var(--claro-red);
      border-radius: 8px;
      padding: 12px;
      font-size: 0.85em;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s;
      z-index: 100;
      max-width: 250px;
    }

    .map-tooltip.visible {
      opacity: 1;
    }

    .map-status {
      display: flex;
      gap: 16px;
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid var(--claro-gray-light);
    }

    .status-card {
      flex: 1;
      background: rgba(0,0,0,0.2);
      padding: 12px 16px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .status-icon {
      font-size: 1.5em;
    }

    .status-info {
      flex: 1;
    }

    .status-label {
      font-size: 0.75em;
      color: var(--claro-text-muted);
      text-transform: uppercase;
    }

    .status-value {
      font-weight: 600;
      font-size: 0.95em;
    }

    .status-value.running { color: var(--warning-yellow); }
    .status-value.idle { color: var(--success-green); }

    .btn-run {
      background: var(--claro-red);
      color: white;
      border: none;
      padding: 12px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9em;
      transition: background 0.2s, transform 0.1s;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-run:hover { background: var(--claro-red-light); transform: translateY(-1px); }
    .btn-run:active { transform: translateY(0); }
    .btn-run:disabled { background: var(--claro-gray-light); cursor: not-allowed; transform: none; }

    /* Alerts Section */
    .alerts-section {
      background: var(--claro-dark);
      border-left: 1px solid var(--claro-gray);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .alerts-header {
      padding: 16px 20px;
      background: var(--claro-gray);
      border-bottom: 1px solid var(--claro-gray-light);
    }

    .alerts-title {
      font-size: 1.1em;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .alerts-count {
      background: ${activeAlerts.length > 0 ? 'var(--claro-red)' : 'var(--success-green)'};
      color: white;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.85em;
      font-weight: 700;
    }

    .alerts-tabs {
      display: flex;
      border-bottom: 1px solid var(--claro-gray);
    }

    .tab-btn {
      flex: 1;
      padding: 12px;
      background: transparent;
      border: none;
      color: var(--claro-text-muted);
      cursor: pointer;
      font-weight: 500;
      transition: all 0.2s;
      border-bottom: 2px solid transparent;
    }

    .tab-btn:hover { color: var(--claro-text); background: rgba(255,255,255,0.03); }
    .tab-btn.active { color: var(--claro-red); border-bottom-color: var(--claro-red); }

    .alerts-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }

    .alerts-list::-webkit-scrollbar { width: 6px; }
    .alerts-list::-webkit-scrollbar-track { background: var(--claro-gray); }
    .alerts-list::-webkit-scrollbar-thumb { background: var(--claro-gray-light); border-radius: 3px; }

    .alert-card {
      background: var(--claro-gray);
      border-radius: 10px;
      margin-bottom: 10px;
      border-left: 4px solid;
      overflow: hidden;
      transition: all 0.2s;
    }

    .alert-card:hover { background: var(--claro-gray-light); }
    .alert-card.danger { border-color: var(--claro-red); }
    .alert-card.warning { border-color: var(--warning-yellow); }
    .alert-card.info { border-color: var(--info-blue); }
    .alert-card.expired { opacity: 0.5; }

    .alert-card-header {
      padding: 14px 16px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }

    .alert-card-main {
      flex: 1;
    }

    .alert-city {
      font-weight: 700;
      font-size: 1.05em;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .alert-uf {
      background: rgba(255,255,255,0.1);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.75em;
      font-weight: 600;
    }

    .alert-event {
      font-size: 0.85em;
      color: var(--claro-text-muted);
      margin-bottom: 6px;
    }

    .alert-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }

    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 0.7em;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }

    .badge.danger { background: var(--claro-red); color: white; }
    .badge.warning { background: var(--warning-yellow); color: #1a1a1a; }
    .badge.info { background: var(--info-blue); color: white; }

    .alert-time {
      font-size: 0.75em;
      color: var(--claro-text-muted);
    }

    .alert-toggle {
      color: var(--claro-text-muted);
      font-size: 0.9em;
      transition: transform 0.2s;
      padding: 4px;
    }

    .alert-card.expanded .alert-toggle { transform: rotate(180deg); }

    .alert-details {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
      background: rgba(0,0,0,0.2);
    }

    .alert-card.expanded .alert-details {
      max-height: 300px;
    }

    .alert-details-content {
      padding: 14px 16px;
      border-top: 1px solid var(--claro-gray-light);
    }

    .detail-row {
      margin-bottom: 10px;
    }

    .detail-label {
      font-size: 0.7em;
      color: var(--claro-text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }

    .detail-value {
      font-size: 0.9em;
      line-height: 1.4;
    }

    .alert-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--claro-red);
      text-decoration: none;
      font-size: 0.85em;
      font-weight: 500;
      margin-top: 8px;
      padding: 6px 12px;
      background: rgba(237, 27, 46, 0.1);
      border-radius: 6px;
      transition: background 0.2s;
    }

    .alert-link:hover { background: rgba(237, 27, 46, 0.2); }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--claro-text-muted);
    }

    .empty-state-icon {
      font-size: 3em;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    .empty-state-text {
      font-size: 0.95em;
    }

    /* Footer */
    .footer {
      padding: 12px 24px;
      background: var(--claro-gray);
      border-top: 1px solid var(--claro-gray-light);
      text-align: center;
      font-size: 0.8em;
      color: var(--claro-text-muted);
    }

    /* Mobile responsive */
    @media (max-width: 1024px) {
      .alerts-section {
        border-left: none;
        border-top: 1px solid var(--claro-gray);
        max-height: 50vh;
      }

      .map-container {
        min-height: 300px;
      }
    }

    @media (max-width: 640px) {
      .header {
        padding: 12px 16px;
      }

      .header-stats {
        gap: 12px;
      }

      .header-stat {
        padding: 6px 12px;
        min-width: 60px;
      }

      .header-stat .number {
        font-size: 1.2em;
      }

      .map-section, .alerts-list {
        padding: 12px;
      }

      .map-legend {
        display: none;
      }
    }
  </style>
</head>
<body>
  <!-- Header -->
  <header class="header">
    <div class="logo">
      <div class="logo-icon">🌧️</div>
      <div class="logo-text">Monitor <span>Alertas</span></div>
    </div>
    <div class="header-stats">
      <div class="header-stat">
        <div class="number alert-count">${activeAlerts.length}</div>
        <div class="label">Alertas</div>
      </div>
      <div class="header-stat">
        <div class="number">${todayState.cities?.length || 0}</div>
        <div class="label">Cidades</div>
      </div>
      <div class="header-stat">
        <div class="number">${monitorCount}</div>
        <div class="label">Execuções</div>
      </div>
      <div class="header-stat">
        <div class="number">${hours}h${minutes}m</div>
        <div class="label">Uptime</div>
      </div>
    </div>
  </header>

  <!-- Main Content -->
  <main class="main-container">
    <!-- Map Section -->
    <section class="map-section">
      <div class="map-header">
        <h2 class="map-title">📍 Mapa de Alertas</h2>
        <div class="map-legend">
          <div class="legend-item"><div class="legend-dot danger"></div> Perigo</div>
          <div class="legend-item"><div class="legend-dot warning"></div> Potencial</div>
          <div class="legend-item"><div class="legend-dot info"></div> Informativo</div>
        </div>
      </div>

      <div class="map-container">
        <svg class="brazil-map" viewBox="0 0 600 560" xmlns="http://www.w3.org/2000/svg">
          <!-- Estados do Brasil (simplificado) -->
          <g id="estados">
            <!-- Norte -->
            <path id="AM" d="M80,100 L250,80 L280,150 L260,220 L180,250 L100,230 L60,180 Z" class="${activeAlerts.find(a => a.uf === 'AM') ? (activeAlerts.find(a => a.uf === 'AM').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="PA" d="M250,80 L380,90 L400,180 L350,230 L260,220 L280,150 Z" class="${activeAlerts.find(a => a.uf === 'PA') ? (activeAlerts.find(a => a.uf === 'PA').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="RR" d="M150,30 L220,25 L230,80 L180,100 L140,70 Z" class="${activeAlerts.find(a => a.uf === 'RR') ? (activeAlerts.find(a => a.uf === 'RR').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="AP" d="M280,40 L340,50 L350,100 L310,120 L280,90 Z" class="${activeAlerts.find(a => a.uf === 'AP') ? (activeAlerts.find(a => a.uf === 'AP').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="AC" d="M60,180 L100,230 L100,260 L40,250 L30,210 Z" class="${activeAlerts.find(a => a.uf === 'AC') ? (activeAlerts.find(a => a.uf === 'AC').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="RO" d="M100,230 L180,250 L200,300 L140,310 L100,280 Z" class="${activeAlerts.find(a => a.uf === 'RO') ? (activeAlerts.find(a => a.uf === 'RO').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="TO" d="M350,180 L400,180 L410,280 L350,290 L330,240 Z" class="${activeAlerts.find(a => a.uf === 'TO') ? (activeAlerts.find(a => a.uf === 'TO').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>

            <!-- Nordeste -->
            <path id="MA" d="M380,120 L450,130 L460,190 L400,200 L380,160 Z" class="${activeAlerts.find(a => a.uf === 'MA') ? (activeAlerts.find(a => a.uf === 'MA').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="PI" d="M400,180 L460,190 L470,240 L420,260 L400,220 Z" class="${activeAlerts.find(a => a.uf === 'PI') ? (activeAlerts.find(a => a.uf === 'PI').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="CE" d="M460,140 L520,150 L530,200 L480,210 L460,180 Z" class="${activeAlerts.find(a => a.uf === 'CE') ? (activeAlerts.find(a => a.uf === 'CE').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="RN" d="M500,150 L550,160 L545,195 L510,190 Z" class="${activeAlerts.find(a => a.uf === 'RN') ? (activeAlerts.find(a => a.uf === 'RN').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="PB" d="M500,190 L555,195 L550,220 L505,215 Z" class="${activeAlerts.find(a => a.uf === 'PB') ? (activeAlerts.find(a => a.uf === 'PB').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="PE" d="M480,210 L555,220 L545,250 L475,245 Z" class="${activeAlerts.find(a => a.uf === 'PE') ? (activeAlerts.find(a => a.uf === 'PE').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="AL" d="M495,250 L545,250 L540,275 L495,270 Z" class="${activeAlerts.find(a => a.uf === 'AL') ? (activeAlerts.find(a => a.uf === 'AL').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="SE" d="M485,270 L535,275 L530,295 L485,290 Z" class="${activeAlerts.find(a => a.uf === 'SE') ? (activeAlerts.find(a => a.uf === 'SE').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="BA" d="M410,260 L530,290 L500,380 L400,360 L390,300 Z" class="${activeAlerts.find(a => a.uf === 'BA') ? (activeAlerts.find(a => a.uf === 'BA').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>

            <!-- Centro-Oeste -->
            <path id="MT" d="M200,250 L330,240 L350,350 L260,370 L200,320 Z" class="${activeAlerts.find(a => a.uf === 'MT') ? (activeAlerts.find(a => a.uf === 'MT').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="GO" d="M330,280 L400,300 L420,370 L350,390 L330,340 Z" class="${activeAlerts.find(a => a.uf === 'GO') ? (activeAlerts.find(a => a.uf === 'GO').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="DF" d="M370,295 L395,295 L395,320 L370,320 Z" class="${activeAlerts.find(a => a.uf === 'DF') ? (activeAlerts.find(a => a.uf === 'DF').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="MS" d="M260,350 L350,350 L350,430 L280,450 L250,400 Z" class="${activeAlerts.find(a => a.uf === 'MS') ? (activeAlerts.find(a => a.uf === 'MS').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>

            <!-- Sudeste -->
            <path id="MG" d="M390,310 L500,350 L480,420 L390,410 L370,360 Z" class="${activeAlerts.find(a => a.uf === 'MG') ? (activeAlerts.find(a => a.uf === 'MG').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="ES" d="M480,330 L520,340 L510,385 L475,375 Z" class="${activeAlerts.find(a => a.uf === 'ES') ? (activeAlerts.find(a => a.uf === 'ES').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="RJ" d="M440,385 L505,395 L490,430 L440,420 Z" class="${activeAlerts.find(a => a.uf === 'RJ') ? (activeAlerts.find(a => a.uf === 'RJ').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="SP" d="M340,380 L440,400 L420,460 L330,450 Z" class="${activeAlerts.find(a => a.uf === 'SP') ? (activeAlerts.find(a => a.uf === 'SP').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>

            <!-- Sul -->
            <path id="PR" d="M300,430 L400,450 L390,500 L300,490 Z" class="${activeAlerts.find(a => a.uf === 'PR') ? (activeAlerts.find(a => a.uf === 'PR').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="SC" d="M320,485 L400,495 L390,530 L330,525 Z" class="${activeAlerts.find(a => a.uf === 'SC') ? (activeAlerts.find(a => a.uf === 'SC').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
            <path id="RS" d="M280,510 L380,520 L350,580 L260,560 Z" class="${activeAlerts.find(a => a.uf === 'RS') ? (activeAlerts.find(a => a.uf === 'RS').priority === 3 ? 'has-alert' : 'has-warning') : ''}"/>
          </g>

          <!-- Marcadores de alerta -->
          <g id="markers">
            ${alertMarkers}
          </g>
        </svg>

        <div class="map-tooltip" id="mapTooltip"></div>
      </div>

      <div class="map-status">
        <div class="status-card">
          <div class="status-icon">${isRunning ? '🔄' : '✅'}</div>
          <div class="status-info">
            <div class="status-label">Status</div>
            <div class="status-value ${isRunning ? 'running' : 'idle'}">${isRunning ? 'Executando...' : 'Aguardando'}</div>
          </div>
        </div>
        <div class="status-card">
          <div class="status-icon">⏱️</div>
          <div class="status-info">
            <div class="status-label">Próxima verificação</div>
            <div class="status-value">${nextMonitorMin} min</div>
          </div>
        </div>
        <button class="btn-run" onclick="runNow()" ${isRunning ? 'disabled' : ''}>
          ${isRunning ? '⏳ Executando...' : '▶️ Executar Agora'}
        </button>
      </div>
    </section>

    <!-- Alerts Section -->
    <aside class="alerts-section">
      <div class="alerts-header">
        <h2 class="alerts-title">
          🔔 Alertas
          <span class="alerts-count">${activeAlerts.length}</span>
        </h2>
      </div>

      <div class="alerts-tabs">
        <button class="tab-btn active" onclick="showTab('active')">Ativos (${activeAlerts.length})</button>
        <button class="tab-btn" onclick="showTab('expired')">Expirados (${expiredAlerts.length})</button>
      </div>

      <div class="alerts-list" id="activeAlerts">
        ${activeAlerts.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">✅</div>
            <div class="empty-state-text">Nenhum alerta ativo no momento</div>
          </div>
        ` : activeAlerts.map(a => `
          <div class="alert-card ${a.severityClass}" onclick="toggleAlert(this)" data-uf="${a.uf}">
            <div class="alert-card-header">
              <div class="alert-card-main">
                <div class="alert-city">
                  ${a.city}
                  <span class="alert-uf">${a.uf}</span>
                </div>
                <div class="alert-event">${a.evento || 'Alerta meteorológico'}</div>
                <div class="alert-meta">
                  <span class="badge ${a.severityClass}">${a.severidadeLabel || a.severityLabel}</span>
                  <span class="alert-time">até ${a.expiry.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
              <span class="alert-toggle">▼</span>
            </div>
            <div class="alert-details">
              <div class="alert-details-content">
                ${a.descricao ? `<div class="detail-row"><div class="detail-label">Descrição</div><div class="detail-value">${a.descricao}</div></div>` : ''}
                ${a.sentAt ? `<div class="detail-row"><div class="detail-label">Alertado em</div><div class="detail-value">${new Date(a.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div></div>` : ''}
                ${a.link ? `<a href="${a.link}" target="_blank" class="alert-link" onclick="event.stopPropagation()">🔗 Ver no INMET</a>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="alerts-list" id="expiredAlerts" style="display: none;">
        ${expiredAlerts.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state-icon">📭</div>
            <div class="empty-state-text">Nenhum alerta expirado</div>
          </div>
        ` : expiredAlerts.slice(0, 10).map(a => `
          <div class="alert-card ${a.severityClass} expired" onclick="toggleAlert(this)" data-uf="${a.uf}">
            <div class="alert-card-header">
              <div class="alert-card-main">
                <div class="alert-city">
                  ${a.city}
                  <span class="alert-uf">${a.uf}</span>
                </div>
                <div class="alert-event">${a.evento || 'Alerta meteorológico'}</div>
                <div class="alert-meta">
                  <span class="badge ${a.severityClass}">${a.severidadeLabel || a.severityLabel}</span>
                  <span class="alert-time">expirou ${a.expiry.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>
              <span class="alert-toggle">▼</span>
            </div>
            <div class="alert-details">
              <div class="alert-details-content">
                ${a.descricao ? `<div class="detail-row"><div class="detail-label">Descrição</div><div class="detail-value">${a.descricao}</div></div>` : ''}
                ${a.sentAt ? `<div class="detail-row"><div class="detail-label">Alertado em</div><div class="detail-value">${new Date(a.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div></div>` : ''}
                ${a.link ? `<a href="${a.link}" target="_blank" class="alert-link" onclick="event.stopPropagation()">🔗 Ver no INMET</a>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </aside>
  </main>

  <!-- Footer -->
  <footer class="footer">
    Atualizado em: ${getBRTTime()} (Brasília) • Atualização automática a cada 60s • Resumos: 12h e 22h
  </footer>

  <script>
    function toggleAlert(element) {
      element.classList.toggle('expanded');
    }

    function showTab(tab) {
      const tabs = document.querySelectorAll('.tab-btn');
      tabs.forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');

      document.getElementById('activeAlerts').style.display = tab === 'active' ? 'block' : 'none';
      document.getElementById('expiredAlerts').style.display = tab === 'expired' ? 'block' : 'none';
    }

    async function runNow() {
      const btn = document.querySelector('.btn-run');
      btn.disabled = true;
      btn.innerHTML = '⏳ Iniciando...';
      try {
        await fetch('/run', { method: 'POST' });
        setTimeout(() => location.reload(), 2000);
      } catch (e) {
        alert('Erro ao executar');
        btn.disabled = false;
        btn.innerHTML = '▶️ Executar Agora';
      }
    }

    // Map interaction
    const tooltip = document.getElementById('mapTooltip');
    const markers = document.querySelectorAll('.pulse-marker');

    markers.forEach(marker => {
      marker.addEventListener('mouseenter', (e) => {
        const city = marker.dataset.city;
        const uf = marker.dataset.uf;
        tooltip.innerHTML = '<strong>' + city + '</strong> (' + uf + ')';
        tooltip.style.left = (e.offsetX + 15) + 'px';
        tooltip.style.top = (e.offsetY - 10) + 'px';
        tooltip.classList.add('visible');
      });

      marker.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
      });

      marker.addEventListener('click', () => {
        const uf = marker.dataset.uf;
        const card = document.querySelector('.alert-card[data-uf="' + uf + '"]');
        if (card) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('expanded');
          card.style.boxShadow = '0 0 0 3px var(--claro-red)';
          setTimeout(() => { card.style.boxShadow = ''; }, 2000);
        }
      });
    });

    // Highlight state on hover
    document.querySelectorAll('#estados path').forEach(path => {
      path.addEventListener('mouseenter', (e) => {
        const uf = path.id;
        const alertCard = document.querySelector('.alert-card[data-uf="' + uf + '"]');
        if (alertCard) {
          alertCard.style.background = 'var(--claro-gray-light)';
        }
      });

      path.addEventListener('mouseleave', (e) => {
        const uf = path.id;
        const alertCard = document.querySelector('.alert-card[data-uf="' + uf + '"]');
        if (alertCard) {
          alertCard.style.background = '';
        }
      });
    });
  </script>
</body>
</html>`;
}

// ===================== SERVIDOR HTTP =====================
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getDashboardHTML());
  } else if (url.pathname === "/health") {
    const status = {
      status: "ok",
      service: "monitor-chuva-bot",
      uptime: process.uptime(),
      lastMonitorRun: formatDate(lastMonitorRun),
      lastDailyRun: formatDate(lastDailyRun),
      monitorCount,
      dailyCount,
      isRunning,
      nextMonitorIn: lastMonitorRun
        ? Math.max(0, Math.round((MONITOR_INTERVAL_MS - (Date.now() - lastMonitorRun.getTime())) / 1000 / 60)) + " min"
        : "Em breve",
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status, null, 2));
  } else if (url.pathname === "/api/alerts") {
    const cache = loadAlertsCache();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(cache, null, 2));
  } else if (url.pathname === "/api/log") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(messageLog, null, 2));
  } else if (url.pathname === "/run" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Monitoramento iniciado" }));
    runMonitor();
  } else {
    res.writeHead(404);
    res.end("Not Found");
  }
});

// ===================== INICIALIZAÇÃO =====================
async function start() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("🤖 Monitor Chuva Bot - Railway Server");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`📅 Iniciado em: ${new Date().toISOString()}`);
  console.log(`🌐 Porta: ${PORT}`);
  console.log(`⏰ Intervalo de monitoramento: ${MONITOR_INTERVAL_MS / 1000 / 60} minutos`);
  console.log(`📋 Resumos diários: ${SUMMARY_HOURS_BRT.join('h e ')}h (horário de Brasília)`);
  console.log("═══════════════════════════════════════════════════════════\n");

  try {
    initBot();
  } catch (e) {
    console.error("❌ Erro na inicialização:", e.message);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP rodando na porta ${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}/`);
    console.log(`   Health check: http://localhost:${PORT}/health`);
    console.log(`   API Alertas: http://localhost:${PORT}/api/alerts`);
  });

  console.log("\n🚀 Executando primeiro monitoramento...\n");
  await runMonitor();

  setInterval(runMonitor, MONITOR_INTERVAL_MS);
  setInterval(checkDailySchedule, 60 * 1000);

  console.log("\n✅ Agendamentos configurados. Bot rodando continuamente.\n");
}

start().catch((e) => {
  console.error("❌ Erro fatal na inicialização:", e.message);
  process.exit(1);
});
