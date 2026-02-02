import { Pool } from 'pg';
import { config } from '../config';
import { logError, logDebug } from '../utils/logger';

export const pool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  user: config.postgres.user,
  password: config.postgres.password,
  database: config.postgres.database,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err: Error) => {
  logError('Unexpected error on PostgreSQL pool', err);
  process.exit(-1);
});

pool.on('connect', () => {
  logDebug('New PostgreSQL client connected');
});

export const query = (text: string, params?: any[]) => {
  logDebug('Executing PostgreSQL query', { query: text.substring(0, 100) });
  return pool.query(text, params);
};

export const getClient = () => pool.connect();
