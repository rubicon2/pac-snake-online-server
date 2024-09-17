const Game = require('./game/game');

class LobbyManager {
  #maxLobbies = 4;
  #lobbies = new Map();

  setMaxLobbies(num) {
    this.#maxLobbies = num;
  }

  get(name) {
    if (this.#lobbies.has(name)) return this.#lobbies.get(name);
    else throw new Error(`Tried to get lobby ${name}: does not exist.`);
  }

  // handleGameUpdate will be passed to the game instance, and will be called when the game state is updated.
  // So when gameState is updated, the state will be passed back up and sent over websockets to the clients.
  add(name, handleGameEvent) {
    if (this.#lobbies.size >= this.#maxLobbies) {
      throw new Error(
        'Cannot create new lobby: the maximum number of lobbies are already open.',
      );
    }

    if (this.#lobbies.has(name)) {
      throw new Error(
        'Cannot create new lobby: lobby with that name already exists.',
      );
    }

    if (name === '') {
      throw new Error('Cannot create new lobby: name required.');
    }

    this.#lobbies.set(name, new Game(handleGameEvent));
  }

  delete(name) {
    if (!this.#lobbies.has(name))
      throw new Error(`Tried to delete lobby ${name}: does not exist.`);

    const lobby = this.#lobbies.get(name);

    if (lobby.players.size > 0)
      throw new Error(
        `Tried to delete lobby ${name}: players are still in the lobby.`,
      );

    if (lobby.state !== 'lobby')
      throw new Error(
        `Tried to delete lobby ${name}: game is currently running.`,
      );

    this.#lobbies.delete(name);
  }

  packageData() {
    const packaged = {};
    this.#lobbies.forEach((lobby, lobby_name) => {
      const players = lobby.packagePlayerData();
      const player_count = Object.keys(players).length;
      packaged[lobby_name] = {
        lobby_name,
        lobby_state: lobby.state,
        lobby_speed: lobby.speed,
        player_count,
        players,
      };
    });

    return packaged;
  }
}

// Singleton
module.exports = new LobbyManager();
