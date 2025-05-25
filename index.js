const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // In production, replace with specific origin
        methods: ["GET", "POST"]
    }
});

// Store connected users and messages
const users = new Map();
const messages = new Map();

// Handle socket connections
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    console.log('Connection details:', {
        id: socket.id,
        handshake: socket.handshake,
        transport: socket.conn.transport.name
    });

    // Handle user joining
    socket.on('join', (userId) => {
        users.set(socket.id, userId);
        io.emit('userConnected', userId);
        console.log(`User ${userId} joined`);
    });    // Handle messages
    socket.on('message', (data) => {
        const messageData = {
            id: data.id || Math.random().toString(36).substr(2, 9),
            content: data.content,
            senderId: socket.id,
            timestamp: data.timestamp || Date.now(),
            status: 'SENT'
        };
        
        messages.set(messageData.id, messageData);
        
        // Broadcast message to all connected clients
        io.emit('message', messageData);
        console.log(`Message from ${socket.id}: ${data.content}`);
    });    // Handle message status updates
    socket.on('messageStatus', (data) => {
        const { messageId, status, receiverId } = data;
        const message = messages.get(messageId);
        
        if (message) {
            message.status = status;
            // Notify the sender about the status update
            io.to(message.senderId).emit('messageStatus', {
                messageId,
                status,
                receiverId
            });
            console.log(`Message ${messageId} status updated to ${status} by ${receiverId}`);
        }
    });

    // Handle typing status
    socket.on('typing', (userId) => {
        socket.broadcast.emit('userTyping', userId);
    });

    // Handle stop typing
    socket.on('stopTyping', (userId) => {
        socket.broadcast.emit('userStoppedTyping', userId);
    });

    // Handle disconnection
    socket.on('disconnect', () => {
        const userId = users.get(socket.id);
        if (userId) {
            io.emit('userDisconnected', userId);
            users.delete(socket.id);
            console.log(`User ${userId} disconnected`);
        }
    });
});

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
