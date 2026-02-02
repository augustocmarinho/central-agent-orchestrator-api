# 🔌 Guia de Integração Frontend ↔ Backend

Este guia mostra como integrar o frontend React com o backend Node.js.

## Base URL

Configure a base URL da API no frontend:

```typescript
// frontend/src/config/api.ts
export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
export const WS_BASE_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:3000';
```

## Autenticação

### 1. Login

```typescript
// frontend/src/services/auth.service.ts
import axios from 'axios';
import { API_BASE_URL } from '../config/api';

interface LoginResponse {
  success: boolean;
  data: {
    user: {
      id: string;
      name: string;
      email: string;
      role: string;
    };
    token: string;
  };
}

export const login = async (email: string, password: string): Promise<LoginResponse> => {
  const response = await axios.post(`${API_BASE_URL}/auth/login`, {
    email,
    password,
  });
  
  return response.data;
};
```

### 2. Armazenar Token

```typescript
// frontend/src/contexts/AuthContext.tsx
const login = async (email: string, password: string): Promise<boolean> => {
  try {
    const response = await authService.login(email, password);
    
    // Salvar no localStorage
    localStorage.setItem('token', response.data.token);
    localStorage.setItem('user', JSON.stringify(response.data.user));
    
    setUser(response.data.user);
    return true;
  } catch (error) {
    return false;
  }
};
```

### 3. Axios Interceptor

```typescript
// frontend/src/lib/axios.ts
import axios from 'axios';
import { API_BASE_URL } from '../config/api';

const api = axios.create({
  baseURL: API_BASE_URL,
});

// Interceptor para adicionar token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  
  return config;
});

// Interceptor para tratar erros de autenticação
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token inválido/expirado
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export default api;
```

## Agentes

### Service de Agentes

```typescript
// frontend/src/services/agent.service.ts
import api from '../lib/axios';

export interface CreateAgentData {
  name: string;
  creationMode: 'simple' | 'advanced';
  objective?: string;
  persona?: string;
  audience?: string;
  topics?: string;
  restrictions?: string;
  knowledgeSource?: string;
  finalPrompt?: string;
}

export const agentService = {
  async create(data: CreateAgentData) {
    const response = await api.post('/agents', data);
    return response.data;
  },

  async list() {
    const response = await api.get('/agents');
    return response.data;
  },

  async getOne(id: string) {
    const response = await api.get(`/agents/${id}`);
    return response.data;
  },

  async update(id: string, data: Partial<CreateAgentData>) {
    const response = await api.put(`/agents/${id}`, data);
    return response.data;
  },

  async delete(id: string) {
    const response = await api.delete(`/agents/${id}`);
    return response.data;
  },
};
```

### Usando React Query

```typescript
// frontend/src/hooks/useAgents.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { agentService } from '../services/agent.service';
import { toast } from 'sonner';

export const useAgents = () => {
  return useQuery({
    queryKey: ['agents'],
    queryFn: () => agentService.list(),
  });
};

export const useCreateAgent = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: agentService.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      toast.success('Agente criado com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao criar agente');
    },
  });
};
```

### Usando no Componente

```typescript
// frontend/src/pages/Dashboard.tsx
import { useAgents } from '../hooks/useAgents';

const Dashboard = () => {
  const { data, isLoading, error } = useAgents();
  
  if (isLoading) return <div>Carregando...</div>;
  if (error) return <div>Erro ao carregar agentes</div>;
  
  const agents = data?.data?.agents || [];
  
  return (
    <div>
      {agents.map(agent => (
        <div key={agent.id}>{agent.name}</div>
      ))}
    </div>
  );
};
```

## Plugins

### Service de Plugins

```typescript
// frontend/src/services/plugin.service.ts
import api from '../lib/axios';

export const pluginService = {
  async list() {
    const response = await api.get('/plugins');
    return response.data;
  },

  async getAgentPlugins(agentId: string) {
    const response = await api.get(`/agents/${agentId}/plugins`);
    return response.data;
  },

  async install(agentId: string, data: {
    pluginId: string;
    isSandbox: boolean;
    config?: Record<string, any>;
  }) {
    const response = await api.post(`/agents/${agentId}/plugins`, data);
    return response.data;
  },

  async uninstall(agentId: string, pluginId: string) {
    const response = await api.delete(`/agents/${agentId}/plugins/${pluginId}`);
    return response.data;
  },
};
```

## WebSocket (Chat)

### Conexão WebSocket

```typescript
// frontend/src/services/websocket.service.ts
import { WS_BASE_URL } from '../config/api';

class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  
  connect(token: string) {
    this.ws = new WebSocket(`${WS_BASE_URL}/ws/chat?token=${token}`);
    
    this.ws.onopen = () => {
      console.log('WebSocket conectado');
      this.reconnectAttempts = 0;
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket desconectado');
      this.handleReconnect(token);
    };
    
    this.ws.onerror = (error) => {
      console.error('Erro no WebSocket:', error);
    };
  }
  
  private handleReconnect(token: string) {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => {
        console.log(`Tentando reconectar... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.connect(token);
      }, 3000 * this.reconnectAttempts);
    }
  }
  
  onMessage(callback: (data: any) => void) {
    if (this.ws) {
      this.ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        callback(data);
      };
    }
  }
  
  send(data: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
  
  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

export const wsService = new WebSocketService();
```

### Hook do Chat

```typescript
// frontend/src/hooks/useChat.ts
import { useState, useEffect } from 'react';
import { wsService } from '../services/websocket.service';

export const useChat = (agentId: string) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  
  useEffect(() => {
    const token = localStorage.getItem('token');
    
    if (token) {
      wsService.connect(token);
      
      wsService.onMessage((data) => {
        if (data.type === 'connected') {
          setIsConnected(true);
          // Entrar na conversa do agente
          wsService.send({
            type: 'join',
            data: { agentId },
          });
        }
        
        if (data.type === 'message') {
          setMessages(prev => [...prev, data.data.message]);
        }
      });
    }
    
    return () => {
      wsService.disconnect();
    };
  }, [agentId]);
  
  const sendMessage = (content: string) => {
    // Adicionar mensagem do usuário imediatamente
    setMessages(prev => [...prev, {
      role: 'user',
      content,
      createdAt: new Date(),
    }]);
    
    // Enviar via WebSocket
    wsService.send({
      type: 'message',
      data: {
        agentId,
        content,
      },
    });
  };
  
  return {
    messages,
    sendMessage,
    isConnected,
  };
};
```

### Usando no Componente

```typescript
// frontend/src/pages/AgentDetail.tsx
import { useChat } from '../hooks/useChat';

const AgentDetail = () => {
  const { id } = useParams();
  const { messages, sendMessage, isConnected } = useChat(id!);
  const [input, setInput] = useState('');
  
  const handleSend = () => {
    if (input.trim()) {
      sendMessage(input);
      setInput('');
    }
  };
  
  return (
    <div>
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role}>
            {msg.content}
          </div>
        ))}
      </div>
      
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyPress={(e) => e.key === 'Enter' && handleSend()}
        disabled={!isConnected}
      />
      
      <button onClick={handleSend} disabled={!isConnected}>
        Enviar
      </button>
    </div>
  );
};
```

## Variáveis de Ambiente (Frontend)

```env
# .env.development
VITE_API_URL=http://localhost:3000/api
VITE_WS_URL=ws://localhost:3000

# .env.production
VITE_API_URL=https://api.seudominio.com/api
VITE_WS_URL=wss://api.seudominio.com
```

## CORS

O backend já está configurado para aceitar requisições do frontend.

Se precisar adicionar mais origens:

```env
# backend/.env
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://seudominio.com
```

## Exemplo Completo: Criar Agente

```typescript
// frontend/src/pages/CreateAgent.tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateAgent } from '../hooks/useAgents';

const CreateAgent = () => {
  const navigate = useNavigate();
  const createAgent = useCreateAgent();
  
  const [formData, setFormData] = useState({
    name: '',
    creationMode: 'simple',
    objective: '',
    persona: '',
  });
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      await createAgent.mutateAsync(formData);
      navigate('/dashboard');
    } catch (error) {
      console.error('Erro ao criar agente:', error);
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        placeholder="Nome do agente"
      />
      
      <textarea
        value={formData.objective}
        onChange={(e) => setFormData({ ...formData, objective: e.target.value })}
        placeholder="Objetivo"
      />
      
      <button type="submit" disabled={createAgent.isPending}>
        {createAgent.isPending ? 'Criando...' : 'Criar Agente'}
      </button>
    </form>
  );
};
```

## Tratamento de Erros

```typescript
// frontend/src/lib/axios.ts
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      // Erro com resposta do servidor
      const message = error.response.data?.error || 'Erro no servidor';
      toast.error(message);
    } else if (error.request) {
      // Requisição feita mas sem resposta
      toast.error('Servidor não respondeu. Verifique sua conexão.');
    } else {
      // Erro ao configurar requisição
      toast.error('Erro ao fazer requisição');
    }
    
    return Promise.reject(error);
  }
);
```

## Checklist de Integração

- [ ] Configurar variáveis de ambiente
- [ ] Implementar axios com interceptors
- [ ] Implementar AuthContext com login/logout
- [ ] Implementar services para cada recurso
- [ ] Implementar hooks com React Query
- [ ] Configurar WebSocket para chat
- [ ] Adicionar tratamento de erros global
- [ ] Testar todas as rotas
- [ ] Configurar CORS no backend

---

**Pronto!** Com isso o frontend está totalmente integrado ao backend. 🎉
