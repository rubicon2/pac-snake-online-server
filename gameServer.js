const socketIO = require('socket.io');
const validator = require('validator');
const LobbyManager = require('./lobbyManager');

// Map uuid to sockets, etc. as the socket will change between connections, but the client will make sure the uuid stays the same.
const clientMetadata = new Map();

function packageClientMetadata(uuid) {
  if (uuid && clientMetadata.has(uuid)) {
    const { name, lobby, time_connected } = clientMetadata.get(uuid);
    return { name, lobby, time_connected };
  } else {
    return null;
  }
}

function gameServer(httpServer) {
  const io = socketIO(httpServer, {
    cors: {
      origin: [process.env.CLIENT_URL],
    },
    connectionStateRecovery: {},
  });

  let disconnectTimeout = null;

  function sendGameEventToPlayers(type, game) {
    if (type === 'game_ended') {
      io.emit('lobby_list_updated', LobbyManager.packageData());
    }
    // This should only send to players that are in the game.
    io.to(game.name).emit(type, game.packageData());
  }

  io.on('connection', (client) => {
    clearTimeout(disconnectTimeout);
    client.on('opened', (uuid) => {
      let new_uuid = uuid;
      // If no uuid was provided by client, generate one and send back.
      if (!new_uuid) {
        new_uuid = crypto.randomUUID();
        // Make sure the uuid doesn't already exist (small chance, but non-zero).
        while (clientMetadata.has(new_uuid)) {
          new_uuid = crypto.randomUUID();
        }
        // Send back to client so it can use with all future messages.
        client.emit('uuid_received', new_uuid);
      }

      // Now create metadata for this client.
      if (!clientMetadata.has(new_uuid)) {
        clientMetadata.set(new_uuid, {
          ws: client,
          time_connected: Date.now(),
          name: null,
          lobby: null,
        });

        io.emit(
          'message_received',
          `Client connected via socket.io: ${new_uuid}`,
        );
        console.log('Client connected via socket.io: ', new_uuid);
      } else {
        // If a client has connected and provided an existing uuid, they must have reconnected...
        // Update the client's metadata with the new socket.
        clientMetadata.get(new_uuid).ws = client;
        const { lobby } = clientMetadata.get(new_uuid);
        client.join(lobby);
        console.log('Client reconnected via socket.io: ', new_uuid);
      }
    });

    client.on('disconnect', () => {
      // If disconnect event is emitted but client is active, this means it is trying to reconnect.
      // If inactive, then the connection was forcibly closed, e.g. by a browser tab being closed.
      disconnectTimeout = setTimeout(() => {
        if (!client.recovered) {
          try {
            const keys = [...clientMetadata.keys()];
            const values = [...clientMetadata.values()];
            // Find uuid of this client.
            let uuid = null;
            for (let i = 0; i < keys.length; i++) {
              uuid = keys[i];
              const data = values[i];
              if (client === data.ws) {
                // Remove player from any games.
                if (data.lobby) {
                  const lobby = LobbyManager.get(data.lobby);
                  lobby.removePlayer(uuid);
                  client.leave(data.lobby);
                  if (lobby.state === 'lobby' && lobby.allPlayersAreReady)
                    lobby.startGame();
                  io.emit('lobby_list_updated', LobbyManager.packageData());
                }
                clientMetadata.delete(uuid);
                break;
              }
            }
            io.emit(
              'message_received',
              `Client disconnected via socket.io: ${uuid}`,
            );
            console.log('Client disconnected via socket.io: ', uuid);
          } catch (error) {
            reportError(io, error);
          }
        }
      }, 5000);
    });

    client.on('name_change_requested', (uuid, name) => {
      try {
        const trimmed = validator.trim(name);
        const client_name = validator.escape(trimmed);
        if (client_name != '') {
          clientMetadata.get(uuid).name = client_name;
          // Also update name on player object if this client is in a game.
          // This is obviously bad. The name should be stored in only one place, not two.
          const { lobby: lobby_name } = clientMetadata.get(uuid);
          if (lobby_name)
            LobbyManager.get(lobby_name).players.get(uuid).name = client_name;
          client.emit('client_data_updated', packageClientMetadata(uuid));
          io.emit('lobby_list_updated', LobbyManager.packageData());
        } else {
          client.emit(
            'message_received',
            `Player: ${uuid}: name rejected as it was blank.`,
          );
        }
      } catch (error) {
        reportError(io, error);
      }
    });

    client.on('new_lobby_requested', (uuid, lobby_name) => {
      const escaped_lobby_name = validator.escape(lobby_name);
      try {
        LobbyManager.add(escaped_lobby_name, sendGameEventToPlayers);
        io.emit('lobby_list_updated', LobbyManager.packageData());
        const message = `New lobby was created by ${clientMetadata.get(uuid).name || 'unnamed user'}: ${escaped_lobby_name}.`;
        console.log(message);
        io.emit('message_received', message);
      } catch (error) {
        io.emit('message_received', error.message);
      }
    });

    client.on('close_lobby_requested', (uuid, lobby_name) => {
      try {
        LobbyManager.delete(lobby_name);
        io.emit('lobby_list_updated', LobbyManager.packageData());
        const message = `Lobby closed by ${clientMetadata.get(uuid).name || 'unnamed user'}: ${lobby_name}.`;
        console.log(message);
        io.emit('message_received', message);
      } catch (error) {
        reportError(io, error);
      }
    });

    client.on('player_join_lobby_requested', (uuid, lobby_name) => {
      try {
        const { name, lobby: previousLobby } = clientMetadata.get(uuid);
        // If player has not set a name, do not allow them to join a lobby.
        if (!name)
          throw new Error(
            `Player: ${uuid} tried to join a lobby: you must set a name first.`,
          );
        // If player is already in a lobby, remove them.
        if (previousLobby) LobbyManager.get(previousLobby).removePlayer(uuid);

        // Send client messages if they can't join the lobby for whatever reason.
        const newLobby = LobbyManager.get(lobby_name);
        if (newLobby.state !== 'lobby') {
          client.emit(
            'message_received',
            `Cannot join ${lobby_name} as the game is already running.`,
          );
          return;
        }
        if (!newLobby.playerCanJoin(uuid)) {
          client.emit(
            'message_received',
            `Cannot join ${lobby_name} as it is already full.`,
          );
          return;
        }

        // Now join the requested lobby if the game is not running and there are spots free.
        clientMetadata.get(uuid).lobby = lobby_name;
        newLobby.addPlayer(uuid, name, client);
        const message = `${name} joined lobby: ${lobby_name}.`;
        console.log(message);
        io.emit('message_received', message);
        client.emit('client_data_updated', packageClientMetadata(uuid));
        io.emit('lobby_list_updated', LobbyManager.packageData());
        client.join(lobby_name);
      } catch (error) {
        reportError(io, error);
      }
    });

    client.on('player_leave_lobby_requested', (uuid) => {
      const { name, lobby: lobby_name } = clientMetadata.get(uuid);
      clientMetadata.get(uuid).lobby = null;

      try {
        if (lobby_name) {
          const lobby = LobbyManager.get(lobby_name);
          lobby.removePlayer(uuid);
          client.leave(lobby_name);
          client.emit('client_data_updated', packageClientMetadata(uuid));
          const message = `${name} left lobby: ${lobby_name}.`;
          console.log(message);
          io.emit('message_received', message);
          if (lobby.allPlayersAreReady) lobby.startGame();
          io.emit('lobby_list_updated', LobbyManager.packageData());
        } else {
          client.emit(
            'message_received',
            `Player: ${uuid} tried to leave lobby when not in a lobby.`,
          );
        }
      } catch (error) {
        reportError(io, error);
      }
    });

    client.on('change_lobby_speed_requested', (uuid, lobby_name) => {
      try {
        const lobby = LobbyManager.get(lobby_name);
        if (lobby.state !== 'running') {
          LobbyManager.get(lobby_name).changeSpeed();
          io.emit('lobby_list_updated', LobbyManager.packageData());
        } else {
          client.emit(
            'message_received',
            'Cannot change game speed from lobby while a game is running.',
          );
        }
      } catch (error) {
        reportError(io, error);
      }
    });

    client.on('lobby_list_update_requested', () => {
      client.emit('lobby_list_updated', LobbyManager.packageData());
    });

    client.on('lobby_header_update_requested', (uuid) => {
      client.emit('lobby_header_updated', clientMetadata.get(uuid).lobby);
    });

    client.on('client_data_update_requested', (uuid) => {
      client.emit('client_data_updated', packageClientMetadata(uuid));
    });

    client.on('player_ready_changed', (uuid, ready) => {
      try {
        const { lobby: lobby_name } = clientMetadata.get(uuid);
        if (lobby_name) {
          const lobby = LobbyManager.get(lobby_name);
          lobby.setPlayerReady(uuid, ready);
          if (lobby.allPlayersAreReady) lobby.startGame();
          io.emit('lobby_list_updated', LobbyManager.packageData());
        }
      } catch (error) {
        reportError(io, error);
      }
    });

    client.on('player_direction_changed', (uuid, direction) => {
      try {
        const { lobby: lobby_name } = clientMetadata.get(uuid);
        if (lobby_name) {
          const lobby = LobbyManager.get(lobby_name);
          lobby.players.get(uuid).snake.handleInput(direction);
        }
      } catch (error) {
        reportError(io, error);
      }
    });
  });
}

function reportError(io, error) {
  console.log(error.stack);
  io.emit('message_received', error.message);
}

module.exports = gameServer;
