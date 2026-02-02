import { query } from '../db/postgres';
import { hashPassword, comparePassword } from '../auth/password';
import { generateToken } from '../auth/jwt';

export interface CreateUserData {
  name: string;
  email: string;
  password: string;
}

export interface LoginData {
  email: string;
  password: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: string;
}

export class AuthService {
  async createUser(data: CreateUserData): Promise<User> {
    const passwordHash = await hashPassword(data.password);
    
    const result = await query(
      `INSERT INTO users (name, email, password_hash) 
       VALUES ($1, $2, $3) 
       RETURNING id, name, email, avatar, role`,
      [data.name, data.email, passwordHash]
    );
    
    return result.rows[0];
  }
  
  async login(data: LoginData): Promise<{ user: User; token: string }> {
    const result = await query(
      'SELECT id, name, email, avatar, role, password_hash FROM users WHERE email = $1',
      [data.email]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Credenciais inválidas');
    }
    
    const user = result.rows[0];
    const isValidPassword = await comparePassword(data.password, user.password_hash);
    
    if (!isValidPassword) {
      throw new Error('Credenciais inválidas');
    }
    
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    
    const { password_hash, ...userWithoutPassword } = user;
    
    return {
      user: userWithoutPassword,
      token,
    };
  }
  
  async getUserById(userId: string): Promise<User | null> {
    const result = await query(
      'SELECT id, name, email, avatar, role FROM users WHERE id = $1',
      [userId]
    );
    
    return result.rows[0] || null;
  }
}

export const authService = new AuthService();
