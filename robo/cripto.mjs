// Criptografia dos dados publicados. A cada rodada o robô sorteia uma chave nova,
// cifra o espelho com ela (AES-GCM) e guarda uma cópia dessa chave "trancada" por serial
// (PBKDF2 + AES-GCM). Quem tem um serial válido destranca a chave e lê os dados no navegador.
// Serial removido do secret SERIAIS deixa de abrir a partir da rodada seguinte.
import { webcrypto as C } from "node:crypto";

const ITER = 210000;
const enc = new TextEncoder();
const b64 = b => Buffer.from(b).toString("base64");

export function lerSeriais(txt) {
  return String(txt || "").split(/[\n,;]+/).map(l => l.trim()).filter(l => l && !l.startsWith("#"))
    .map(l => { const m = l.match(/^(.*?)\s*[:=]\s*(\S+)$/); return (m ? m[2] : l).trim(); })
    .filter(s => s.length >= 6);
}

export async function idDoSerial(serial) {
  const h = new Uint8Array(await C.subtle.digest("SHA-256", enc.encode("espelhos-jean:" + serial.trim().toUpperCase())));
  return Buffer.from(h.slice(0, 8)).toString("hex");
}

async function chaveDoSerial(serial, salt) {
  const base = await C.subtle.importKey("raw", enc.encode(serial.trim().toUpperCase()), "PBKDF2", false, ["deriveKey"]);
  return C.subtle.deriveKey({ name: "PBKDF2", salt, iterations: ITER, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
}

export async function cifrar(obj, seriais) {
  const k = C.getRandomValues(new Uint8Array(32));
  const chave = await C.subtle.importKey("raw", k, "AES-GCM", false, ["encrypt"]);
  const iv = C.getRandomValues(new Uint8Array(12));
  const ct = await C.subtle.encrypt({ name: "AES-GCM", iv }, chave, enc.encode(JSON.stringify(obj)));
  const acessos = [];
  for (const s of seriais) {
    const salt = C.getRandomValues(new Uint8Array(16)), iv2 = C.getRandomValues(new Uint8Array(12));
    const w = await C.subtle.encrypt({ name: "AES-GCM", iv: iv2 }, await chaveDoSerial(s, salt), k);
    acessos.push({ id: await idDoSerial(s), s: b64(salt), iv: b64(iv2), w: b64(w) });
  }
  return { v: 2, it: ITER, em: Date.now(), iv: b64(iv), ct: b64(ct), acessos };
}
