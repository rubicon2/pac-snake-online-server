const { WebSocketServer } = require('ws');
const validator = require('validator');

const LobbyManager = require('./lobbyManager');
const { sendToClients } = require('./wsUtils');

require('dotenv').config();
const MAX_GAMES = process.env.MAX_GAMES || 4;

// ws object maps to: time_connected, id, name, lobby_name, which can be used to find the game from the games map.
const clientMetadata = new Map();

// app.listen() returns a nodejs httpServer, which wss can piggyback on the same port.
function gameServer(app, port) {
  const wss = new WebSocketServer({ server: app.listen(port) });
  LobbyManager.setMaxLobbies(MAX_GAMES);

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    ws.on('error', console.error);

    ws.on('close', () => {
      if (clientMetadata.has(ws)) {
        try {
          const { id, name, lobby: lobby_name } = clientMetadata.get(ws);
          if (lobby_name) {
            const lobby = LobbyManager.get(lobby_name);
            if (lobby) {
              lobby.removePlayer(id);
              clientMetadata.delete(ws);
              if (lobby.state === 'lobby' && lobby.allPlayersAreReady)
                lobby.startGame();
              sendToClients(wss.clients, {
                type: 'lobby_list_updated',
                lobbies: LobbyManager.packageData(),
              });
            }
          }
          sendToClients(
            [...wss.clients].filter((client) => client !== ws),
            {
              type: 'message_received',
              message: `Client disconnected via websockets: ${name || id}`,
            },
          );
          console.log('Client disconnected via websockets: ', id);
        } catch (error) {
          reportError(wss.clients, error);
        }
      }
    });

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
            sendToClients(
              [...wss.clients].filter((client) => client !== ws),
              {
                type: 'message_received',
                message: `Client connected via websockets: ${name || uuid}`,
              },
            );
            console.log('Client connected via websockets: ', uuid);
          }
          break;
        }

        case 'name_change_requested': {
          try {
            const trimmed = validator.trim(data.client_name);
            const client_name = validator.escape(trimmed);
            if (client_name != '') {
              clientMetadata.get(ws).name = client_name;
              // Also update name on player object if this client is in a game.
              // This is obviously bad. The name should be stored in only one place, not two.
              const { id, lobby: lobby_name } = clientMetadata.get(ws);
              if (lobby_name)
                LobbyManager.get(lobby_name).players.get(id).name = client_name;
              sendToClients([ws], {
                type: 'name_updated',
                client_name,
              });
              sendToClients(wss.clients, {
                type: 'lobby_list_updated',
                lobbies: LobbyManager.packageData(),
              });
            } else {
              sendToClients([ws], {
                type: 'message_received',
                message: `Player: ${clientMetadata.get(ws).id}: name rejected as it was blank.`,
              });
            }
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'new_lobby_requested': {
          const lobby_name = validator.escape(data.lobby_name);

          try {
            LobbyManager.add(lobby_name, sendGameEventToPlayers);
            sendToClients(wss.clients, {
              type: 'lobby_list_updated',
              lobbies: LobbyManager.packageData(),
            });
            const message = `New lobby was created by ${clientMetadata.get(ws).name || 'unnamed user'}: ${lobby_name}.`;
            console.log(message);
            sendToClients(wss.clients, {
              type: 'message_received',
              message,
            });
          } catch (error) {
            sendToClients([ws], {
              type: 'message_received',
              message: error.message,
            });
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

            // Send client messages if they can't join the lobby for whatever reason.
            const newLobby = LobbyManager.get(lobby_name);
            if (newLobby.state !== 'lobby') {
              sendToClients([ws], {
                type: 'message_received',
                message: `Cannot join ${lobby_name} as the game is already running.`,
              });
              break;
            }
            if (!newLobby.playerCanJoin(id)) {
              sendToClients([ws], {
                type: 'message_received',
                message: `Cannot join ${lobby_name} as it is already full.`,
              });
              break;
            }

            // Now join the requested lobby if the game is not running and there are spots free.
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
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'player_leave_lobby_request': {
          const { id, name, lobby: lobby_name } = clientMetadata.get(ws);
          clientMetadata.get(ws).lobby = null;

          try {
            if (lobby_name) {
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
            } else {
              sendToClients([ws], {
                type: 'message_received',
                message: `Player: ${id} tried to leave lobby when not in a lobby.`,
              });
            }
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
            const message = `Lobby closed by ${clientMetadata.get(ws).name || 'unnamed user'}: ${lobby_name}.`;
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

        case 'change_lobby_speed_request': {
          const { lobby_name } = data;
          try {
            const lobby = LobbyManager.get(lobby_name);
            if (lobby.state !== 'running') {
              LobbyManager.get(lobby_name).changeSpeed();
              sendToClients(wss.clients, {
                type: 'lobby_list_updated',
                lobbies: LobbyManager.packageData(),
              });
            } else {
              sendToClients([ws], {
                type: 'message_received',
                message:
                  'Cannot change game speed from lobby while a game is running.',
              });
            }
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }

        case 'lobby_list_update_request': {
          sendToClients([ws], {
            type: 'lobby_list_updated',
            lobbies: LobbyManager.packageData(),
          });
          break;
        }

        case 'lobby_header_update_request': {
          sendToClients([ws], {
            type: 'lobby_header_updated',
            lobby_name: clientMetadata.get(ws).lobby,
          });
          break;
        }

        case 'player_ready_changed': {
          try {
            const { id, lobby: lobby_name } = clientMetadata.get(ws);
            if (lobby_name) {
              const lobby = LobbyManager.get(lobby_name);
              lobby.setPlayerReady(id, data.ready);
              if (lobby.allPlayersAreReady) lobby.startGame();
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

        case 'player_direction_changed': {
          try {
            const { id, lobby: lobby_name } = clientMetadata.get(ws);
            if (lobby_name) {
              const lobby = LobbyManager.get(lobby_name);
              lobby.players.get(id).snake.handleInput(data.direction);
            }
          } catch (error) {
            reportError(wss.clients, error);
          }
          break;
        }
      }
    });

    // Send initial list of lobbies to this client.
    sendToClients([ws], {
      type: 'lobby_list_updated',
      lobbies: LobbyManager.packageData(),
    });
  });

  function sendGameEventToPlayers(type, game) {
    if (type === 'game_ended') {
      sendToClients(wss.clients, {
        type: 'lobby_list_updated',
        lobbies: LobbyManager.packageData(),
      });
    }
    sendToClients(game.clients, {
      type,
      game_state: game.packageData(),
    });
  }

  function heartbeat() {
    this.isAlive = true;
  }

  const pingInterval = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) return client.terminate();
      client.isAlive = false;
      client.ping();
    }
  }, 10000);

  wss.on('close', () => {
    clearInterval(pingInterval);
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

module.exports = gameServer;
