import mongoose from 'mongoose';
import { config } from '../config';
import { logInfo, logError, logWarn } from '../utils/logger';

export const connectMongoDB = async () => {
  try {
    await mongoose.connect(config.mongodb.uri);
    logInfo('MongoDB connected successfully');
  } catch (error) {
    logError('Failed to connect to MongoDB', error);
    process.exit(1);
  }
};

mongoose.connection.on('disconnected', () => {
  logWarn('MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
  logError('MongoDB connection error', err);
});

mongoose.connection.on('reconnected', () => {
  logInfo('MongoDB reconnected');
});
