import dns from 'node:dns';
import mongoose from 'mongoose';
import { env } from './env.js';

/**
 * `mongodb+srv://` URIs need an SRV lookup. Some Windows setups (e.g. a local
 * VPN/WARP resolver on 127.0.0.1) refuse SRV queries, so DNS_SERVERS lets you
 * point Node at resolvers that answer them.
 */
function applyDnsServers() {
  if (env.dnsServers.length) dns.setServers(env.dnsServers);
}

export async function connectDatabase(uri = env.MONGODB_URI): Promise<void> {
  applyDnsServers();
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  console.log(`MongoDB connected (${mongoose.connection.name})`);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
