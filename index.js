const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // Place your Firebase service account file here

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: "*", // In production, replace with specific origin
        methods: ["GET", "POST"]
    }
});

// Store connected users and messages
const users = new Map(); // socketId -> userId
const userSockets = new Map(); // userId -> socketId
const messages = new Map();

// Map to store FCM tokens
const fcmTokens = new Map(); // userId -> fcmToken

// Firebase Admin reference for user tokens
const userTokensRef = admin.database().ref('user_tokens');

// Function to update FCM token in both memory and database
async function updateFcmToken(userId, token) {
    if (!userId || !token) {
        console.error('❌ Invalid userId or token');
        return false;
    }

    try {
        // Update in memory
        fcmTokens.set(userId, token);
        
        // Update in Firebase Realtime Database
        await userTokensRef.child(userId).set({
            token: token,
            updatedAt: admin.database.ServerValue.TIMESTAMP
        });
        
        console.log('\n💾 FCM Token Updated:');
        console.log('├─ User ID:', userId);
        console.log('└─ Token:', token.substring(0, 20) + '...');
        
        return true;
    } catch (error) {
        console.error('❌ Error updating FCM token:', error);
        return false;
    }
}

// Function to load FCM token from database
async function loadFcmToken(userId) {
    try {
        const snapshot = await userTokensRef.child(userId).once('value');
        const data = snapshot.val();
        if (data && data.token) {
            fcmTokens.set(userId, data.token);
            return data.token;
        }
        return null;
    } catch (error) {
        console.error('❌ Error loading FCM token:', error);
        return null;
    }
}

async function sendChatNotificationToUser(uid, title, body) {
  if (!uid) {
    console.error('❌ No recipient UID provided');
    return;
  }
  
  console.log('\n📬 FCM Notification Flow:');
  console.log('├─ Recipient:', uid);
  console.log('├─ Title:', title);
  console.log('└─ Body:', body);

  try {
    const fcmToken = fcmTokens.get(uid);
    if (!fcmToken) {
      console.error('⚠️ FCM Token Missing for user:', uid);
      return;
    }
    
    const message = {
      token: fcmToken,
      notification: {
        title: title,
        body: body,
        android_channel_id: 'chat_messages'
      },
      data: {
        messageId: Date.now().toString(),
        chatId: uid,
        type: 'chat',
        click_action: 'OPEN_CHAT_SCREEN',
        title: title,
        body: body,
        timestamp: Date.now().toString()
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'chat_messages',
          priority: 'high',
          defaultSound: true,
          icon: '@mipmap/ic_launcher'
        }
      }
    };
    
    console.log('\n📤 Sending FCM Message:');
    console.log('├─ To Token:', fcmToken.substring(0, 20) + '...');
    console.log('├─ Channel:', message.android.notification.channelId);
    console.log('└─ Priority:', message.android.notification.priority);

    const response = await admin.messaging().send(message);
    console.log('\n✨ FCM Success:');
    console.log('├─ Message ID:', response);
    console.log('└─ Timestamp:', new Date().toISOString());
    return { success: true, messageId: response };
  } catch (error) {
    console.error('\n❌ FCM Error:');
    console.error('├─ Type:', error.code || 'Unknown');
    console.error('├─ Message:', error.message);
    if (error.errorInfo) {
      console.error('├─ Details:', error.errorInfo);
    }
    return { success: false, error: error.message };
  }
}

// Handle socket connections
io.on('connection', (socket) => {
    console.log('\n🔌 New Socket Connection:');
    console.log('├─ Socket ID:', socket.id);
    console.log('└─ Client IP:', socket.handshake.address);

    // Handle messages
    socket.on('message', async (data) => {
        console.log('\n📨 New Message:');
        console.log('├─ From:', data.senderName, `(${data.senderUid})`);
        console.log('├─ To:', data.recipientUid);
        console.log('└─ Content:', data.content);

        // Validate required fields
        if (!data.recipientUid || !data.senderUid) {
            console.error('❌ Error: Missing required fields');
            console.log('Data received:', JSON.stringify(data, null, 2));
            socket.emit('messageResponse', { 
                messageId: data.id,
                success: false,
                error: 'Missing required fields'
            });
            return;
        }

        try {
            const messageData = {
                id: data.id,
                content: data.content,
                senderUid: data.senderUid,
                recipientUid: data.recipientUid,
                senderName: data.senderName,
                timestamp: data.timestamp || Date.now(),
                status: 'SENT'
            };
            
            // Store message
            messages.set(messageData.id, messageData);
            
            // Get recipient's socket ID
            const recipientSocket = userSockets.get(data.recipientUid);
            
            // Emit message to recipient if online
            if (recipientSocket) {
                io.to(recipientSocket).emit('message', messageData);
                console.log('✅ Message delivered to online recipient');
                
                // Send delivery confirmation to sender
                socket.emit('messageResponse', { 
                    messageId: data.id,
                    success: true,
                    status: 'DELIVERED'
                });
            } else {
                // Recipient is offline, send via FCM
                console.log('📱 Recipient offline, sending FCM notification');
                try {
                    await sendChatNotificationToUser(
                        data.recipientUid,
                        data.senderName || 'New message',
                        data.content
                    );
                    console.log('✅ FCM notification sent');
                } catch (error) {
                    console.error('❌ FCM Error:', error);
                }
                
                // Still send success to sender
                socket.emit('messageResponse', { 
                    messageId: data.id,
                    success: true,
                    status: 'SENT'
                });
            }
        } catch (error) {
            console.error('❌ Error processing message:', error);
            socket.emit('messageResponse', { 
                messageId: data.id,
                success: false,
                error: error.message
            });
        }
    });

    // Handle FCM token registration
    socket.on('registerFcmToken', async (data) => {
        const { userId, token } = data;
        
        console.log('\n📱 FCM Token Registration:');
        console.log('├─ User ID:', userId);
        console.log('└─ Token:', token ? (token.substring(0, 20) + '...') : 'Missing');

        if (!userId || !token) {
            console.error('❌ FCM Registration Error: Missing userId or token');
            socket.emit('fcmTokenResponse', {
                success: false,
                error: 'Invalid userId or token'
            });
            return;
        }

        try {
            const success = await updateFcmToken(userId, token);
            console.log(success ? '✅ FCM token registered successfully' : '❌ FCM token registration failed');
            socket.emit('fcmTokenResponse', { success });
            
            // If this is a new user joining, update their socket mapping
            if (!userSockets.has(userId)) {
                users.set(socket.id, userId);
                userSockets.set(userId, socket.id);
            }
        } catch (error) {
            console.error('❌ FCM Registration Error:', error);
            socket.emit('fcmTokenResponse', {
                success: false,
                error: error.message
            });
        }
    });

    // Handle joining
    socket.on('join', async (userId) => {
        if (!userId) {
            console.error('❌ No user ID provided for join');
            return;
        }

        console.log('\n👤 User Joining:');
        console.log('├─ User ID:', userId);
        console.log('└─ Socket ID:', socket.id);
        
        // Store user mappings
        users.set(socket.id, userId);
        userSockets.set(userId, socket.id);
        
        // Load FCM token if not already in memory
        if (!fcmTokens.has(userId)) {
            await loadFcmToken(userId);
        }
        
        // Notify existing users
        socket.broadcast.emit('userOnline', userId);
        
        // Send current online users to joining user
        const onlineUsers = Array.from(users.values());
        socket.emit('onlineUsers', onlineUsers);
    });

    // Handle message status updates
    socket.on('messageStatus', (data) => {
        const { messageId, status, senderId } = data;
        const senderSocket = userSockets.get(senderId);
        
        if (senderSocket) {
            io.to(senderSocket).emit('messageStatus', {
                messageId,
                status
            });
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        const userId = users.get(socket.id);
        if (userId) {
            console.log('\n👋 User Disconnected:');
            console.log('├─ User ID:', userId);
            console.log('└─ Socket ID:', socket.id);
            
            users.delete(socket.id);
            userSockets.delete(userId);
            socket.broadcast.emit('userOffline', userId);
        }
    });
});

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Socket status endpoint
app.get('/socket-status', (req, res) => {
    const connections = Array.from(io.sockets.sockets.values()).map(socket => ({
        socketId: socket.id,
        userId: users.get(socket.id),
        transport: socket.conn.transport.name,
        address: socket.handshake.address,
        connectedAt: socket.handshake.issued,
        query: socket.handshake.query
    }));

    const status = {
        server: {
            port: PORT,
            uptime: process.uptime()
        },
        connections: {
            total: io.sockets.sockets.size,
            details: connections
        },
        users: {
            total: userSockets.size,
            online: Array.from(userSockets.entries()).map(([userId, socketId]) => ({
                userId,
                socketId,
                connected: io.sockets.sockets.has(socketId)
            }))
        },
        messages: {
            total: messages.size,
            recent: Array.from(messages.values())
                .sort((a, b) => b.timestamp - a.timestamp)
                .slice(0, 5)
        }
    };

    res.json(status);
});

// Test endpoint for FCM
app.post('/test-notification', express.json(), async (req, res) => {
    try {
        const { uid, title, body } = req.body;
        
        // Get user's FCM token
        const userSnap = await admin.database().ref(`users/${uid}`).once('value');
        const user = userSnap.val();
        
        if (!user || !user.fcmToken) {
            return res.status(404).json({ error: 'User token not found' });
        }

        // Send both notification and data message
        const message = {
            token: user.fcmToken,
            notification: {
                title: title || 'Test Notification',
                body: body || 'This is a test notification'
            },
            data: {
                messageId: Date.now().toString()
            },
            android: {
                priority: 'high'
            }
        };

        const response = await admin.messaging().send(message);
        console.log('Successfully sent test notification:', response);
        res.json({ success: true, messageId: response });
    } catch (error) {
        console.error('Error sending test notification:', error);
        res.status(500).json({ error: error.message });
    }
});

// Test endpoint for sending messages
app.post('/test-message', express.json(), async (req, res) => {
    try {
        const { senderUid, recipientUid, content } = req.body;
        
        console.log('\n📨 Processing Test Message:');
        console.log('├─ From:', senderUid);
        console.log('├─ To:', recipientUid);
        console.log('└─ Content:', content);

        // Validate input
        if (!senderUid || !recipientUid || !content) {
            throw new Error('Missing required fields: senderUid, recipientUid, content');
        }

        // Get sender's socket if they're online
        const senderSocketId = userSockets.get(senderUid);
        const recipientSocketId = userSockets.get(recipientUid);
        
        console.log('\n👥 User Status:');
        console.log('├─ Sender Socket:', senderSocketId || 'offline');
        console.log('└─ Recipient Socket:', recipientSocketId || 'offline');

        // Create message data
        const messageData = {
            id: Date.now().toString(),
            content: content,
            senderUid: senderUid,
            recipientUid: recipientUid,
            senderName: senderUid === 'A7ZRY2du1rS0xr3ZpzOfI9HxiCn1' ? 'n1' : 'n2',
            timestamp: Date.now(),
            status: 'SENT'
        };

        // Store message
        messages.set(messageData.id, messageData);
        
        // Broadcast to all clients
        io.emit('message', messageData);
        
        console.log('\n📤 Sending Notification:');
        console.log('├─ Type: FCM');
        console.log('├─ To:', recipientUid);
        console.log('└─ Content:', content);

        // Send notification
        await sendChatNotificationToUser(
            recipientUid,
            `New message from ${messageData.senderName}`,
            content
        );

        res.json({ 
            success: true, 
            messageId: messageData.id,
            delivered: {
                socket: !!recipientSocketId,
                notification: true
            }
        });
    } catch (error) {
        console.error('\n❌ Error sending test message:', error);
        res.status(500).json({ error: error.message });
    }
});

let server = null;
const startServer = (port) => {
    if (server) {
        console.log('⚠️ Cleaning up previous server instance...');
        server.close();
    }
    console.log(`🔄 Attempting to start server on port ${port}...`);
    
    server = httpServer.listen(port, () => {
        console.log(`\n=========================`);
        console.log(`🚀 Server running on port ${port}`);
        console.log(`=========================\n`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ Port ${port} is busy, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('❌ Server error:', err);
            process.exit(1);
        }
    });
};

const PORT = process.env.PORT || 3000;
startServer(PORT);
