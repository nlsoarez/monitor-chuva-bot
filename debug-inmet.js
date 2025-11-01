import fetch from "node-fetch";

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

function parseINMETRSS(xml) {
  const alerts = [];
  const items = xml.split("<item>");
  
  console.log(`\n📊 Total de <item> encontrados: ${items.length - 1}`);
  
  for (let i = 1; i < items.length; i++) {
    const item = items[i];
    
    const titleMatch = item.match(/<title>(.*?)<\/title>/);
    const descMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s);
    const guidMatch = item.match(/<guid>(.*?)<\/guid>/);
    
    if (!descMatch) {
      console.log(`⚠️ Item ${i} sem descrição`);
      continue;
    }
    
    const desc = descMatch[1];
    
    const eventoMatch = desc.match(/<td>Evento<\/td><td>(.*?)<\/td>/);
    const severidadeMatch = desc.match(/<td>Severidade<\/td><td>(.*?)<\/td>/);
    const areaMatch = desc.match(/<td>Área<\/td><td>Aviso para as Áreas: (.*?)<\/td>/);
    
    if (!areaMatch) {
      console.log(`⚠️ Item ${i} sem área definida`);
      continue;
    }
    
    const areas = areaMatch[1].split(",").map(a => a.trim());
    const affectedCapitals = new Set();
    
    console.log(`\n🔍 Processando item ${i}: ${titleMatch ? titleMatch[1] : 'Sem título'}`);
    console.log(`   Regiões: ${areas.length}`);
    
    for (const area of areas) {
      const capitals = INMET_TO_CAPITAL[area];
      if (capitals) {
        capitals.forEach(cap => {
          affectedCapitals.add(cap);
          console.log(`   ✅ ${area} → ${cap}`);
        });
      } else {
        console.log(`   ❌ Região não mapeada: "${area}"`);
      }
    }
    
    if (affectedCapitals.size === 0) {
      console.log(`   ⚠️ Nenhuma capital afetada por este alerta`);
      continue;
    }
    
    console.log(`   🎯 Capitais afetadas: ${Array.from(affectedCapitals).join(", ")}`);
    
    alerts.push({
      id: guidMatch ? guidMatch[1] : `alert_${i}`,
      evento: eventoMatch ? eventoMatch[1] : "Alerta",
      severidade: severidadeMatch ? severidadeMatch[1] : "Desconhecida",
      capitais: Array.from(affectedCapitals),
      title: titleMatch ? titleMatch[1] : "Sem título"
    });
  }
  
  return alerts;
}

async function testINMET() {
  console.log("🚀 Iniciando teste do INMET RSS...\n");
  
  try {
    const r = await fetch("https://apiprevmet3.inmet.gov.br/avisos/rss");
    
    if (!r.ok) {
      console.error(`❌ Erro HTTP: ${r.status}`);
      return;
    }
    
    const xml = await r.text();
    console.log(`✅ RSS baixado com sucesso (${xml.length} caracteres)`);
    
    const alerts = parseINMETRSS(xml);
    
    console.log(`\n\n📋 RESUMO FINAL:`);
    console.log(`═══════════════════════════════════════`);
    console.log(`Total de alertas processados: ${alerts.length}`);
    console.log(`\n`);
    
    if (alerts.length === 0) {
      console.log("⚠️ NENHUM alerta foi processado!");
      console.log("Possíveis causas:");
      console.log("1. Mapeamento de regiões incompleto");
      console.log("2. Formato do XML mudou");
      console.log("3. Nenhuma região dos alertas corresponde às capitais");
    } else {
      const capitalCount = {};
      
      for (const alert of alerts) {
        console.log(`\n🔴 ${alert.title}`);
        console.log(`   ID: ${alert.id}`);
        console.log(`   Evento: ${alert.evento}`);
        console.log(`   Severidade: ${alert.severidade}`);
        console.log(`   Capitais: ${alert.capitais.join(", ")}`);
        
        for (const cap of alert.capitais) {
          capitalCount[cap] = (capitalCount[cap] || 0) + 1;
        }
      }
      
      console.log(`\n\n📊 ALERTAS POR CAPITAL:`);
      console.log(`═══════════════════════════════════════`);
      
      const sorted = Object.entries(capitalCount).sort((a, b) => b[1] - a[1]);
      for (const [capital, count] of sorted) {
        console.log(`${capital}: ${count} alerta(s)`);
      }
    }
    
  } catch (e) {
    console.error("❌ Erro fatal:", e.message);
    console.error(e.stack);
  }
}

testINMET();
