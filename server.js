import http from "http";
import fs from "fs";
import path from "path";
import { monitorRun, dailySummary, initBot } from "./bot.js";

// ===================== CONFIGURAÇÃO =====================
const PORT = process.env.PORT || 3000;
const MONITOR_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 horas
const DAILY_HOUR_BRT = 22; // 22h horário de Brasília

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

  if (brtHour === DAILY_HOUR_BRT && lastDailyCheck !== brtHour) {
    lastDailyCheck = brtHour;
    console.log(`🕙 São ${DAILY_HOUR_BRT}h em Brasília - iniciando resumo diário`);
    runDailySummary();
  } else if (brtHour !== DAILY_HOUR_BRT) {
    lastDailyCheck = -1;
  }
}

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
      return { city, ...data, expiry, isActive, severityLabel, severityClass };
    })
    .sort((a, b) => b.priority - a.priority || a.city.localeCompare(b.city));

  const activeAlerts = alertsArray.filter(a => a.isActive);
  const expiredAlerts = alertsArray.filter(a => !a.isActive);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Monitor Chuva Bot - Dashboard</title>
  <meta http-equiv="refresh" content="60">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e4e4e4;
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 {
      text-align: center;
      margin-bottom: 30px;
      font-size: 2em;
      color: #00d4ff;
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 20px; }
    .card {
      background: rgba(255,255,255,0.05);
      border-radius: 15px;
      padding: 20px;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .card h2 {
      font-size: 1.1em;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .status-item {
      background: rgba(0,0,0,0.2);
      padding: 12px;
      border-radius: 8px;
    }
    .status-item label { font-size: 0.75em; color: #888; display: block; }
    .status-item value { font-size: 1.1em; font-weight: 600; }
    .running { color: #ffc107; }
    .idle { color: #28a745; }
    .alert-item {
      background: rgba(0,0,0,0.2);
      padding: 12px;
      border-radius: 8px;
      margin-bottom: 10px;
      border-left: 4px solid;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .alert-item:hover { background: rgba(0,0,0,0.3); }
    .alert-item.danger { border-color: #dc3545; }
    .alert-item.warning { border-color: #ffc107; }
    .alert-item.info { border-color: #17a2b8; }
    .alert-item.expired { opacity: 0.5; }
    .alert-header { display: flex; justify-content: space-between; align-items: center; }
    .alert-city { font-weight: 600; font-size: 1.1em; }
    .alert-toggle { font-size: 0.8em; color: #888; transition: transform 0.2s; }
    .alert-item.expanded .alert-toggle { transform: rotate(180deg); }
    .alert-meta { font-size: 0.85em; color: #888; margin-top: 5px; }
    .alert-details {
      max-height: 0;
      overflow: hidden;
      transition: max-height 0.3s ease, padding 0.3s ease;
      padding: 0;
    }
    .alert-item.expanded .alert-details {
      max-height: 300px;
      padding-top: 12px;
      margin-top: 12px;
      border-top: 1px solid rgba(255,255,255,0.1);
    }
    .alert-detail-row { margin-bottom: 8px; font-size: 0.9em; }
    .alert-detail-row label { color: #888; display: block; font-size: 0.75em; margin-bottom: 2px; }
    .alert-detail-row value { color: #e4e4e4; }
    .alert-link {
      display: inline-block;
      margin-top: 8px;
      color: #00d4ff;
      text-decoration: none;
      font-size: 0.85em;
    }
    .alert-link:hover { text-decoration: underline; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.75em;
      font-weight: 600;
    }
    .badge.danger { background: #dc3545; color: white; }
    .badge.warning { background: #ffc107; color: black; }
    .badge.info { background: #17a2b8; color: white; }
    .badge.success { background: #28a745; color: white; }
    .btn {
      background: #00d4ff;
      color: #1a1a2e;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      width: 100%;
      margin-top: 10px;
    }
    .btn:hover { background: #00b8e6; }
    .btn:disabled { background: #555; cursor: not-allowed; }
    .log-item {
      background: rgba(0,0,0,0.2);
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 8px;
      font-size: 0.9em;
    }
    .log-time { color: #888; font-size: 0.8em; }
    .empty { color: #666; font-style: italic; padding: 20px; text-align: center; }
    .city-tag {
      display: inline-block;
      background: rgba(0,212,255,0.2);
      color: #00d4ff;
      padding: 4px 10px;
      border-radius: 15px;
      margin: 3px;
      font-size: 0.85em;
    }
    .header-stats {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin-bottom: 30px;
      flex-wrap: wrap;
    }
    .header-stat {
      text-align: center;
    }
    .header-stat .number {
      font-size: 2em;
      font-weight: 700;
      color: #00d4ff;
    }
    .header-stat .label {
      font-size: 0.8em;
      color: #888;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌧️ Monitor Chuva Bot</h1>

    <div class="header-stats">
      <div class="header-stat">
        <div class="number">${activeAlerts.length}</div>
        <div class="label">Alertas Ativos</div>
      </div>
      <div class="header-stat">
        <div class="number">${todayState.cities?.length || 0}</div>
        <div class="label">Cidades Hoje</div>
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

    <div class="grid">
      <!-- Status do Bot -->
      <div class="card">
        <h2>⚙️ Status do Sistema</h2>
        <div class="status-grid">
          <div class="status-item">
            <label>Estado</label>
            <value class="${isRunning ? 'running' : 'idle'}">${isRunning ? '🔄 Executando...' : '✅ Aguardando'}</value>
          </div>
          <div class="status-item">
            <label>Próxima Execução</label>
            <value>${nextMonitorMin} min</value>
          </div>
          <div class="status-item">
            <label>Último Monitor</label>
            <value>${formatDate(lastMonitorRun)}</value>
          </div>
          <div class="status-item">
            <label>Último Resumo</label>
            <value>${formatDate(lastDailyRun)}</value>
          </div>
        </div>
        <button class="btn" onclick="runNow()" ${isRunning ? 'disabled' : ''}>
          ${isRunning ? 'Executando...' : '▶️ Executar Agora'}
        </button>
      </div>

      <!-- Alertas Ativos -->
      <div class="card">
        <h2>🔔 Alertas Ativos (${activeAlerts.length})</h2>
        ${activeAlerts.length === 0 ? '<div class="empty">Nenhum alerta ativo</div>' : ''}
        ${activeAlerts.map((a, i) => `
          <div class="alert-item ${a.severityClass}" onclick="toggleAlert(this)">
            <div class="alert-header">
              <div class="alert-city">${a.city}</div>
              <span class="alert-toggle">▼</span>
            </div>
            <div class="alert-meta">
              <span class="badge ${a.severityClass}">${a.severidadeLabel || a.severityLabel}</span>
              Válido até: ${a.expiry.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div class="alert-details">
              ${a.evento ? `<div class="alert-detail-row"><label>Evento</label><value>${a.evento}</value></div>` : ''}
              ${a.descricao ? `<div class="alert-detail-row"><label>Descrição</label><value>${a.descricao}</value></div>` : ''}
              ${a.sentAt ? `<div class="alert-detail-row"><label>Enviado em</label><value>${new Date(a.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</value></div>` : ''}
              ${a.link ? `<a href="${a.link}" target="_blank" class="alert-link" onclick="event.stopPropagation()">🔗 Ver detalhes no INMET</a>` : ''}
            </div>
          </div>
        `).join('')}
      </div>

      <!-- Cidades com Alertas Hoje -->
      <div class="card">
        <h2>📍 Cidades Alertadas Hoje</h2>
        ${(todayState.cities?.length || 0) === 0 ? '<div class="empty">Nenhuma cidade com alertas hoje</div>' : ''}
        <div>
          ${(todayState.cities || []).map(c => `<span class="city-tag">${c}</span>`).join('')}
        </div>
      </div>

      <!-- Log de Mensagens -->
      <div class="card">
        <h2>📜 Últimas Mensagens Enviadas</h2>
        ${messageLog.length === 0 ? '<div class="empty">Nenhuma mensagem enviada ainda</div>' : ''}
        ${messageLog.slice(0, 10).map(log => `
          <div class="log-item">
            <span class="log-time">${new Date(log.timestamp).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</span>
            <strong>${log.city}</strong> - ${log.severity}
          </div>
        `).join('')}
      </div>

      <!-- Alertas Expirados -->
      <div class="card">
        <h2>⏰ Alertas Expirados (${expiredAlerts.length})</h2>
        ${expiredAlerts.length === 0 ? '<div class="empty">Nenhum alerta expirado</div>' : ''}
        ${expiredAlerts.slice(0, 5).map(a => `
          <div class="alert-item ${a.severityClass} expired" onclick="toggleAlert(this)">
            <div class="alert-header">
              <div class="alert-city">${a.city}</div>
              <span class="alert-toggle">▼</span>
            </div>
            <div class="alert-meta">
              <span class="badge ${a.severityClass}">${a.severidadeLabel || a.severityLabel}</span>
              Expirou: ${a.expiry.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </div>
            <div class="alert-details">
              ${a.evento ? `<div class="alert-detail-row"><label>Evento</label><value>${a.evento}</value></div>` : ''}
              ${a.descricao ? `<div class="alert-detail-row"><label>Descrição</label><value>${a.descricao}</value></div>` : ''}
              ${a.sentAt ? `<div class="alert-detail-row"><label>Enviado em</label><value>${new Date(a.sentAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</value></div>` : ''}
              ${a.link ? `<a href="${a.link}" target="_blank" class="alert-link" onclick="event.stopPropagation()">🔗 Ver detalhes no INMET</a>` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <p style="text-align: center; margin-top: 30px; color: #666; font-size: 0.85em;">
      Atualizado em: ${getBRTTime()} (Brasília) • Atualiza automaticamente a cada 60s
    </p>
  </div>

  <script>
    function toggleAlert(element) {
      element.classList.toggle('expanded');
    }

    async function runNow() {
      const btn = document.querySelector('.btn');
      btn.disabled = true;
      btn.textContent = '⏳ Iniciando...';
      try {
        await fetch('/run', { method: 'POST' });
        setTimeout(() => location.reload(), 2000);
      } catch (e) {
        alert('Erro ao executar');
        btn.disabled = false;
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
  console.log(`📋 Resumo diário: ${DAILY_HOUR_BRT}h (horário de Brasília)`);
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
