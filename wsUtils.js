const WebSocket = require('ws');

function sendToClients(clients, data) {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  }
}

module.exports = {
  sendToClients,
};
