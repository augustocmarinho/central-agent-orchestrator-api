import { query } from '../db/postgres';
import crypto from 'crypto';
import { logInfo, logWarn } from '../utils/logger';

export interface SystemToken {
  id: string;
  name: string;
  token: string;
  description?: string;
  allowed_ips?: string[];
  is_active: boolean;
  expires_at?: Date;
  last_used_at?: Date;
  last_used_ip?: string;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSystemTokenData {
  name: string;
  description?: string;
  allowed_ips?: string[];
  expires_at?: Date;
  created_by: string;
}

export interface SystemTokenLog {
  system_token_id: string;
  ip_address: string;
  path: string;
  method: string;
  status_code?: number;
  success: boolean;
  error_message?: string;
}

export class SystemTokenService {
  /**
   * Gera um token seguro e único
   */
  private generateSecureToken(): string {
    // Formato: sat_ (system api token) + 64 caracteres hex
    return 'sat_' + crypto.randomBytes(32).toString('hex');
  }

  /**
   * Cria um novo token de sistema
   */
  async createToken(data: CreateSystemTokenData): Promise<SystemToken> {
    const token = this.generateSecureToken();
    
    const result = await query(
      `INSERT INTO system_tokens (name, token, description, allowed_ips, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, token, description, allowed_ips, is_active, expires_at, 
                 last_used_at, last_used_ip, created_by, created_at, updated_at`,
      [
        data.name,
        token,
        data.description || null,
        data.allowed_ips || null,
        data.expires_at || null,
        data.created_by
      ]
    );

    logInfo('System token created', {
      tokenId: result.rows[0].id,
      name: data.name,
      createdBy: data.created_by
    });

    return result.rows[0];
  }

  /**
   * Valida um token e retorna suas informações
   */
  async validateToken(token: string, requestIp: string): Promise<SystemToken | null> {
    const result = await query(
      `SELECT id, name, token, description, allowed_ips, is_active, expires_at,
              last_used_at, last_used_ip, created_by, created_at, updated_at
       FROM system_tokens
       WHERE token = $1 AND is_active = true`,
      [token]
    );

    if (result.rows.length === 0) {
      logWarn(requestIp)
      logWarn(token)
      logWarn('Invalid system token attempt', { ip: requestIp });
      return null;
    }

    const systemToken: SystemToken = result.rows[0];

    // Verificar expiração
    if (systemToken.expires_at && new Date(systemToken.expires_at) < new Date()) {
      logWarn('Expired system token attempt', {
        tokenId: systemToken.id,
        name: systemToken.name,
        ip: requestIp
      });
      return null;
    }

    // Verificar IP permitido
    if (systemToken.allowed_ips && systemToken.allowed_ips.length > 0) {
      const isIpAllowed = this.checkIpAllowed(requestIp, systemToken.allowed_ips);
      if (!isIpAllowed) {
        logWarn('System token used from unauthorized IP', {
          tokenId: systemToken.id,
          name: systemToken.name,
          ip: requestIp,
          allowedIps: systemToken.allowed_ips
        });
        logWarn(requestIp)
        return null;
      }
    }

    // Atualizar último uso
    await this.updateLastUsed(systemToken.id, requestIp);

    return systemToken;
  }

  /**
   * Verifica se o IP está na lista de IPs permitidos
   * Suporta IPs individuais e CIDRs
   */
  private checkIpAllowed(ip: string, allowedIps: string[]): boolean {
    // Normalizar IP (remover ::ffff: prefix se IPv4 mapeado)
    const normalizedIp = ip.replace(/^::ffff:/, '');

    for (const allowedIp of allowedIps) {
      // IP exato
      if (allowedIp === normalizedIp) {
        return true;
      }

      // CIDR notation
      if (allowedIp.includes('/')) {
        if (this.ipInCidr(normalizedIp, allowedIp)) {
          return true;
        }
      }

      // Wildcard (ex: 192.168.1.*)
      if (allowedIp.includes('*')) {
        const pattern = allowedIp.replace(/\./g, '\\.').replace(/\*/g, '.*');
        const regex = new RegExp(`^${pattern}$`);
        if (regex.test(normalizedIp)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Verifica se um IP está dentro de um CIDR
   * Implementação simplificada para IPv4
   */
  private ipInCidr(ip: string, cidr: string): boolean {
    const [cidrIp, bits] = cidr.split('/');
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);
    
    const ipNum = this.ipToNumber(ip);
    const cidrIpNum = this.ipToNumber(cidrIp);
    
    return (ipNum & mask) === (cidrIpNum & mask);
  }

  /**
   * Converte IP string para número
   */
  private ipToNumber(ip: string): number {
    return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
  }

  /**
   * Atualiza informações de último uso do token
   */
  private async updateLastUsed(tokenId: string, ip: string): Promise<void> {
    await query(
      `UPDATE system_tokens
       SET last_used_at = NOW(), last_used_ip = $1, updated_at = NOW()
       WHERE id = $2`,
      [ip, tokenId]
    );
  }

  /**
   * Registra uso do token (log)
   */
  async logTokenUsage(log: SystemTokenLog): Promise<void> {
    try {
      await query(
        `INSERT INTO system_token_logs 
         (system_token_id, ip_address, path, method, status_code, success, error_message)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          log.system_token_id,
          log.ip_address,
          log.path,
          log.method,
          log.status_code || null,
          log.success,
          log.error_message || null
        ]
      );
    } catch (error) {
      // Log mas não falhe a requisição por causa de erro de logging
      logWarn('Failed to log system token usage', { error });
    }
  }

  /**
   * Lista todos os tokens de sistema
   */
  async listTokens(): Promise<Omit<SystemToken, 'token'>[]> {
    const result = await query(
      `SELECT id, name, description, allowed_ips, is_active, expires_at,
              last_used_at, last_used_ip, created_by, created_at, updated_at
       FROM system_tokens
       ORDER BY created_at DESC`
    );

    return result.rows;
  }

  /**
   * Busca um token específico pelo ID
   */
  async getTokenById(tokenId: string): Promise<Omit<SystemToken, 'token'> | null> {
    const result = await query(
      `SELECT id, name, description, allowed_ips, is_active, expires_at,
              last_used_at, last_used_ip, created_by, created_at, updated_at
       FROM system_tokens
       WHERE id = $1`,
      [tokenId]
    );

    return result.rows[0] || null;
  }

  /**
   * Revoga (desativa) um token
   */
  async revokeToken(tokenId: string): Promise<void> {
    await query(
      `UPDATE system_tokens
       SET is_active = false, updated_at = NOW()
       WHERE id = $1`,
      [tokenId]
    );

    logInfo('System token revoked', { tokenId });
  }

  /**
   * Atualiza IPs permitidos de um token
   */
  async updateAllowedIps(tokenId: string, allowedIps: string[]): Promise<void> {
    await query(
      `UPDATE system_tokens
       SET allowed_ips = $1, updated_at = NOW()
       WHERE id = $2`,
      [allowedIps, tokenId]
    );

    logInfo('System token IPs updated', { tokenId, allowedIps });
  }

  /**
   * Obtém logs de uso de um token
   */
  async getTokenLogs(tokenId: string, limit: number = 100): Promise<any[]> {
    const result = await query(
      `SELECT id, ip_address, path, method, status_code, success, error_message, created_at
       FROM system_token_logs
       WHERE system_token_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [tokenId, limit]
    );

    return result.rows;
  }
}

export const systemTokenService = new SystemTokenService();
