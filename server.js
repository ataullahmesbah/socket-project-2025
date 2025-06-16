// socket-project/server.js
//
require('dotenv/config'); // Add this line at the top
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dbConnect = require('./src/lib/dbMongoose');
const Chat = require('./src/models/Chat');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    path: '/socket.io',
    transports: ['polling', 'websocket'],
    cors: {
        origin: process.env.FRONTEND_URL,
        methods: ['GET', 'POST'],
        credentials: true,
    },
});

app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

const startServer = async () => {
    try {
        await dbConnect();
        io.on('connection', (socket) => {
            console.log(`✅ Client Connected: ${socket.id}`);

            if (socket.handshake.query.isAdmin === 'true') {
                socket.join('admin-room');
                console.log(`Socket ${socket.id} joined admin-room`);
            }

            socket.on('init-chat', async ({ persistentUserId }) => {
                if (!persistentUserId) {
                    console.error('❌ No persistentUserId');
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
                    if (chat.status === 'pending') {
                        io.to('admin-room').emit('new-chat-request', chat);
                    }
                } catch (err) {
                    console.error('❌ Init chat error:', err.message);
                    socket.emit('error', { message: 'Failed to initialize chat' });
                }
            });

            socket.on('user-message', async ({ persistentUserId, content }) => {
                try {
                    const newMessage = { sender: 'user', content, timestamp: new Date() };
                    await Chat.updateOne(
                        { userId: persistentUserId },
                        { $push: { messages: newMessage }, $set: { updatedAt: new Date() } }
                    );
                    io.to(persistentUserId).emit('new-message', newMessage);
                    io.to('admin-room').emit('new-message-for-admin', { userId: persistentUserId, message: newMessage });
                } catch (err) {
                    console.error('❌ User message error:', err.message);
                    socket.emit('error', { message: 'Failed to send message' });
                }
            });

            socket.on('accept-chat', async ({ userId }) => {
                try {
                    const chat = await Chat.findOneAndUpdate(
                        { userId },
                        { status: 'active' },
                        { new: true }
                    );
                    if (chat) {
                        io.to(userId).emit('chat-accepted', chat);
                        io.to('admin-room').emit('chat-status-update', { userId, status: 'active' });
                    }
                } catch (err) {
                    console.error('❌ Accept chat error:', err.message);
                    socket.emit('error', { message: 'Failed to accept chat' });
                }
            });

            socket.on('admin-message', async ({ userId, content }) => {
                try {
                    const newMessage = { sender: 'admin', content, timestamp: new Date() };
                    await Chat.updateOne(
                        { userId },
                        { $push: { messages: newMessage }, $set: { status: 'active', updatedAt: new Date() } }
                    );
                    io.to(userId).emit('new-message', newMessage);
                    io.to('admin-room').emit('new-message-for-admin', { userId, message: newMessage });
                } catch (err) {
                    console.error('❌ Admin message error:', err.message);
                    socket.emit('error', { message: 'Failed to send message' });
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
        console.error('❌ Startup Error:', err);
        process.exit(1);
    }
};

startServer();