import { query } from '../db/postgres';
import { AiModel } from '../types/billing.types';
import { logInfo, logError } from '../utils/logger';

/**
 * Service para gerenciamento de modelos de IA
 */
export class AiModelService {

  async listModels(activeOnly: boolean = false): Promise<AiModel[]> {
    const sql = activeOnly
      ? `SELECT * FROM ai_models WHERE is_active = true ORDER BY credit_multiplier ASC`
      : `SELECT * FROM ai_models ORDER BY credit_multiplier ASC`;
    const result = await query(sql);
    return result.rows.map(this.mapRow);
  }

  async getModelById(id: string): Promise<AiModel | null> {
    const result = await query(`SELECT * FROM ai_models WHERE id = $1`, [id]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async getModelByName(name: string): Promise<AiModel | null> {
    const result = await query(`SELECT * FROM ai_models WHERE name = $1`, [name]);
    return result.rows.length > 0 ? this.mapRow(result.rows[0]) : null;
  }

  async createModel(data: {
    name: string;
    provider: string;
    displayName: string;
    creditMultiplier: number;
    description?: string;
  }): Promise<AiModel> {
    const result = await query(
      `INSERT INTO ai_models (name, provider, display_name, credit_multiplier, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [data.name, data.provider, data.displayName, data.creditMultiplier, data.description || null]
    );
    logInfo('AI model created', { name: data.name });
    return this.mapRow(result.rows[0]);
  }

  async updateModel(id: string, data: Partial<{
    name: string;
    provider: string;
    displayName: string;
    creditMultiplier: number;
    isActive: boolean;
    description: string;
  }>): Promise<AiModel | null> {
    const sets: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); values.push(data.name); }
    if (data.provider !== undefined) { sets.push(`provider = $${idx++}`); values.push(data.provider); }
    if (data.displayName !== undefined) { sets.push(`display_name = $${idx++}`); values.push(data.displayName); }
    if (data.creditMultiplier !== undefined) { sets.push(`credit_multiplier = $${idx++}`); values.push(data.creditMultiplier); }
    if (data.isActive !== undefined) { sets.push(`is_active = $${idx++}`); values.push(data.isActive); }
    if (data.description !== undefined) { sets.push(`description = $${idx++}`); values.push(data.description); }

    if (sets.length === 0) return this.getModelById(id);

    sets.push(`updated_at = NOW()`);
    values.push(id);

    const result = await query(
      `UPDATE ai_models SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values
    );

    if (result.rows.length === 0) return null;
    logInfo('AI model updated', { id });
    return this.mapRow(result.rows[0]);
  }

  async deleteModel(id: string): Promise<boolean> {
    const result = await query(
      `UPDATE ai_models SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private mapRow(row: any): AiModel {
    return {
      id: row.id,
      name: row.name,
      provider: row.provider,
      displayName: row.display_name,
      creditMultiplier: parseFloat(row.credit_multiplier),
      isActive: row.is_active,
      description: row.description || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const aiModelService = new AiModelService();
