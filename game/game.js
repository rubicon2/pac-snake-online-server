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

  #players = new Set();
  get players() {
    return [...this.#players];
  }
  playerCanJoin(player) {
    return this.#players.size < 4 && !this.#players.has(player);
  }
  addPlayer(player) {
    // Server should check before trying to add, but just in case.
    if (this.playerCanJoin(player)) {
      this.#players.add(player);
      this.onGameStateChange(this);
    }
  }
  removePlayer(player) {
    this.#players.delete(player);
    this.onGameStateChange(this);
  }

  get playerCount() {
    return this.#players.size;
  }

  get allPlayersAreReady() {
    this.#players.forEach((player) => {
      if (!player.isReady) return false;
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
