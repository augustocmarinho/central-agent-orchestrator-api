import mongoose, { Schema, Document } from 'mongoose';

export interface IExecution extends Document {
  agentId: string;
  conversationId: string;
  messageId: string;
  n8nWorkflowId?: string;
  n8nExecutionId?: string;
  status: 'pending' | 'running' | 'success' | 'error';
  pluginsCalled: string[];
  startedAt: Date;
  completedAt?: Date;
  error?: string;
  metadata?: Record<string, any>;
}

const ExecutionSchema = new Schema<IExecution>({
  agentId: { type: String, required: true, index: true },
  conversationId: { type: String, required: true, index: true },
  messageId: { type: String, required: true },
  n8nWorkflowId: { type: String },
  n8nExecutionId: { type: String },
  status: { 
    type: String, 
    enum: ['pending', 'running', 'success', 'error'],
    default: 'pending',
    index: true
  },
  pluginsCalled: [{ type: String }],
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  error: { type: String },
  metadata: { type: Schema.Types.Mixed },
}, {
  timestamps: true,
});

export const Execution = mongoose.model<IExecution>('Execution', ExecutionSchema);
