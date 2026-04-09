import { WASocket } from '@whiskeysockets/baileys';

export type WhatsAppSessionStatus =
  | 'disconnected'
  | 'connecting'
  | 'qr_ready'
  | 'connected'
  | 'reconnecting';

export interface WhatsAppSession {
  agentId: string;
  sessionId: string;
  socket: WASocket | null;
  qrCode: string | null;
  status: WhatsAppSessionStatus;
  lastConnected?: Date;
  phoneNumber?: string;
  /** Tentativas de reconexão após um close; zerado quando connection === 'open'. */
  reconnectAttempts?: number;
  /** Timeout id da reconexão agendada; usado para cancelar e evitar múltiplas reconexões. */
  reconnectTimeoutId?: ReturnType<typeof setTimeout> | null;
  /** Motivo da desconexão (ex.: loggedOut, connectionReplaced). Exibido ao usuário no frontend. */
  disconnectReason?: string;
}

export interface WhatsAppMessage {
  from: string;
  to: string;
  message: string;
  timestamp: Date;
  messageId?: string;
}

export interface QRCodeResponse {
  qrCode: string;
  status: string;
  expiresIn: number;
}

export interface ConnectionStatus {
  agentId: string;
  sessionId: string;
  status: WhatsAppSessionStatus;
  phoneNumber?: string;
  lastConnected?: Date;
  needsQR: boolean;
  /** Motivo da última desconexão (ex.: loggedOut, connectionReplaced). */
  disconnectReason?: string;
}
