import mongoose, { Schema, Document } from 'mongoose';

export interface IConversation extends Document {
  agentId: string;
  userId?: string;
  channel: string;
  status: 'active' | 'closed' | 'transferred';
  startedAt: Date;
  endedAt?: Date;
  metadata?: Record<string, any>;
}

const ConversationSchema = new Schema<IConversation>({
  agentId: { type: String, required: true, index: true },
  userId: { type: String, index: true },
  channel: { type: String, required: true, default: 'webchat' },
  status: { 
    type: String, 
    enum: ['active', 'closed', 'transferred'],
    default: 'active',
    index: true
  },
  startedAt: { type: Date, default: Date.now, index: true },
  endedAt: { type: Date },
  metadata: { type: Schema.Types.Mixed },
}, {
  timestamps: true,
});

export const Conversation = mongoose.model<IConversation>('Conversation', ConversationSchema);
