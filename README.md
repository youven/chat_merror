# Chat Server

This is the Socket.IO server implementation for the Android chat application.

## Prerequisites

- Node.js (v14 or higher)
- npm (Node Package Manager)

## Installation

1. Install Node.js from [https://nodejs.org/](https://nodejs.org/)

2. Navigate to the server directory:
   ```bash
   cd server
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

## Running the Server

1. Start the server:
   ```bash
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

2. The server will start on port 3000 by default.

## API Endpoints

- `GET /health` - Health check endpoint

## Socket.IO Events

### Client to Server:
- `join` - Emitted when a user joins the chat
- `message` - Emitted when sending a message
- `typing` - Emitted when a user starts typing
- `stopTyping` - Emitted when a user stops typing

### Server to Client:
- `userConnected` - Broadcasted when a new user connects
- `userDisconnected` - Broadcasted when a user disconnects
- `message` - Broadcasted when a message is received
- `userTyping` - Broadcasted when a user is typing
- `userStoppedTyping` - Broadcasted when a user stops typing

## Testing with Android App

The Android app is configured to connect to `http://10.0.2.2:3000` when running in the emulator, which maps to localhost:3000 on your machine.

If you're testing with a physical device, update the server URL in the Android app's NetworkModule to point to your computer's local IP address.
