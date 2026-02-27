/**
 * Utilitários para normalização de JIDs WhatsApp.
 * Resolve o problema de duplicação de chats quando o mesmo contato aparece
 * como @lid (Link ID) ou @s.whatsapp.net (Phone Number).
 *
 * Refs:
 * - https://baileys.wiki/docs/migration/to-v7.0.0/
 * - https://help.replyagent.com/en-US/kb/article/38/understanding-lid-on-whatsapp
 */

/** Sufixos conhecidos de JID WhatsApp */
const JID_SUFFIXES = ['@s.whatsapp.net', '@lid', '@g.us', '@newsletter'] as const;

/**
 * Extrai a parte "user" de um JID (antes do @).
 * Ex: "183163376656627@lid" → "183163376656627"
 *     "557791744200@s.whatsapp.net" → "557791744200"
 */
export function extractJidUser(jid: string): string {
  if (!jid || typeof jid !== 'string') return '';
  return jid.split('@')[0].trim();
}

/**
 * Verifica se o JID usa o formato LID (Link ID).
 */
export function isLidJid(jid: string): boolean {
  return typeof jid === 'string' && jid.endsWith('@lid');
}

/**
 * Verifica se o JID usa o formato PN (Phone Number).
 */
export function isPnJid(jid: string): boolean {
  return typeof jid === 'string' && jid.endsWith('@s.whatsapp.net');
}

/**
 * Normaliza um número de telefone para consistência em buscas.
 * Remove caracteres não numéricos e retorna apenas dígitos.
 * Ex: "55 (18) 31633-76656" → "55183163376656"
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  return phone.replace(/\D/g, '');
}

/**
 * Extrai o número de telefone normalizado de um JID.
 * Para @lid: retorna a parte user (pode ser o número em alguns casos).
 * Para @s.whatsapp.net: retorna a parte user (número).
 * Remove device suffix (:0, :1, etc.) se presente.
 */
export function extractNormalizedPhoneFromJid(jid: string): string {
  const user = extractJidUser(jid);
  // Remover sufixo de device (ex: 557791744200:0 → 557791744200)
  const withoutDevice = user.split(':')[0];
  return normalizePhoneNumber(withoutDevice);
}

/**
 * Verifica se dois JIDs representam o mesmo contato.
 * Compara os números normalizados (ignorando formato @lid vs @s.whatsapp.net).
 */
export function isSameContact(jid1: string, jid2: string): boolean {
  const p1 = extractNormalizedPhoneFromJid(jid1);
  const p2 = extractNormalizedPhoneFromJid(jid2);
  if (!p1 || !p2) return jid1 === jid2;
  return p1 === p2;
}
