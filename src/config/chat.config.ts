/**
 * Configuração do cache de histórico de chat (Redis).
 *
 * Estratégia summary buffer:
 * - Mantém as últimas RECENT_WINDOW mensagens verbatim no Redis.
 * - Quando o total de mensagens ultrapassa SUMMARY_TRIGGER, as mais antigas
 *   são compactadas em um resumo (chamada LLM) e descartadas do array.
 * - O resumo é mantido como string única e cresce devagar a cada compactação.
 */
export const chatHistoryConfig = {
  // Janela recente verbatim enviada à OpenAI a cada turno.
  recentWindow: parseInt(process.env.CHAT_HISTORY_RECENT_WINDOW || '15', 10),

  // Quando messages.length > summaryTrigger, dispara sumarização das mais antigas.
  summaryTrigger: parseInt(process.env.CHAT_HISTORY_SUMMARY_TRIGGER || '30', 10),

  // TTL do Redis em segundos (7 dias). Mantido igual ao TTL antigo do n8n para compatibilidade.
  ttlSeconds: parseInt(process.env.CHAT_HISTORY_TTL_SECONDS || '604800', 10),

  // Hard cap defensivo: se messages.length passar disso (sem sumarizar), trunca pelas mais antigas.
  // Protege contra falhas na sumarização que poderiam fazer o array crescer indefinidamente.
  hardCap: parseInt(process.env.CHAT_HISTORY_HARD_CAP || '100', 10),
};
