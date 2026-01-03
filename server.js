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

  // Agrupar alertas por região
  const regioes = {
    norte: ['AC', 'AM', 'AP', 'PA', 'RO', 'RR', 'TO'],
    nordeste: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'],
    centrooeste: ['DF', 'GO', 'MS', 'MT'],
    sudeste: ['ES', 'MG', 'RJ', 'SP'],
    sul: ['PR', 'RS', 'SC']
  };

  const alertsByUF = {};
  activeAlerts.forEach(a => {
    if (a.uf) alertsByUF[a.uf] = a;
  });

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
      --bg-dark: #0f0f0f;
      --bg-card: #1a1a1a;
      --bg-hover: #252525;
      --border: #333;
      --text: #e5e5e5;
      --text-muted: #888;
      --accent: #ED1B2E;
      --accent-light: #ff3d4d;
      --warning: #f5a623;
      --success: #22c55e;
      --info: #3b82f6;
    }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: var(--bg-dark);
      color: var(--text);
      min-height: 100vh;
    }
    .dashboard {
      display: grid;
      grid-template-columns: 1fr 420px;
      min-height: 100vh;
    }
    @media (max-width: 1100px) {
      .dashboard { grid-template-columns: 1fr; }
    }

    /* Left Panel - Overview */
    .panel-left {
      padding: 24px;
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    .header {
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
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, var(--accent) 0%, #b91c2c 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
    }
    .logo h1 {
      font-size: 1.5rem;
      font-weight: 700;
    }
    .logo h1 span { color: var(--accent); }

    .stats-row {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .stat-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 24px;
      text-align: center;
      min-width: 100px;
    }
    .stat-card .value {
      font-size: 2rem;
      font-weight: 700;
    }
    .stat-card .value.danger { color: var(--accent); }
    .stat-card .value.success { color: var(--success); }
    .stat-card .label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-top: 4px;
    }

    /* Region Grid */
    .regions-section h2 {
      font-size: 1rem;
      font-weight: 600;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .regions-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 12px;
    }
    .region-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
    }
    .region-card h3 {
      font-size: 0.85rem;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .states-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .state-chip {
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      background: var(--bg-hover);
      color: var(--text-muted);
      transition: all 0.2s;
    }
    .state-chip.danger {
      background: rgba(237, 27, 46, 0.15);
      color: var(--accent);
      border: 1px solid var(--accent);
    }
    .state-chip.warning {
      background: rgba(245, 166, 35, 0.15);
      color: var(--warning);
      border: 1px solid var(--warning);
    }

    /* Status Bar */
    .status-bar {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: auto;
      padding-top: 16px;
      border-top: 1px solid var(--border);
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.85rem;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--success);
    }
    .status-dot.running { background: var(--warning); }
    .btn-primary {
      background: var(--accent);
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      margin-left: auto;
    }
    .btn-primary:hover { background: var(--accent-light); }
    .btn-primary:disabled { background: var(--border); cursor: not-allowed; }

    /* Right Panel - Alerts */
    .panel-right {
      background: var(--bg-card);
      display: flex;
      flex-direction: column;
      max-height: 100vh;
      overflow: hidden;
    }
    .panel-header {
      padding: 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .panel-header h2 {
      font-size: 1.1rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .count-badge {
      background: ${activeAlerts.length > 0 ? 'var(--accent)' : 'var(--success)'};
      color: white;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 700;
    }

    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
    }
    .tab {
      flex: 1;
      padding: 12px;
      background: none;
      border: none;
      color: var(--text-muted);
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border-bottom: 2px solid transparent;
    }
    .tab:hover { color: var(--text); }
    .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

    .alerts-container {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }
    .alerts-container::-webkit-scrollbar { width: 6px; }
    .alerts-container::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

    .alert-item {
      background: var(--bg-dark);
      border-radius: 10px;
      margin-bottom: 12px;
      border-left: 4px solid var(--border);
      overflow: hidden;
      transition: all 0.2s;
    }
    .alert-item:hover { background: var(--bg-hover); }
    .alert-item.danger { border-left-color: var(--accent); }
    .alert-item.warning { border-left-color: var(--warning); }
    .alert-item.info { border-left-color: var(--info); }
    .alert-item.expired { opacity: 0.5; }

    .alert-header {
      padding: 14px 16px;
      cursor: pointer;
    }
    .alert-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .alert-title strong {
      font-size: 1rem;
    }
    .alert-title .uf {
      background: var(--bg-hover);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .alert-event {
      font-size: 0.85rem;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .alert-badges {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .badge {
      padding: 3px 10px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge.danger { background: var(--accent); color: white; }
    .badge.warning { background: var(--warning); color: #1a1a1a; }
    .badge.info { background: var(--info); color: white; }
    .alert-time {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .alert-expand {
      color: var(--text-muted);
      font-size: 0.8rem;
      float: right;
      transition: transform 0.2s;
    }
    .alert-item.expanded .alert-expand { transform: rotate(180deg); }

    .alert-details {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s;
    }
    .alert-item.expanded .alert-details { max-height: 400px; }
    .alert-details-inner {
      padding: 0 16px 16px;
      border-top: 1px solid var(--border);
      margin-top: 0;
      padding-top: 12px;
    }
    .detail-row {
      margin-bottom: 10px;
    }
    .detail-row label {
      display: block;
      font-size: 0.7rem;
      color: var(--text-muted);
      text-transform: uppercase;
      margin-bottom: 2px;
    }
    .detail-row p {
      font-size: 0.85rem;
      line-height: 1.4;
    }
    .alert-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--accent);
      text-decoration: none;
      font-size: 0.85rem;
      font-weight: 500;
      margin-top: 8px;
    }
    .alert-link:hover { text-decoration: underline; }

    .empty-state {
      text-align: center;
      padding: 48px 24px;
      color: var(--text-muted);
    }
    .empty-state .icon {
      font-size: 3rem;
      margin-bottom: 12px;
      opacity: 0.5;
    }

    .footer {
      padding: 12px 16px;
      border-top: 1px solid var(--border);
      font-size: 0.75rem;
      color: var(--text-muted);
      text-align: center;
    }

    @media (max-width: 1100px) {
      .panel-left { border-right: none; border-bottom: 1px solid var(--border); }
      .panel-right { max-height: none; }
    }
  </style>
</head>
<body>
  <div class="dashboard">
    <!-- Left Panel -->
    <div class="panel-left">
      <div class="header">
        <div class="logo">
          <div class="logo-icon">⛈️</div>
          <h1>Monitor <span>Alertas</span></h1>
        </div>
      </div>

      <div class="stats-row">
        <div class="stat-card">
          <div class="value ${activeAlerts.length > 0 ? 'danger' : 'success'}">${activeAlerts.length}</div>
          <div class="label">Alertas Ativos</div>
        </div>
        <div class="stat-card">
          <div class="value">${todayState.cities?.length || 0}</div>
          <div class="label">Cidades Hoje</div>
        </div>
        <div class="stat-card">
          <div class="value">${monitorCount}</div>
          <div class="label">Verificações</div>
        </div>
        <div class="stat-card">
          <div class="value">${hours}h${minutes}m</div>
          <div class="label">Uptime</div>
        </div>
      </div>

      <div class="regions-section">
        <h2>🗺️ Estados por Região</h2>
        <div class="regions-grid">
          <div class="region-card">
            <h3>Norte</h3>
            <div class="states-grid">
              ${regioes.norte.map(uf => {
                const alert = alertsByUF[uf];
                const cls = alert ? (alert.priority === 3 ? 'danger' : 'warning') : '';
                return `<span class="state-chip ${cls}">${uf}</span>`;
              }).join('')}
            </div>
          </div>
          <div class="region-card">
            <h3>Nordeste</h3>
            <div class="states-grid">
              ${regioes.nordeste.map(uf => {
                const alert = alertsByUF[uf];
                const cls = alert ? (alert.priority === 3 ? 'danger' : 'warning') : '';
                return `<span class="state-chip ${cls}">${uf}</span>`;
              }).join('')}
            </div>
          </div>
          <div class="region-card">
            <h3>Centro-Oeste</h3>
            <div class="states-grid">
              ${regioes.centrooeste.map(uf => {
                const alert = alertsByUF[uf];
                const cls = alert ? (alert.priority === 3 ? 'danger' : 'warning') : '';
                return `<span class="state-chip ${cls}">${uf}</span>`;
              }).join('')}
            </div>
          </div>
          <div class="region-card">
            <h3>Sudeste</h3>
            <div class="states-grid">
              ${regioes.sudeste.map(uf => {
                const alert = alertsByUF[uf];
                const cls = alert ? (alert.priority === 3 ? 'danger' : 'warning') : '';
                return `<span class="state-chip ${cls}">${uf}</span>`;
              }).join('')}
            </div>
          </div>
          <div class="region-card">
            <h3>Sul</h3>
            <div class="states-grid">
              ${regioes.sul.map(uf => {
                const alert = alertsByUF[uf];
                const cls = alert ? (alert.priority === 3 ? 'danger' : 'warning') : '';
                return `<span class="state-chip ${cls}">${uf}</span>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>

      <div class="status-bar">
        <div class="status-item">
          <span class="status-dot ${isRunning ? 'running' : ''}"></span>
          ${isRunning ? 'Verificando...' : 'Aguardando'}
        </div>
        <div class="status-item">
          ⏱️ Próxima: ${nextMonitorMin}min
        </div>
        <div class="status-item">
          📅 Resumos: 12h e 22h
        </div>
        <button class="btn-primary" onclick="runNow()" ${isRunning ? 'disabled' : ''}>
          ${isRunning ? 'Executando...' : '▶ Verificar Agora'}
        </button>
      </div>
    </div>

    <!-- Right Panel -->
    <div class="panel-right">
      <div class="panel-header">
        <h2>🔔 Alertas <span class="count-badge">${activeAlerts.length}</span></h2>
      </div>

      <div class="tabs">
        <button class="tab active" onclick="showTab('active', this)">Ativos (${activeAlerts.length})</button>
        <button class="tab" onclick="showTab('expired', this)">Expirados (${expiredAlerts.length})</button>
      </div>

      <div class="alerts-container" id="activeAlerts">
        ${activeAlerts.length === 0 ? `
          <div class="empty-state">
            <div class="icon">✅</div>
            <p>Nenhum alerta ativo no momento</p>
          </div>
        ` : activeAlerts.map(a => `
          <div class="alert-item ${a.severityClass}" onclick="this.classList.toggle('expanded')">
            <div class="alert-header">
              <div class="alert-title">
                <strong>${a.city}</strong>
                <span class="uf">${a.uf}</span>
                <span class="alert-expand">▼</span>
              </div>
              <div class="alert-event">${a.evento || 'Alerta meteorológico'}</div>
              <div class="alert-badges">
                <span class="badge ${a.severityClass}">${a.severidadeLabel || a.severityLabel}</span>
                <span class="alert-time">até ${a.expiry.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
            <div class="alert-details">
              <div class="alert-details-inner">
                ${a.descricao ? `<div class="detail-row"><label>Descrição</label><p>${a.descricao}</p></div>` : ''}
                ${a.sentAt ? `<div class="detail-row"><label>Alertado em</label><p>${new Date(a.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>` : ''}
                ${a.link ? `<a href="${a.link}" target="_blank" class="alert-link" onclick="event.stopPropagation()">🔗 Ver detalhes no INMET</a>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="alerts-container" id="expiredAlerts" style="display: none;">
        ${expiredAlerts.length === 0 ? `
          <div class="empty-state">
            <div class="icon">📭</div>
            <p>Nenhum alerta expirado</p>
          </div>
        ` : expiredAlerts.slice(0, 15).map(a => `
          <div class="alert-item ${a.severityClass} expired" onclick="this.classList.toggle('expanded')">
            <div class="alert-header">
              <div class="alert-title">
                <strong>${a.city}</strong>
                <span class="uf">${a.uf}</span>
                <span class="alert-expand">▼</span>
              </div>
              <div class="alert-event">${a.evento || 'Alerta meteorológico'}</div>
              <div class="alert-badges">
                <span class="badge ${a.severityClass}">${a.severidadeLabel || a.severityLabel}</span>
                <span class="alert-time">expirou ${a.expiry.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            </div>
            <div class="alert-details">
              <div class="alert-details-inner">
                ${a.descricao ? `<div class="detail-row"><label>Descrição</label><p>${a.descricao}</p></div>` : ''}
                ${a.sentAt ? `<div class="detail-row"><label>Alertado em</label><p>${new Date(a.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div>` : ''}
                ${a.link ? `<a href="${a.link}" target="_blank" class="alert-link" onclick="event.stopPropagation()">🔗 Ver detalhes no INMET</a>` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <div class="footer">
        Atualizado: ${getBRTTime()} • Auto-refresh 60s
      </div>
    </div>
  </div>

  <script>
    function showTab(tab, btn) {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('activeAlerts').style.display = tab === 'active' ? 'block' : 'none';
      document.getElementById('expiredAlerts').style.display = tab === 'expired' ? 'block' : 'none';
    }

    async function runNow() {
      const btn = document.querySelector('.btn-primary');
      btn.disabled = true;
      btn.textContent = '⏳ Iniciando...';
      try {
        await fetch('/run', { method: 'POST' });
        setTimeout(() => location.reload(), 2000);
      } catch (e) {
        alert('Erro ao executar');
        btn.disabled = false;
        btn.textContent = '▶ Verificar Agora';
      }
    }
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
