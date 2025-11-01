import fs from "fs";

console.log("🔧 Corrigindo o parser do bot.js...\n");

// Ler o bot.js atual
let botCode = fs.readFileSync("bot.js", "utf-8");

// Padrão antigo (ERRADO)
const oldPattern = `const eventoMatch = desc.match(/<td>Evento<\\/td><td>(.*?)<\\/td>/);
    const severidadeMatch = desc.match(/<td>Severidade<\\/td><td>(.*?)<\\/td>/);
    const inicioMatch = desc.match(/<td>Início<\\/td><td>(.*?)<\\/td>/);
    const fimMatch = desc.match(/<td>Fim<\\/td><td>(.*?)<\\/td>/);
    const descricaoMatch = desc.match(/<td>Descrição<\\/td><td>(.*?)<\\/td>/);
    const areaMatch = desc.match(/<td>Área<\\/td><td>Aviso para as Áreas: (.*?)<\\/td>/);`;

// Padrão novo (CORRETO)
const newPattern = `const eventoMatch = desc.match(/<th[^>]*>Evento<\\/th><td>(.*?)<\\/td>/);
    const severidadeMatch = desc.match(/<th[^>]*>Severidade<\\/th><td>(.*?)<\\/td>/);
    const inicioMatch = desc.match(/<th[^>]*>Início<\\/th><td>(.*?)<\\/td>/);
    const fimMatch = desc.match(/<th[^>]*>Fim<\\/th><td>(.*?)<\\/td>/);
    const descricaoMatch = desc.match(/<th[^>]*>Descrição<\\/th><td>(.*?)<\\/td>/);
    const areaMatch = desc.match(/<th[^>]*>Área<\\/th><td>(.*?)<\\/td>/);`;

// Substituir
if (botCode.includes("<td>Evento</td>")) {
  console.log("✅ Padrão antigo encontrado, corrigindo...");
  botCode = botCode.replace(oldPattern, newPattern);
  
  // Corrigir também o parsing de áreas
  const oldAreaParsing = `const areas = areaMatch[1].split(",").map(a => a.trim());`;
  const newAreaParsing = `// Remove "Aviso para as Áreas: " se existir
    let areasText = areaMatch[1];
    if (areasText.includes("Aviso para as Áreas:")) {
      areasText = areasText.replace("Aviso para as Áreas:", "").trim();
    }
    const areas = areasText.split(",").map(a => a.trim());`;
  
  botCode = botCode.replace(oldAreaParsing, newAreaParsing);
  
  // Salvar
  fs.writeFileSync("bot.js", botCode);
  console.log("✅ bot.js corrigido com sucesso!\n");
  console.log("Agora rode: node bot.js\n");
} else if (botCode.includes("<th[^>]*>Evento</th>")) {
  console.log("✅ O bot.js já está com o padrão correto!");
  console.log("Testando se funciona...\n");
  
  // Testar se funciona
  import("./bot.js");
} else {
  console.log("❌ Não encontrei o padrão esperado no bot.js");
  console.log("O arquivo pode estar corrompido.");
}
