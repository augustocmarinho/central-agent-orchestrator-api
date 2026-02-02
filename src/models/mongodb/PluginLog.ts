import mongoose, { Schema, Document } from 'mongoose';

export interface IPluginLog extends Document {
  executionId: string;
  pluginId: string;
  agentId: string;
  action: string;
  status: 'success' | 'error';
  input?: Record<string, any>;
  output?: Record<string, any>;
  error?: string;
  duration: number;
  createdAt: Date;
}

const PluginLogSchema = new Schema<IPluginLog>({
  executionId: { type: String, required: true, index: true },
  pluginId: { type: String, required: true, index: true },
  agentId: { type: String, required: true, index: true },
  action: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['success', 'error'],
    required: true 
  },
  input: { type: Schema.Types.Mixed },
  output: { type: Schema.Types.Mixed },
  error: { type: String },
  duration: { type: Number, required: true },
  createdAt: { type: Date, default: Date.now, index: true },
});

export const PluginLog = mongoose.model<IPluginLog>('PluginLog', PluginLogSchema);
