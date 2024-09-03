const Player = require('./player');

class Game {
  #updateTimeout = null;

  // state can be: 'lobby', 'running', 'paused', 'round_over', 'game_over'
  #state = 'lobby';
  get state() {
    return this.#state;
  }
  set state(value) {
    this.#state = value;
    // If running, kick off the update loop.
    if (value === 'running') this.update();
    // Invoke callback!
    this.onGameStateChange(this);
  }

  // Map client ws to player.
  #players = new Map();
  get players() {
    return this.#players;
  }
  playerCanJoin(ws) {
    return this.#players.size < 4 && !this.#players.has(ws);
  }
  addPlayer(ws) {
    // Server should check before trying to add, but just in case.
    if (this.playerCanJoin(ws)) {
      this.#players.set(ws, new Player());
      this.onGameStateChange(this);
    }
  }
  removePlayer(ws) {
    this.#players.delete(ws);
    this.onGameStateChange(this);
  }

  get playerCount() {
    return this.#players.size;
  }

  get allPlayersAreReady() {
    this.#players.forEach((value, key, map) => {
      if (!value.isReady) return false;
    });
    return true;
  }

  #currentRound = 0;
  get currentRound() {
    return this.#currentRound;
  }
  resetRound() {
    this.#currentRound = 0;
    this.onGameStateChange(this);
  }
  nextRound() {
    this.#currentRound++;
    this.onGameStateChange(this);
  }

  constructor(onGameStateChange) {
    this.onGameStateChange = onGameStateChange;
  }

  // For sending only the necessary data over websockets.
  packageGameData() {
    return {
      state: this.#state,
      // Use the array'd version of players instead of the set, which cannot be stringified.
      players: this.players,
      currentRound: this.#currentRound,
    };
  }

  update() {
    switch (this.#state) {
      case 'running': {
        this.onGameStateChange(this);
        clearTimeout(this.#updateTimeout);
        this.#updateTimeout = setTimeout(this.update.bind(this), 1000);
      }
    }
  }
}

module.exports = Game;
