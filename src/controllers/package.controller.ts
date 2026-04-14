import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { query } from '../db/postgres';
import { logError } from '../utils/logger';
import { z, ZodError } from 'zod';

const createPackageSchema = z.object({
  name: z.string().min(1).max(255),
  credits: z.number().int().min(1),
  validityDays: z.number().int().min(1).max(365).default(30),
  priceBrl: z.number().min(0).default(0),
});

const updatePackageSchema = createPackageSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export class PackageController {
  /** GET /api/admin/packages */
  async list(req: AuthRequest, res: Response) {
    try {
      const result = await query(`SELECT * FROM additional_packages ORDER BY credits ASC`);
      return res.json({ success: true, data: { packages: result.rows } });
    } catch (error: any) {
      logError('Error listing packages', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar pacotes' });
    }
  }

  /** POST /api/admin/packages */
  async create(req: AuthRequest, res: Response) {
    try {
      const validated = createPackageSchema.parse(req.body);
      const result = await query(
        `INSERT INTO additional_packages (name, credits, validity_days, price_brl) VALUES ($1, $2, $3, $4) RETURNING *`,
        [validated.name, validated.credits, validated.validityDays, validated.priceBrl]
      );
      return res.status(201).json({ success: true, data: { package: result.rows[0] } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error creating package', error);
      return res.status(500).json({ success: false, error: 'Erro ao criar pacote' });
    }
  }

  /** PUT /api/admin/packages/:id */
  async update(req: AuthRequest, res: Response) {
    try {
      const validated = updatePackageSchema.parse(req.body);
      const sets: string[] = [];
      const values: any[] = [];
      let idx = 1;

      if (validated.name !== undefined) { sets.push(`name = $${idx++}`); values.push(validated.name); }
      if (validated.credits !== undefined) { sets.push(`credits = $${idx++}`); values.push(validated.credits); }
      if (validated.validityDays !== undefined) { sets.push(`validity_days = $${idx++}`); values.push(validated.validityDays); }
      if (validated.priceBrl !== undefined) { sets.push(`price_brl = $${idx++}`); values.push(validated.priceBrl); }
      if (validated.isActive !== undefined) { sets.push(`is_active = $${idx++}`); values.push(validated.isActive); }

      if (sets.length === 0) {
        return res.status(400).json({ success: false, error: 'Nenhum campo para atualizar' });
      }

      sets.push(`updated_at = NOW()`);
      values.push(req.params.id);

      const result = await query(
        `UPDATE additional_packages SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Pacote não encontrado' });
      }

      return res.json({ success: true, data: { package: result.rows[0] } });
    } catch (error: any) {
      if (error instanceof ZodError) {
        return res.status(400).json({ success: false, error: 'Dados inválidos', details: error.errors });
      }
      logError('Error updating package', error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar pacote' });
    }
  }

  /** DELETE /api/admin/packages/:id */
  async delete(req: AuthRequest, res: Response) {
    try {
      const result = await query(
        `UPDATE additional_packages SET is_active = false, updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      if ((result.rowCount ?? 0) === 0) {
        return res.status(404).json({ success: false, error: 'Pacote não encontrado' });
      }
      return res.json({ success: true, message: 'Pacote desativado' });
    } catch (error: any) {
      logError('Error deleting package', error);
      return res.status(500).json({ success: false, error: 'Erro ao desativar pacote' });
    }
  }
}

export const packageController = new PackageController();
