// socket-project/server.js

require('dotenv/config'); // Add this line at the top
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dbConnect = require('./src/lib/dbMongoose');
const Chat = require('./src/models/Chat');
const mongoose = require('mongoose');


const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 20000,
  pingInterval: 25000,
});

app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

app.get('/', (req, res) => {
  res.status(200).json({ message: 'Socket.IO server is running' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', dbStatus: mongoose.connection.readyState });
});

const startServer = async () => {
  try {
    await dbConnect();
    console.log('🟢 MongoDB Connected');

    io.on('connection', (socket) => {
      console.log(`✅ Client Connected: ${socket.id}`);

      // Admin joins the admin room
      socket.on('join-admin-room', () => {
        socket.join('admin-room');
        console.log(`Socket ${socket.id} joined admin-room`);
      });

      // User initializes a chat
      socket.on('init-chat', async ({ persistentUserId }) => {
        if (!persistentUserId) {
          return socket.emit('error', { message: 'No user ID provided' });
        }
        socket.join(persistentUserId);
        try {
          const chat = await Chat.findOneAndUpdate(
            { userId: persistentUserId },
            { $setOnInsert: { userId: persistentUserId } },
            { upsert: true, new: true, setDefaultsOnInsert: true }
          );
          socket.emit('chat-history', chat);
          // Notify admin only if it's a brand new chat session with no messages
          if (chat.messages.length === 0) {
            io.to('admin-room').emit('new-chat-request', chat);
            console.log(`📩 Emitted new-chat-request for new userId: ${persistentUserId}`);
          }
        } catch (err) {
          console.error('❌ Init chat error:', err.message);
          socket.emit('error', { message: 'Failed to initialize chat' });
        }
      });

      // Handle user's message
      socket.on('user-message', async ({ persistentUserId, content }) => {
        try {
          const newMessage = {
            sender: 'user',
            content,
            timestamp: new Date(),
            _id: new mongoose.Types.ObjectId(),
          };
          // Find the chat and push the new message
          const chat = await Chat.findOneAndUpdate(
            { userId: persistentUserId },
            { $push: { messages: newMessage }, $set: { status: 'pending', updatedAt: new Date() } },
            { new: true, upsert: true }
          );
          if (chat) {
            // Send the message back to the user's room
            io.to(persistentUserId).emit('new-message', newMessage);
            // Send the message to the admin room
            io.to('admin-room').emit('new-message-for-admin', { userId: persistentUserId, message: newMessage });
          }
        } catch (err) {
          console.error('❌ User message error:', err.message);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Handle admin's message
      socket.on('admin-message', async ({ userId, content }) => {
        try {
          const newMessage = {
            sender: 'admin',
            content,
            timestamp: new Date(),
            _id: new mongoose.Types.ObjectId(),
          };
          const chat = await Chat.findOneAndUpdate(
            { userId },
            { $push: { messages: newMessage }, $set: { status: 'active', updatedAt: new Date() } },
            { new: true }
          );
          if (chat) {
            // Send the message to the user's room
            io.to(userId).emit('new-message', newMessage);
            // Send the message to the admin room so all admins are in sync
            io.to('admin-room').emit('new-message-for-admin', { userId, message: newMessage });
          }
        } catch (err) {
          console.error('❌ Admin message error:', err.message);
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      // Handle admin accepting a chat
      socket.on('accept-chat', async ({ userId }) => {
        try {
          const chat = await Chat.findOneAndUpdate(
            { userId },
            { status: 'active' },
            { new: true }
          );
          if (chat) {
            // Notify the user that the chat is accepted
            io.to(userId).emit('chat-accepted', chat);
            // Notify all admins about the status change
            io.to('admin-room').emit('chat-status-update', { userId, status: 'active' });
          }
        } catch (err) {
          console.error('❌ Accept chat error:', err.message);
          socket.emit('error', { message: 'Failed to accept chat' });
        }
      });

      socket.on('disconnect', () => {
        console.log(`⚠️ Client Disconnected: ${socket.id}`);
      });
    });

    const port = process.env.PORT || 4000;
    server.listen(port, () => {
      console.log(`> Socket server running on http://localhost:${port}`);
    });
  } catch (err) {
    console.error('❌ Startup Error:', err.message);
    process.exit(1);
  }
};

startServer();
