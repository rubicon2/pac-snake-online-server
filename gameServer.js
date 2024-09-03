const WebSocket = require('ws');
const { WebSocketServer } = require('ws');
const Player = require('./game/player');
const Game = require('./game/game');

const MAX_GAMES = process.env.MAX_GAMES || 4;

// ws object maps to what lobby_name they are associated with
const clientMetadata = new Map();
// lobby_name maps to game object
const games = new Map();

function packageLobbyListData(map) {
  const packaged = [];
  map.forEach((value, key, map) => {
    packaged.push({
      lobby_name: key,
      player_count: value.players.size,
    });
  });
  return packaged;
}

// app.listen() returns a nodejs httpServer, which wss can piggyback on the same port.
function gameServer(app, port) {
  const wss = new WebSocketServer({ server: app.listen(port) });
  wss.on('connection', (ws) => {
    ws.on('error', console.error);

    ws.on('message', (wsData) => {
      const { type, ...data } = JSON.parse(wsData);

      switch (type) {
        case 'opened': {
          const { uuid } = data;
          if (!clientMetadata.has(ws)) {
            clientMetadata.set(ws, {
              id: uuid,
              time_connected: Date.now(),
              player: new Player(),
              lobby: null,
            });
            console.log('Client connected via websockets: ', uuid);
          }
          break;
        }

        case 'closed': {
          const { uuid } = data;
          if (clientMetadata.has(ws)) {
            clientMetadata.delete(ws);
            console.log('Client disconnected via websockets: ', uuid);
          }
          break;
        }

        case 'new_lobby_requested': {
          const { lobby_name } = data;
          if (games.size >= MAX_GAMES) {
            ws.send(
              JSON.stringify({
                type: 'message_received',
                message: 'The maximum number of lobbies are already open.',
              }),
            );
          } else if (games.has(lobby_name)) {
            ws.send(
              JSON.stringify({
                type: 'message_received',
                message: 'Lobby with that name already exists.',
              }),
            );
          } else {
            console.log(
              `New lobby created by ${clientMetadata.get(ws).id}: ${lobby_name}`,
            );
            games.set(lobby_name, new Game(sendGameUpdate));
            ws.send(
              JSON.stringify({
                type: 'message_received',
                message: `New lobby was created: ${lobby_name}`,
              }),
            );
            sendLobbyListUpdate(games);
          }
          break;
        }

        case 'player_join_lobby_request': {
          const { lobby_name } = data;
          if (games.has(lobby_name)) {
            // If player is already in a lobby, remove them.
            const { id, lobby: previousLobby } = clientMetadata.get(ws);
            if (previousLobby) previousLobby.removePlayer(ws);

            // Now join the new lobby.
            const lobby = games.get(lobby_name);
            if (lobby.state === 'lobby' && lobby.playerCanJoin(ws)) {
              clientMetadata.get(ws).lobby = lobby;
              lobby.addPlayer(id);
              console.log(`Player: ${id} joined game: ${lobby_name}`);

              // Send message to client about their amazing success.
              ws.send(JSON.stringify({ type: 'joined_lobby', lobby_name }));

              // Send updated list to all clients.
              sendLobbyListUpdate(games);
            } else {
              // Send message to client about their hideous failure.
              if (lobby.players.size >= 4) {
                ws.send(
                  JSON.stringify({
                    type: 'message_received',
                    message: `Could not join lobby: ${lobby_name} as it is already full`,
                  }),
                );
              } else if (lobby.state !== 'lobby') {
                ws.send(
                  JSON.stringify({
                    type: 'message_received',
                    message: `Could not join lobby: ${lobby_name} as the game is already running`,
                  }),
                );
              }
            }
          } else {
            // Send message to client saying lobby not found.
          }
          break;
        }

        case 'player_leave_lobby_request': {
          const { id, lobby } = clientMetadata.get(ws);
          clientMetadata.get(ws).lobby = null;
          if (lobby) {
            lobby.removePlayer(id);
            console.log(`Player: ${id} left game`);
            ws.send(
              JSON.stringify({
                type: 'left_lobby',
              }),
            );

            sendLobbyListUpdate(games);
          }
          break;
        }

        case 'player_ready_changed': {
          break;
        }

        case 'player_direction_changed': {
          const { direction } = data;
          // Change direction of player's snake.
          const { player } = clientMetadata.get(ws);
          break;
        }
      }
    });

    // Send initial list of lobbies.
    ws.send(
      JSON.stringify({
        type: 'lobby_list_updated',
        lobbies: packageLobbyListData(games),
      }),
    );
  });

  function sendToAllClients(data) {
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
      }
    });
  }

  function sendLobbyListUpdate(games) {
    sendToAllClients({
      type: 'lobby_list_updated',
      // Convert map into array of keys.
      lobbies: packageLobbyListData(games),
    });
  }

  function sendGameUpdate(game) {
    // In the future, send only to clients associated with this particular game, not ALL of them.
    sendToAllClients({
      type: 'game_updated',
      game_state: game.packageGameData(),
    });
  }

  return wss;
}

module.exports = gameServer;
