const express = require('express');
const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
require('dotenv').config();

const PORT = process.env.PORT || 3000;

const app = express();
// public/index.html will automatically be sent to the http client.
app.use(express.static('public'));

const clientMetadata = new Map();
const messages = [];

// app.listen() returns a nodejs httpServer, which wss can piggyback on the same port.
const wss = new WebSocketServer({ server: app.listen(PORT) });
wss.on('connection', (ws) => {
  ws.on('error', console.error);

  ws.on('message', (data) => {
    const json = JSON.parse(data);

    switch (json.type) {
      case 'opened': {
        const { uuid } = json;
        if (!clientMetadata.has(ws)) {
          clientMetadata.set(ws, { id: uuid, time_connected: Date.now() });
          console.log('Client connected via websockets: ', uuid);
        }
        break;
      }

      case 'closed': {
        const { uuid } = json;
        if (clientMetadata.has(ws)) {
          clientMetadata.delete(ws);
          console.log('Client disconnected via websockets: ', uuid);
        }
        break;
      }

      case 'message_submitted': {
        const { message } = json;
        if (message !== '') {
          messages.push(message);
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({ type: 'messages_updated', messages }),
              );
            }
          });
        }
        break;
      }
    }
  });

  // Send initial batch of messages.
  ws.send(JSON.stringify({ type: 'messages_updated', messages }));
});
