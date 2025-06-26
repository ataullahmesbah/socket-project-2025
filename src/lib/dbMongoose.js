const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB;

if (!MONGODB_URI || !MONGODB_DB) {
  throw new Error('Please define the MONGODB_URI and MONGODB_DB environment variables');
}

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  if (cached.conn) {
    console.log('🟢 Using cached MongoDB connection');
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      dbName: MONGODB_DB,
      bufferCommands: false,
    };

    console.log('🟡 Attempting MongoDB connection:', { uri: MONGODB_URI.replace(/\/\/.*@/, '//<hidden>@'), dbName: MONGODB_DB });

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      console.log('🟢 MongoDB Connected (Backend)');
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    console.error('❌ MongoDB Connection Error (Backend):', e.message);
    throw e;
  }

  return cached.conn;
}

module.exports = dbConnect;