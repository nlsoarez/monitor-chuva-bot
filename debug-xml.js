import fetch from "node-fetch";
import fs from "fs";

async function debugXML() {
  console.log("🔍 Baixando e analisando XML do INMET...\n");
  
  try {
    const r = await fetch("https://apiprevmet3.inmet.gov.br/avisos/rss");
    const xml = await r.text();
    
    console.log(`✅ XML baixado: ${xml.length} caracteres\n`);
    
    // Salvar XML completo
    fs.writeFileSync("inmet-debug.xml", xml);
    console.log("💾 XML salvo em: inmet-debug.xml\n");
    
    // Pegar apenas o primeiro item para análise
    const items = xml.split("<item>");
    
    if (items.length > 1) {
      const firstItem = items[1].split("</item>")[0];
      
      console.log("=" .repeat(80));
      console.log("📄 PRIMEIRO ITEM DO RSS (primeiros 2000 caracteres):");
      console.log("=".repeat(80));
      console.log(firstItem.substring(0, 2000));
      console.log("\n...\n");
      
      // Salvar primeiro item
      fs.writeFileSync("first-item.xml", firstItem);
      console.log("💾 Primeiro item salvo em: first-item.xml");
      
      // Tentar diferentes padrões de extração
      console.log("\n" + "=".repeat(80));
      console.log("🔎 TESTANDO DIFERENTES PADRÕES DE EXTRAÇÃO:");
      console.log("=".repeat(80));
      
      // Padrão 1: Com CDATA
      const pattern1 = /<description><!\[CDATA\[(.*?)\]\]><\/description>/s;
      const match1 = firstItem.match(pattern1);
      console.log("\n1. Padrão com CDATA: ", match1 ? "✅ MATCH" : "❌ NO MATCH");
      
      // Padrão 2: Sem CDATA
      const pattern2 = /<description>(.*?)<\/description>/s;
      const match2 = firstItem.match(pattern2);
      console.log("2. Padrão sem CDATA: ", match2 ? "✅ MATCH" : "❌ NO MATCH");
      
      // Se achou descrição, tentar extrair área
      if (match1 || match2) {
        const desc = match1 ? match1[1] : (match2 ? match2[1] : "");
        
        console.log("\n📋 Conteúdo da descrição (primeiros 1000 chars):");
        console.log("-".repeat(80));
        console.log(desc.substring(0, 1000));
        console.log("-".repeat(80));
        
        // Testar padrões de área
        const areaPattern1 = /<td>Área<\/td><td>Aviso para as Áreas: (.*?)<\/td>/;
        const areaPattern2 = /<th[^>]*>Área<\/th><td>(.*?)<\/td>/;
        const areaPattern3 = /Área.*?:(.*?)(?:<\/td>|<br|$)/i;
        
        console.log("\n🎯 TESTANDO PADRÕES DE ÁREA:");
        
        const areaMatch1 = desc.match(areaPattern1);
        console.log("1. Padrão td/td: ", areaMatch1 ? `✅ "${areaMatch1[1].substring(0, 100)}..."` : "❌ NO MATCH");
        
        const areaMatch2 = desc.match(areaPattern2);
        console.log("2. Padrão th/td: ", areaMatch2 ? `✅ "${areaMatch2[1].substring(0, 100)}..."` : "❌ NO MATCH");
        
        const areaMatch3 = desc.match(areaPattern3);
        console.log("3. Padrão genérico: ", areaMatch3 ? `✅ "${areaMatch3[1].substring(0, 100)}..."` : "❌ NO MATCH");
      }
      
    } else {
      console.log("❌ Não encontrou items no XML");
    }
    
    console.log("\n\n" + "=".repeat(80));
    console.log("✅ Análise completa! Verifique os arquivos:");
    console.log("   - inmet-debug.xml (XML completo)");
    console.log("   - first-item.xml (primeiro alerta)");
    console.log("=".repeat(80));
    
  } catch (e) {
    console.error("❌ Erro:", e.message);
  }
}

debugXML();
