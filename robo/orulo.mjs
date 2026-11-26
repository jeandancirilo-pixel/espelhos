// Robô dos Espelhos JEAN: entra nos portais de parceiros da Órulo, lê a Tabela Digital
// de cada empreendimento e grava docs/dados/espelho.json (o formato que o site lê).
// Usuário e senha vêm dos secrets ORULO_USUARIO e ORULO_SENHA.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DADOS = path.join(RAIZ, "docs", "dados");
const DEBUG = path.join(RAIZ, "debug");
fs.mkdirSync(DADOS, { recursive: true });
fs.mkdirSync(DEBUG, { recursive: true });

const USUARIO = process.env.ORULO_USUARIO, SENHA = process.env.ORULO_SENHA;
if (!USUARIO || !SENHA) { console.error("Faltam os secrets ORULO_USUARIO e ORULO_SENHA."); process.exit(1); }

const PORTAIS = JSON.parse(fs.readFileSync(path.join(RAIZ, "robo", "portais.json"), "utf8"));
const ler = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DADOS, f), "utf8")); } catch { return d; } };
const gravar = (f, o) => fs.writeFileSync(path.join(DADOS, f), JSON.stringify(o));

const ST = { "disponível": "disponivel", "disponivel": "disponivel", "reservada": "reservada", "vendida": "vendida", "venda suspensa": "suspensa", "em processo": "processo_final" };
const stCod = s => ST[String(s || "").trim().toLowerCase()] || String(s || "").trim().toLowerCase();
const MES = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
const ZONA = {
  sul: /jabaquara|ipiranga|sa[uú]de|vila mariana|moema|campo belo|santo amaro|brooklin|vila ol[ií]mpia|cursino|sacom[aã]|interlagos|socorro|chácara santo ant|morumbi|campo limpo|vila clementino|paraíso|aclimação/i,
  oeste: /perdizes|pinheiros|lapa|butant[aã]|pomp[eé]ia|vila romana|barra funda|alto de pinheiros|sumar[eé]|vila madalena|jaguar[eé]|rio pequeno|vila leopoldina|água branca/i,
  leste: /tatuap[eé]|carr[aã]o|mooca|penha|patriarca|vila formosa|an[aá]lia franco|bel[eé]m|br[aá]s|itaquera|guilhermina|esperan[cç]a|aricanduva|vila prudente|água rasa|vila matilde/i,
  norte: /santana|tucuruvi|vila guilherme|casa verde|freguesia do [oó]|limão|mandaqui|vila maria|parada inglesa/i,
  centro: /bela vista|consola[cç][aã]o|rep[uú]blica|liberdade|santa cec[ií]lia|vila buarque|bom retiro|cambuci|centro|s[eé]$|higien[oó]polis|jardins|jardim paulista|cerqueira c[eé]sar|vergueiro/i
};
const zonaDe = (bairro, cidade) => { if (cidade && !/s[aã]o paulo/i.test(cidade)) return "gsp"; for (const z in ZONA) if (ZONA[z].test(bairro || "")) return z; return null; };
const catDe = ref => /^HIS1/i.test(ref) ? "H1" : /^HIS2/i.test(ref) ? "H2" : /^HIS/i.test(ref) ? "H" : /^HMP/i.test(ref) ? "P" : /^R2V/i.test(ref) ? "R" : /^NR/i.test(ref) ? "N" : null;
const numDe = ref => String(ref).replace(/^(HIS[12]?|HMP|R2V|NR[12]?)/i, "") || String(ref);
const dormDe = u => /studio/i.test(u.type || "") ? "S" : /loja|sala|comercial/i.test(u.type || "") ? "L" : u.bedrooms ? String(Math.min(4, u.bedrooms)) : "";
const tipoTxt = u => { const d = dormDe(u); return d === "S" ? "Studio" : d === "L" ? (u.type || "Loja") : d ? d + (d === "1" ? " dorm" : " dorms") : (u.type || ""); };

const print = async (page, nome) => { try { await page.screenshot({ path: path.join(DEBUG, nome + ".png"), fullPage: true }); fs.writeFileSync(path.join(DEBUG, nome + ".txt"), page.url() + "\n\n" + (await page.evaluate(() => document.body.innerText)).slice(0, 5000)); } catch { } };

async function entrar(page, sub) {
  const base = `https://${sub}.portal.orulo.com.br`;
  await page.goto(base + "/login", { waitUntil: "networkidle" }).catch(() => { });
  await page.waitForTimeout(2000);
  console.log("  página de login:", page.url());
  await print(page, `${sub}-1-login`);
  const pw = page.locator('input[type="password"]');
  if (!(await pw.count())) {
    // alguns portais pedem o e-mail primeiro e só depois a senha
    const btnEntrar = page.locator('a:has-text("Entrar"), button:has-text("Entrar"), a:has-text("Login"), button:has-text("Login")').first();
    if (await btnEntrar.count()) { await btnEntrar.click().catch(() => { }); await page.waitForTimeout(2500); }
  }
  const usr = page.locator('input[type="email"], input[name*="email" i], input[name*="login" i], input[name*="user" i], input[type="text"]').first();
  if (!(await pw.count()) && (await usr.count())) {
    await usr.fill(USUARIO);
    const seguir = page.locator('button[type="submit"], button:has-text("Continuar"), button:has-text("Próximo"), button:has-text("Avançar")').first();
    if (await seguir.count()) await seguir.click(); else await usr.press("Enter");
    await page.waitForTimeout(2500);
  }
  await pw.first().waitFor({ timeout: 30000 });
  if (await usr.count() && !(await usr.inputValue().catch(() => ""))) await usr.fill(USUARIO);
  await pw.first().fill(SENHA);
  await print(page, `${sub}-2-preenchido`);
  const btn = page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Acessar")').first();
  if (await btn.count()) await btn.click(); else await pw.first().press("Enter");
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), null, { timeout: 45000 }).catch(() => { });
  await page.waitForTimeout(3000);
  console.log("  depois do login:", page.url());
  await print(page, `${sub}-3-depois-login`);
  if (await page.locator('input[type="password"]').count()) throw new Error("o login não passou (confira usuário e senha nos secrets)");
}

async function listar(page, sub) {
  await page.goto(`https://${sub}.portal.orulo.com.br/empreendimentos`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  console.log("  lista:", page.url());
  await print(page, `${sub}-4-lista`);
  return await page.$$eval('a[href*="/empreendimentos/"]', as => {
    const m = {};
    for (const a of as) {
      const id = (a.getAttribute("href").match(/\/empreendimentos\/(\d+)\/?$/) || [])[1];
      const t = a.textContent.replace(/\s+/g, " ").trim();
      if (id && t && (!m[id] || t.length < m[id].length) && !/^Empreendimento - /.test(t)) m[id] = t;
      else if (id && !m[id]) m[id] = t.replace(/^Empreendimento - /, "");
    }
    return Object.entries(m).map(([id, nome]) => ({ id, nome }));
  });
}

async function detalhes(page, sub, id) {
  await page.goto(`https://${sub}.portal.orulo.com.br/empreendimentos/${id}`, { waitUntil: "networkidle" });
  return await page.evaluate(() => {
    const txt = (document.querySelector("main") || document.body).innerText;
    const linhas = txt.split("\n").map(s => s.trim()).filter(Boolean);
    const end = linhas.find(l => / - .+, [A-Z]{2}$/.test(l)) || "";
    const ent = (txt.match(/Entrega:\s*([A-Za-zç]{3})\/(\d{2,4})/) || []);
    const iD = linhas.indexOf("Descrição");
    const img = document.querySelector('img[alt*="capa" i]') || document.querySelector('meta[property="og:image"]');
    return {
      end, entMes: ent[1] || null, entAno: ent[2] || null,
      fase: /BREVE LAN/i.test(txt) ? "breve" : /EM CONSTRU/i.test(txt) ? "obras" : /PRONTO/i.test(txt) ? "pronto" : /LAN[CÇ]AMENTO/i.test(txt) ? "lanc" : null,
      desc: iD >= 0 ? (linhas[iD + 1] || "").replace(/Preço e disponibilidade.*$/i, "").trim() : "",
      capa: img ? (img.currentSrc || img.src || img.content || "") : ""
    };
  });
}

async function unidades(page, sub, id) {
  const url = `https://${sub}.portal.orulo.com.br/empreendimentos/${id}/unidades?status[]=available&status[]=reserved&status[]=sold`;
  const espera = page.waitForResponse(r => r.url().includes(`/api/buildings/${id}/units`) && r.status() === 200, { timeout: 45000 });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  let ultimo = await espera;
  // a página pode pedir mais de uma vez (o filtro da URL chega depois); fica com a resposta mais completa
  const extra = [];
  const ouvir = r => { if (r.url().includes(`/api/buildings/${id}/units`) && r.status() === 200) extra.push(r); };
  page.on("response", ouvir);
  await page.waitForTimeout(4000);
  page.off("response", ouvir);
  let melhor = (await ultimo.json()).units || [];
  for (const r of extra) { try { const u = (await r.json()).units || []; if (u.length > melhor.length) melhor = u; } catch { } }
  return melhor;
}

function montar(sub, construtora, b, det, us) {
  const pid = `orulo-${sub}-${b.id}`;
  const cont = { disponivel: 0, reservada: 0, processo_final: 0, vendida: 0 };
  for (const u of us) { const s = stCod(u.status); if (s in cont) cont[s]++; }
  const livres = us.filter(u => stCod(u.status) === "disponivel" && u.price);
  const barata = livres.slice().sort((a, b2) => a.price - b2.price)[0];
  const areas = livres.map(u => u.private_area).filter(Boolean);
  const dorm = [...new Set(livres.map(dormDe).filter(Boolean))].sort((a, b2) => "S1234L".indexOf(a) - "S1234L".indexOf(b2)).join("");
  const cats = [...new Set(us.map(u => catDe(u.reference)).filter(Boolean))].join(",");
  const partes = det.end.split(" - ");
  const bairro = partes.length >= 3 ? partes[partes.length - 2] : (partes[1] || "");
  const cidade = partes.length >= 2 ? partes[partes.length - 1].replace(/,\s*[A-Z]{2}$/, "") : "São Paulo";
  let ent = null;
  if (det.entMes && MES[det.entMes.toLowerCase()]) { let a = +det.entAno; if (a < 100) a += 2000; ent = a + "-" + String(MES[det.entMes.toLowerCase()]).padStart(2, "0"); }
  const fase = /breve/i.test(b.nome) ? "breve" : det.fase || "obras";
  const p = [];
  p[0] = pid; p[1] = b.nome.replace(/\s*-\s*(Residencial)$/i, ""); p[2] = sub; p[3] = construtora; p[4] = bairro; p[5] = zonaDe(bairro, cidade);
  p[6] = fase; p[7] = ent; p[8] = cont.disponivel; p[9] = cont.reservada; p[10] = cont.processo_final; p[11] = cont.vendida; p[12] = us.length;
  p[13] = barata ? Math.round(barata.price) : null; p[14] = null; p[15] = dorm;
  p[16] = areas.length ? Math.min(...areas) : null; p[17] = areas.length ? Math.max(...areas) : null;
  p[18] = det.capa || null; p[19] = det.desc || null; p[20] = "Tabela Digital " + construtora + " (Órulo)"; p[21] = null; p[22] = null;
  p[23] = null; p[24] = null; p[25] = null; p[26] = new Date().toISOString(); p[27] = partes[0] || null; p[28] = cidade;
  p[29] = null; p[30] = barata && barata.private_area ? Math.round(barata.price / barata.private_area) : null; p[31] = cats || null; p[32] = null; p[33] = null;
  return p;
}

async function main() {
  const antes = ler("unidades.json", {});            // { pid: { ref: [status, preco, area, tipo] } }
  const movs = ler("movimentos.json", []);           // [projeto, n, de, para, em(seg), preco, area, tipologia, agora]
  const anterior = ler("espelho.json", { p: [] });
  const agora = Math.floor(Date.now() / 1000);
  const novo = {}, projetos = [], fontes = {}, erros = [];
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  for (const portal of PORTAIS) {
    const { sub, construtora } = portal;
    try {
      await entrar(page, sub);
      const lista = await listar(page, sub);
      console.log(`${construtora}: ${lista.length} empreendimentos`);
      for (const b of lista) {
        try {
          const det = await detalhes(page, sub, b.id);
          const us = await unidades(page, sub, b.id);
          const p = montar(sub, construtora, b, det, us);
          projetos.push(p);
          const pid = p[0], velho = antes[pid] || null, mapa = {};
          for (const u of us) {
            const s = stCod(u.status), pr = u.price ? Math.round(u.price) : null;
            mapa[u.reference] = [s, pr, u.private_area || null, tipoTxt(u)];
            const v = velho && velho[u.reference];
            if (velho && (!v || v[0] !== s)) movs.unshift([pid, numDe(u.reference), v ? v[0] : "novo", s, agora, pr || (v && v[1]) || null, u.private_area || null, tipoTxt(u), s]);
          }
          novo[pid] = mapa;
          console.log(`  ${p[1]}: ${us.length} unidades, ${p[8]} livres`);
        } catch (e) {
          erros.push(`${construtora} ${b.nome}: ${e.message}`);
          if (antes[`orulo-${sub}-${b.id}`]) novo[`orulo-${sub}-${b.id}`] = antes[`orulo-${sub}-${b.id}`];
          const velhoP = anterior.p.find(x => x[0] === `orulo-${sub}-${b.id}`); if (velhoP) projetos.push(velhoP);
        }
      }
      fontes[sub] = new Date().toISOString();
    } catch (e) {
      erros.push(`${construtora}: ${e.message}`);
      await page.screenshot({ path: path.join(DEBUG, `erro-${sub}.png`), fullPage: true }).catch(() => { });
      for (const p of anterior.p.filter(x => x[2] === sub)) { projetos.push(p); if (antes[p[0]]) novo[p[0]] = antes[p[0]]; }
    }
  }
  await browser.close();
  const limite = agora - 45 * 86400;
  const m = movs.filter(x => x[4] >= limite).slice(0, 6000);
  gravar("unidades.json", novo);
  gravar("movimentos.json", m);
  gravar("espelho.json", { v: 1, em: Date.now(), fontes, erros, p: projetos, m });
  console.log(`Total: ${projetos.length} projetos, ${m.length} movimentações guardadas.`);
  if (erros.length) { console.log("Erros:\n" + erros.join("\n")); if (!projetos.length) process.exit(1); }
}
main().catch(e => { console.error(e); process.exit(1); });
