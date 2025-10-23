import fetch from "node-fetch";

const CHAT_ID = -1003065918727;
const THRESHOLD_MM = 10;
const SEND_DELAY_MS = 5000;
const API_CALL_DELAY_MS = 500;

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

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY;
const sleep = (ms) => new Promise(r => setTimeout(r,ms));

function api(lat, lon){
  return `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br`;
} //  <<<<<<  FECHADO AQUI  ✅

function fmt(mm){
  const n = Number(mm??0);
  return Number.isFinite(n)? (n%1===0?String(n):n.toFixed(1)):"0";
}

function hh(ts){
  if(!ts) return "";
  return new Date(ts*1000).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit",hour12:false});
}

async function sendHTML(text){
  await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`,{
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body:JSON.stringify({ chat_id:CHAT_ID,text,parse_mode:"HTML" })
  });
}

async function run(){
  const diag=[];
  const rainMsgs=[];
  const officialMsgs=[];

  for(const c of CITIES){
    try{
      const r = await fetch(api(c.lat,c.lon));
      if(!r.ok){
        diag.push(`${c.uf}-${c.name}: HTTP ${r.status}`);
      }else{
        const d = await r.json();
        const mm = d?.hourly?.[0]?.rain?.["1h"] ?? 0;
        const alerts = Array.isArray(d.alerts)? d.alerts.length:0;
        const end = Array.isArray(d.alerts)&&d.alerts[0]?.end? ` até ${hh(d.alerts[0].end)}`:"";
        diag.push(`${c.uf}-${c.name}: ${fmt(mm)} mm/h, alerts=${alerts}${end}`);

        if(mm>=THRESHOLD_MM){
          rainMsgs.push(`🌧️ <b>${c.name.toUpperCase()}</b>\n~${fmt(mm)} mm/h`);
        }
        if(Array.isArray(d.alerts)){
          for(const a of d.alerts){
            officialMsgs.push(`🚨 ALERTA — ${c.name.toUpperCase()}\n${a.event||"Alerta"}\nAté: ${hh(a.end)}`);
          }
        }
      }
    }catch(e){
      diag.push(`${c.uf}-${c.name}: ERRO ${e.message}`);
    }
    await sleep(API_CALL_DELAY_MS);
  }

  for(const m of rainMsgs){ await sendHTML(m); await sleep(SEND_DELAY_MS); }
  for(const m of officialMsgs){ await sendHTML(m); await sleep(SEND_DELAY_MS); }

  await sendHTML(`<b>DIAGNÓSTICO</b>\n<pre>${diag.join("\n")}</pre>\nChuva=${rainMsgs.length}, Oficiais=${officialMsgs.length}`);
}

run();
