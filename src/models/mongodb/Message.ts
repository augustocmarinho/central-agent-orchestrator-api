import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const MessageSchema = new Schema<IMessage>({
  conversationId: { type: String, required: true, index: true },
  role: { 
    type: String, 
    enum: ['user', 'assistant', 'system'],
    required: true 
  },
  content: { type: String, required: true },
  metadata: { type: Schema.Types.Mixed },
  createdAt: { type: Date, default: Date.now, index: true },
});

export const Message = mongoose.model<IMessage>('Message', MessageSchema);
