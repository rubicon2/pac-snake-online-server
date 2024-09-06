const { WebSocketServer } = require('ws');
const validator = require('validator');

const LobbyManager = require('./lobbyManager');
const { sendToClients } = require('./wsUtils');

const MAX_GAMES = process.env.MAX_GAMES || 4;

// ws object maps to: time_connected, id, name, lobby_name, which can be used to find the game from the games map.
const clientMetadata = new Map();

// app.listen() returns a nodejs httpServer, which wss can piggyback on the same port.
function gameServer(app, port) {
  const wss = new WebSocketServer({ server: app.listen(port) });
  LobbyManager.setMaxLobbies(MAX_GAMES);

  wss.on('connection', (ws) => {
    ws.on('error', console.error);

    ws.on('message', (wsData) => {
      const { type, ...data } = JSON.parse(wsData);

      switch (type) {
        case 'opened': {
          const { uuid, name } = data;
          if (!clientMetadata.has(ws)) {
            clientMetadata.set(ws, {
              id: uuid,
              time_connected: Date.now(),
              name,
              lobby: null,
            });
            console.log('Client connected via websockets: ', uuid);
          }
          break;
        }

        case 'closed': {
          const { uuid } = data;
          if (clientMetadata.has(ws)) {
            try {
              const { id, lobby: lobby_name } = clientMetadata.get(ws);
              const lobby = LobbyManager.get(lobby_name);
              if (lobby) {
                lobby.removePlayer(id);
                clientMetadata.delete(ws);
                if (lobby.allPlayersAreReady) lobby.startGame();
                sendToClients(wss.clients, {
                  type: 'lobby_list_updated',
                  lobbies: LobbyManager.packageData(),
                });
              }
              console.log('Client disconnected via websockets: ', uuid);
            } catch (error) {
              reportError(wss.clients, error);
            }
          }
          break;
        }

        case 'name_change_requested': {
          try {
            const trimmed = validator.trim(data.client_name);
            const client_name = validator.escape(trimmed);
            if (client_name === '')
              throw new Error(
                `Player: ${clientMetadata.get(ws).id}: name rejected as it was blank.`,
              );
            clientMetadata.get(ws).name = client_name;
            // Also update name on player object if this client is in a game.
            // This is obviously bad. The name should be stored in only one place, not two.
            const { id, lobby: lobby_name } = clientMetadata.get(ws);
            if (lobby_name)
              LobbyManager.get(lobby_name).players.get(id).name = client_name;
            ws.send(
              JSON.stringify({
                type: 'name_updated',
                client_name,
              }),
            );
            sendToClients(wss.clients, {
              type: 'lobby_list_updated',
              lobbies: LobbyManager.packageData(),
            });
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'new_lobby_requested': {
          const lobby_name = validator.escape(data.lobby_name);

          try {
            LobbyManager.add(
              lobby_name,
              sendGameUpdateToPlayers,
              sendGameStartEventToPlayers,
              sendGameEndEventToPlayers,
            );
            sendToClients(wss.clients, {
              type: 'lobby_list_updated',
              lobbies: LobbyManager.packageData(),
            });
            const message = `New lobby was created by ${clientMetadata.get(ws).name}: ${lobby_name}.`;
            console.log(message);
            sendToClients(wss.clients, {
              type: 'message_received',
              message,
            });
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'player_join_lobby_request': {
          const { lobby_name } = data;

          try {
            const { id, name, lobby: previousLobby } = clientMetadata.get(ws);
            // If player has not set a name, do not allow them to join a lobby.
            if (!name)
              throw new Error(
                `Player: ${id} tried to join a lobby: you must set a name first.`,
              );
            // If player is already in a lobby, remove them.
            if (previousLobby) LobbyManager.get(previousLobby).removePlayer(id);
            const newLobby = LobbyManager.get(lobby_name);
            // Now join the requested lobby.
            if (newLobby.state === 'lobby' && newLobby.playerCanJoin(id)) {
              clientMetadata.get(ws).lobby = lobby_name;
              newLobby.addPlayer(id, name, ws);
              const message = `${name} joined lobby: ${lobby_name}.`;
              console.log(message);
              sendToClients(wss.clients, {
                type: 'message_received',
                message,
              });
              ws.send(JSON.stringify({ type: 'joined_lobby', lobby_name }));
              sendToClients(wss.clients, {
                type: 'lobby_list_updated',
                lobbies: LobbyManager.packageData(),
              });
            }
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'player_leave_lobby_request': {
          const { id, name, lobby: lobby_name } = clientMetadata.get(ws);
          clientMetadata.get(ws).lobby = null;

          try {
            if (!lobby_name)
              throw new Error(
                `Player: ${id} tried to leave lobby when not in a lobby.`,
              );
            const lobby = LobbyManager.get(lobby_name);
            lobby.removePlayer(id);
            ws.send(
              JSON.stringify({
                type: 'left_lobby',
              }),
            );
            const message = `${name} left lobby: ${lobby_name}.`;
            console.log(message);
            sendToClients(wss.clients, {
              type: 'message_received',
              message,
            });
            if (lobby.allPlayersAreReady) lobby.startGame();
            sendToClients(wss.clients, {
              type: 'lobby_list_updated',
              lobbies: LobbyManager.packageData(),
            });
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'close_lobby_request': {
          const { lobby_name } = data;

          try {
            LobbyManager.delete(lobby_name);
            sendToClients(wss.clients, {
              type: 'lobby_list_updated',
              lobbies: LobbyManager.packageData(),
            });
            const message = `Lobby closed by ${clientMetadata.get(ws).name}: ${lobby_name}.`;
            console.log(message);
            sendToClients(wss.clients, {
              type: 'message_received',
              message,
            });
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'player_ready_changed': {
          try {
            const { id, lobby: lobby_name } = clientMetadata.get(ws);
            const lobby = LobbyManager.get(lobby_name);
            lobby.setPlayerReady(id, data.ready);
            if (lobby.allPlayersAreReady) lobby.startGame();
            sendToClients(wss.clients, {
              type: 'lobby_list_updated',
              lobbies: LobbyManager.packageData(),
            });
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'player_direction_changed': {
          try {
            const { id, lobby: lobby_name } = clientMetadata.get(ws);
            if (lobby_name) {
              const lobby = LobbyManager.get(lobby_name);
              lobby.players.get(id).handleDirection(data.direction);
            }
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }
      }
    });

    // Send initial list of lobbies to this client.
    ws.send(
      JSON.stringify({
        type: 'lobby_list_updated',
        lobbies: LobbyManager.packageData(),
      }),
    );
  });

  return wss;
}

function reportError(clients, error) {
  console.log(error.stack);
  sendToClients(clients, {
    type: 'message_received',
    message: error.message,
  });
}

function sendGameEndEventToPlayers(game) {
  sendToClients(game.clients, {
    type: 'game_ended',
    game_state: game.packageData(),
  });
}

function sendGameStartEventToPlayers(game) {
  sendToClients(game.clients, {
    type: 'game_started',
    game_state: game.packageData(),
  });
}

function sendGameUpdateToPlayers(game) {
  sendToClients(game.clients, {
    type: 'game_updated',
    game_state: game.packageData(),
  });
}

module.exports = gameServer;
