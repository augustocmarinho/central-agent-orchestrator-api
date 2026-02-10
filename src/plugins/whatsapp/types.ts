import { WASocket } from '@whiskeysockets/baileys';

export interface WhatsAppSession {
  agentId: string;
  sessionId: string;
  socket: WASocket | null;
  qrCode: string | null;
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
  lastConnected?: Date;
  phoneNumber?: string;
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
  status: 'disconnected' | 'connecting' | 'qr_ready' | 'connected';
  phoneNumber?: string;
  lastConnected?: Date;
  needsQR: boolean;
}
