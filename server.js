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

  const alertsByUF = {};
  activeAlerts.forEach(a => {
    if (a.uf) alertsByUF[a.uf] = a;
  });

  // Função para determinar classe do estado
  const getStateClass = (uf) => {
    const alert = alertsByUF[uf];
    if (!alert) return '';
    return alert.priority === 3 ? 'alert-danger' : 'alert-warning';
  };

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Monitor de Alertas Meteorológicos</title>
  <meta http-equiv="refresh" content="60">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg-dark: #0d1117;
      --bg-card: #161b22;
      --bg-hover: #21262d;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #7d8590;
      --accent: #ED1B2E;
      --accent-light: #ff4757;
      --warning: #f0883e;
      --success: #3fb950;
      --info: #58a6ff;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg-dark);
      color: var(--text);
      min-height: 100vh;
    }

    /* Layout */
    .app {
      display: grid;
      grid-template-columns: 1fr 380px;
      min-height: 100vh;
    }
    @media (max-width: 1000px) {
      .app { grid-template-columns: 1fr; }
      .sidebar { border-left: none !important; border-top: 1px solid var(--border); }
    }

    /* Main Panel */
    .main {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      overflow: auto;
    }

    /* Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, var(--accent), #c41020);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
    }
    .brand h1 {
      font-size: 1.4rem;
      font-weight: 600;
    }
    .brand h1 span { color: var(--accent); }

    /* Stats */
    .stats {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .stat {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 20px;
      text-align: center;
      min-width: 90px;
    }
    .stat-value {
      font-size: 1.75rem;
      font-weight: 700;
      line-height: 1;
    }
    .stat-value.danger { color: var(--accent); }
    .stat-value.ok { color: var(--success); }
    .stat-label {
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 6px;
    }

    /* Map Container */
    .map-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 400px;
    }
    .map-header {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .map-header h2 {
      font-size: 0.95rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .legend {
      display: flex;
      gap: 14px;
      font-size: 0.75rem;
    }
    .legend-item {
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
    }
    .legend-dot.danger { background: var(--accent); }
    .legend-dot.warning { background: var(--warning); }
    .legend-dot.ok { background: var(--bg-hover); border: 1px solid var(--border); }

    .map-body {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      position: relative;
    }

    /* Brazil Map SVG */
    .brazil-svg {
      width: 100%;
      height: 100%;
      max-width: 550px;
      max-height: 520px;
    }
    .brazil-svg .state {
      fill: var(--bg-hover);
      stroke: var(--border);
      stroke-width: 0.5;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .brazil-svg .state:hover {
      fill: #2d333b;
      stroke: var(--text-muted);
      stroke-width: 1;
    }
    .brazil-svg .state.alert-danger {
      fill: rgba(237, 27, 46, 0.35);
      stroke: var(--accent);
      stroke-width: 1.5;
    }
    .brazil-svg .state.alert-danger:hover {
      fill: rgba(237, 27, 46, 0.5);
    }
    .brazil-svg .state.alert-warning {
      fill: rgba(240, 136, 62, 0.3);
      stroke: var(--warning);
      stroke-width: 1.5;
    }
    .brazil-svg .state.alert-warning:hover {
      fill: rgba(240, 136, 62, 0.45);
    }
    .brazil-svg .state-label {
      font-size: 7px;
      fill: var(--text-muted);
      pointer-events: none;
      font-weight: 500;
    }
    .brazil-svg .state.alert-danger + .state-label,
    .brazil-svg .state.alert-warning + .state-label {
      fill: var(--text);
      font-weight: 600;
    }

    /* Tooltip */
    .tooltip {
      position: fixed;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 0.85rem;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 1000;
      max-width: 280px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .tooltip.visible { opacity: 1; }
    .tooltip-title {
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tooltip-title .uf-badge {
      background: var(--bg-hover);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.7rem;
    }
    .tooltip-alert {
      color: var(--accent);
      font-size: 0.8rem;
    }
    .tooltip-alert.warning { color: var(--warning); }
    .tooltip-ok {
      color: var(--success);
      font-size: 0.8rem;
    }

    /* Status Bar */
    .status-bar {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: center;
      padding: 14px 18px;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
    }
    .status-dot.running {
      background: var(--warning);
      animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .btn {
      background: var(--accent);
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
      transition: all 0.2s;
      margin-left: auto;
    }
    .btn:hover { background: var(--accent-light); }
    .btn:disabled { background: var(--bg-hover); color: var(--text-muted); cursor: not-allowed; }

    /* Sidebar */
    .sidebar {
      background: var(--bg-card);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      max-height: 100vh;
      overflow: hidden;
    }
    .sidebar-header {
      padding: 16px 18px;
      border-bottom: 1px solid var(--border);
    }
    .sidebar-header h2 {
      font-size: 1rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      background: ${activeAlerts.length > 0 ? 'var(--accent)' : 'var(--success)'};
      color: white;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.8rem;
      font-weight: 700;
    }

    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
    }
    .tab {
      flex: 1;
      padding: 10px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.2s;
    }
    .tab:hover { color: var(--text); }
    .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

    .alerts-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .alerts-list::-webkit-scrollbar { width: 6px; }
    .alerts-list::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    .alert-card {
      background: var(--bg-dark);
      border-radius: 8px;
      margin-bottom: 10px;
      border-left: 3px solid var(--border);
      transition: all 0.2s;
      overflow: hidden;
    }
    .alert-card:hover { background: var(--bg-hover); }
    .alert-card.danger { border-left-color: var(--accent); }
    .alert-card.warning { border-left-color: var(--warning); }
    .alert-card.expired { opacity: 0.5; }

    .alert-card-header {
      padding: 12px 14px;
      cursor: pointer;
    }
    .alert-title {
      font-weight: 600;
      font-size: 0.95rem;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .alert-title .uf {
      background: var(--bg-hover);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 600;
    }
    .alert-title .expand {
      margin-left: auto;
      color: var(--text-muted);
      font-size: 0.75rem;
      transition: transform 0.2s;
    }
    .alert-card.expanded .expand { transform: rotate(180deg); }
    .alert-event {
      font-size: 0.8rem;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .alert-meta {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .severity-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .severity-badge.danger { background: var(--accent); color: white; }
    .severity-badge.warning { background: var(--warning); color: #000; }
    .alert-time {
      font-size: 0.7rem;
      color: var(--text-muted);
    }

    .alert-details {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease;
    }
    .alert-card.expanded .alert-details { max-height: 300px; }
    .alert-details-inner {
      padding: 12px 14px;
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
    }
    .detail-row { margin-bottom: 8px; }
    .detail-row label {
      display: block;
      font-size: 0.65rem;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .alert-link {
      color: var(--accent);
      text-decoration: none;
      font-weight: 500;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 6px;
    }
    .alert-link:hover { text-decoration: underline; }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      color: var(--text-muted);
    }
    .empty-state .icon { font-size: 2.5rem; margin-bottom: 10px; opacity: 0.5; }

    .sidebar-footer {
      padding: 10px 14px;
      border-top: 1px solid var(--border);
      font-size: 0.7rem;
      color: var(--text-muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="app">
    <!-- Main Panel -->
    <div class="main">
      <div class="header">
        <div class="brand">
          <div class="brand-icon">⛈️</div>
          <h1>Monitor <span>Alertas</span></h1>
        </div>
        <div class="stats">
          <div class="stat">
            <div class="stat-value ${activeAlerts.length > 0 ? 'danger' : 'ok'}">${activeAlerts.length}</div>
            <div class="stat-label">Alertas</div>
          </div>
          <div class="stat">
            <div class="stat-value">${todayState.cities?.length || 0}</div>
            <div class="stat-label">Cidades</div>
          </div>
          <div class="stat">
            <div class="stat-value">${monitorCount}</div>
            <div class="stat-label">Checks</div>
          </div>
          <div class="stat">
            <div class="stat-value">${hours}h${minutes}m</div>
            <div class="stat-label">Uptime</div>
          </div>
        </div>
      </div>

      <div class="map-card">
        <div class="map-header">
          <h2>🗺️ Mapa de Alertas</h2>
          <div class="legend">
            <div class="legend-item"><div class="legend-dot danger"></div> Perigo</div>
            <div class="legend-item"><div class="legend-dot warning"></div> Potencial</div>
            <div class="legend-item"><div class="legend-dot ok"></div> Normal</div>
          </div>
        </div>
        <div class="map-body">
          <svg class="brazil-svg" viewBox="0 0 450 470" xmlns="http://www.w3.org/2000/svg">
            <!-- Região Norte -->
            <path class="state ${getStateClass('AM')}" id="AM" d="M40,100 L150,80 L180,110 L175,160 L130,180 L70,170 L35,140 Z"/>
            <path class="state ${getStateClass('RR')}" id="RR" d="M95,55 L130,50 L140,80 L115,95 L90,80 Z"/>
            <path class="state ${getStateClass('AP')}" id="AP" d="M200,40 L235,45 L240,80 L215,95 L195,75 Z"/>
            <path class="state ${getStateClass('PA')}" id="PA" d="M150,80 L260,75 L280,125 L260,165 L175,160 L180,110 Z"/>
            <path class="state ${getStateClass('AC')}" id="AC" d="M25,145 L70,170 L65,195 L20,190 Z"/>
            <path class="state ${getStateClass('RO')}" id="RO" d="M70,170 L130,180 L135,220 L85,225 L65,195 Z"/>
            <path class="state ${getStateClass('TO')}" id="TO" d="M260,165 L295,165 L300,240 L255,250 L250,190 Z"/>

            <!-- Região Nordeste -->
            <path class="state ${getStateClass('MA')}" id="MA" d="M260,115 L320,120 L330,170 L295,165 L260,165 L280,125 Z"/>
            <path class="state ${getStateClass('PI')}" id="PI" d="M295,165 L330,170 L340,220 L300,230 L295,180 Z"/>
            <path class="state ${getStateClass('CE')}" id="CE" d="M330,140 L375,145 L380,185 L340,190 L330,160 Z"/>
            <path class="state ${getStateClass('RN')}" id="RN" d="M375,145 L410,150 L405,175 L380,170 Z"/>
            <path class="state ${getStateClass('PB')}" id="PB" d="M375,175 L415,180 L410,200 L378,195 Z"/>
            <path class="state ${getStateClass('PE')}" id="PE" d="M345,195 L415,205 L408,230 L342,222 Z"/>
            <path class="state ${getStateClass('AL')}" id="AL" d="M365,230 L405,235 L400,255 L362,250 Z"/>
            <path class="state ${getStateClass('SE')}" id="SE" d="M355,255 L390,260 L385,280 L352,275 Z"/>
            <path class="state ${getStateClass('BA')}" id="BA" d="M300,240 L385,280 L365,350 L290,330 L280,270 Z"/>

            <!-- Região Centro-Oeste -->
            <path class="state ${getStateClass('MT')}" id="MT" d="M135,220 L250,210 L260,310 L180,320 L140,280 Z"/>
            <path class="state ${getStateClass('GO')}" id="GO" d="M250,260 L310,280 L320,345 L265,355 L250,310 Z"/>
            <path class="state ${getStateClass('DF')}" id="DF" d="M285,290 L305,290 L305,310 L285,310 Z"/>
            <path class="state ${getStateClass('MS')}" id="MS" d="M180,320 L260,310 L260,380 L200,395 L175,360 Z"/>

            <!-- Região Sudeste -->
            <path class="state ${getStateClass('MG')}" id="MG" d="M290,300 L375,325 L360,390 L290,380 L275,340 Z"/>
            <path class="state ${getStateClass('ES')}" id="ES" d="M365,320 L395,330 L388,365 L358,355 Z"/>
            <path class="state ${getStateClass('RJ')}" id="RJ" d="M335,375 L385,385 L375,415 L335,405 Z"/>
            <path class="state ${getStateClass('SP')}" id="SP" d="M255,365 L335,380 L320,430 L250,420 Z"/>

            <!-- Região Sul -->
            <path class="state ${getStateClass('PR')}" id="PR" d="M230,405 L315,420 L305,460 L225,450 Z"/>
            <path class="state ${getStateClass('SC')}" id="SC" d="M245,455 L310,460 L300,490 L250,485 Z"/>
            <path class="state ${getStateClass('RS')}" id="RS" d="M215,480 L295,485 L270,545 L195,530 Z"/>

            <!-- Labels dos estados -->
            <text class="state-label" x="105" y="135">AM</text>
            <text class="state-label" x="110" y="72">RR</text>
            <text class="state-label" x="215" y="68">AP</text>
            <text class="state-label" x="210" y="125">PA</text>
            <text class="state-label" x="40" y="175">AC</text>
            <text class="state-label" x="95" y="200">RO</text>
            <text class="state-label" x="270" y="210">TO</text>
            <text class="state-label" x="290" y="145">MA</text>
            <text class="state-label" x="312" y="200">PI</text>
            <text class="state-label" x="352" y="168">CE</text>
            <text class="state-label" x="388" y="163">RN</text>
            <text class="state-label" x="390" y="190">PB</text>
            <text class="state-label" x="375" y="215">PE</text>
            <text class="state-label" x="380" y="245">AL</text>
            <text class="state-label" x="368" y="270">SE</text>
            <text class="state-label" x="325" y="300">BA</text>
            <text class="state-label" x="195" y="270">MT</text>
            <text class="state-label" x="280" y="325">GO</text>
            <text class="state-label" x="288" y="303">DF</text>
            <text class="state-label" x="215" y="355">MS</text>
            <text class="state-label" x="320" y="355">MG</text>
            <text class="state-label" x="372" y="345">ES</text>
            <text class="state-label" x="352" y="398">RJ</text>
            <text class="state-label" x="280" y="405">SP</text>
            <text class="state-label" x="265" y="438">PR</text>
            <text class="state-label" x="272" y="472">SC</text>
            <text class="state-label" x="245" y="515">RS</text>
          </svg>
        </div>
      </div>

      <div class="status-bar">
        <div class="status-item">
          <span class="status-dot ${isRunning ? 'running' : ''}"></span>
          ${isRunning ? 'Verificando...' : 'Aguardando'}
        </div>
        <div class="status-item">⏱️ Próxima: ${nextMonitorMin}min</div>
        <div class="status-item">📅 Resumos: 12h e 22h</div>
        <button class="btn" onclick="runNow()" ${isRunning ? 'disabled' : ''}>
          ${isRunning ? 'Executando...' : '▶ Verificar'}
        </button>
      </div>
    </div>

    <!-- Sidebar -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>🔔 Alertas <span class="badge">${activeAlerts.length}</span></h2>
      </div>

      <div class="tabs">
        <button class="tab active" onclick="showTab('active', this)">Ativos (${activeAlerts.length})</button>
        <button class="tab" onclick="showTab('expired', this)">Expirados (${expiredAlerts.length})</button>
      </div>

      <div class="alerts-list" id="activeAlerts">
        ${activeAlerts.length === 0 ? `
          <div class="empty-state">
            <div class="icon">✅</div>
            <p>Nenhum alerta ativo</p>
          </div>
        ` : activeAlerts.map(a => `
          <div class="alert-card ${a.severityClass}" data-uf="${a.uf}" onclick="this.classList.toggle('expanded')">
            <div class="alert-card-header">
              <div class="alert-title">
                ${a.city}
                <span class="uf">${a.uf}</span>
                <span class="expand">▼</span>
              </div>
              <div class="alert-event">${a.evento || 'Alerta meteorológico'}</div>
              <div class="alert-meta">
                <span class="severity-badge ${a.severityClass}">${a.severidadeLabel || a.severityLabel}</span>
                <span class="alert-time">até ${a.expiry.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
            <div class="alert-details">
              <div class="alert-details-inner">
                ${a.descricao ? `<div class="detail-row"><label>Descrição</label><p>${a.descricao}</p></div>` : ''}
                ${a.sentAt ? `<div class="detail-row"><label>Alertado em</label><p>${new Date(a.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>` : ''}
                ${a.link ? `<a href="${a.link}" target="_blank" class="alert-link" onclick="event.stopPropagation()">🔗 Ver no INMET</a>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="alerts-list" id="expiredAlerts" style="display: none;">
        ${expiredAlerts.length === 0 ? `
          <div class="empty-state">
            <div class="icon">📭</div>
            <p>Nenhum alerta expirado</p>
          </div>
        ` : expiredAlerts.slice(0, 15).map(a => `
          <div class="alert-card ${a.severityClass} expired" data-uf="${a.uf}" onclick="this.classList.toggle('expanded')">
            <div class="alert-card-header">
              <div class="alert-title">
                ${a.city}
                <span class="uf">${a.uf}</span>
                <span class="expand">▼</span>
              </div>
              <div class="alert-event">${a.evento || 'Alerta meteorológico'}</div>
              <div class="alert-meta">
                <span class="severity-badge ${a.severityClass}">${a.severidadeLabel || a.severityLabel}</span>
                <span class="alert-time">expirou ${a.expiry.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
            <div class="alert-details">
              <div class="alert-details-inner">
                ${a.descricao ? `<div class="detail-row"><label>Descrição</label><p>${a.descricao}</p></div>` : ''}
                ${a.sentAt ? `<div class="detail-row"><label>Alertado em</label><p>${new Date(a.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>` : ''}
                ${a.link ? `<a href="${a.link}" target="_blank" class="alert-link" onclick="event.stopPropagation()">🔗 Ver no INMET</a>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="sidebar-footer">
        ${getBRTTime()} • Auto-refresh 60s
      </div>
    </aside>
  </div>

  <!-- Tooltip -->
  <div class="tooltip" id="tooltip"></div>

  <script>
    // Dados dos alertas para o tooltip
    const alertsData = ${JSON.stringify(Object.fromEntries(
      activeAlerts.map(a => [a.uf, { city: a.city, evento: a.evento, severidade: a.severidadeLabel || a.severityLabel, priority: a.priority }])
    ))};

    const cityNames = ${JSON.stringify(CITY_TO_UF)};
    const ufToCity = Object.fromEntries(Object.entries(cityNames).map(([k,v]) => [v,k]));

    // Tooltip
    const tooltip = document.getElementById('tooltip');

    document.querySelectorAll('.state').forEach(state => {
      state.addEventListener('mouseenter', (e) => {
        const uf = state.id;
        const city = ufToCity[uf] || uf;
        const alert = alertsData[uf];

        let html = '<div class="tooltip-title">' + city + ' <span class="uf-badge">' + uf + '</span></div>';

        if (alert) {
          const cls = alert.priority === 3 ? '' : ' warning';
          html += '<div class="tooltip-alert' + cls + '">⚠️ ' + alert.evento + '</div>';
          html += '<div class="tooltip-alert' + cls + '">' + alert.severidade + '</div>';
        } else {
          html += '<div class="tooltip-ok">✓ Sem alertas</div>';
        }

        tooltip.innerHTML = html;
        tooltip.classList.add('visible');
      });

      state.addEventListener('mousemove', (e) => {
        tooltip.style.left = (e.clientX + 15) + 'px';
        tooltip.style.top = (e.clientY + 10) + 'px';
      });

      state.addEventListener('mouseleave', () => {
        tooltip.classList.remove('visible');
      });

      state.addEventListener('click', () => {
        const uf = state.id;
        const card = document.querySelector('.alert-card[data-uf="' + uf + '"]');
        if (card) {
          // Switch to active tab if needed
          document.querySelector('.tab.active')?.click();

          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.classList.add('expanded');
          card.style.outline = '2px solid var(--accent)';
          setTimeout(() => { card.style.outline = ''; }, 2000);
        }
      });
    });

    // Tabs
    function showTab(tab, btn) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('activeAlerts').style.display = tab === 'active' ? 'block' : 'none';
      document.getElementById('expiredAlerts').style.display = tab === 'expired' ? 'block' : 'none';
    }

    // Run button
    async function runNow() {
      const btn = document.querySelector('.btn');
      btn.disabled = true;
      btn.textContent = '⏳ Aguarde...';
      try {
        await fetch('/run', { method: 'POST' });
        setTimeout(() => location.reload(), 2000);
      } catch (e) {
        alert('Erro');
        btn.disabled = false;
        btn.textContent = '▶ Verificar';
      }
    }

    // Highlight card on hover state
    document.querySelectorAll('.alert-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        const uf = card.dataset.uf;
        const state = document.getElementById(uf);
        if (state) {
          state.style.filter = 'brightness(1.3)';
        }
      });
      card.addEventListener('mouseleave', () => {
        const uf = card.dataset.uf;
        const state = document.getElementById(uf);
        if (state) {
          state.style.filter = '';
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
