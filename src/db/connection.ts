import mongoose from 'mongoose';

const MONGO_URI = process.env.MONGO_URI ?? '';
if (!MONGO_URI) throw new Error('MONGO_URI ni nastavljen');

let connected = false;

export async function connectDB(): Promise<void> {
  if (connected) return;
  await mongoose.connect(MONGO_URI, { dbName: 'ai-vs-humanity' });
  connected = true;
  console.log('MongoDB: povezan');
}

export { mongoose };
