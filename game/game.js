const Player = require('./player');

class Game {
  #updateTimeout = null;

  // state can be: 'lobby', 'running', 'paused', 'round_over', 'game_over'
  #state = 'lobby';
  get state() {
    return this.#state;
  }

  // Map client unique id -> player object
  #players = new Map();
  // For updating player inputs, etc.
  get players() {
    return this.#players;
  }
  // For getting list of clients connected to this game, and sending updates over websocket.
  get clients() {
    return [...this.#players.values()].map((player) => player.ws);
  }
  playerCanJoin(id) {
    return this.#players.size < 4 && !this.#players.has(id);
  }
  addPlayer(id, name, ws) {
    // Server should check before trying to add, but just in case.
    if (this.#state === 'lobby' && this.playerCanJoin(id)) {
      this.#players.set(id, new Player(name, ws));
      this.onGameStateChange(this);
    }
  }
  removePlayer(id) {
    this.#players.delete(id);
    this.onGameStateChange(this);
  }
  hasPlayer(id) {
    return this.#players.has(id);
  }
  setPlayerReady(id, isReady) {
    if (this.#players.has(id)) {
      this.#players.get(id).ready = isReady;
      this.onGameStateChange(this);
    }
  }

  get playerCount() {
    return this.#players.size;
  }

  get allPlayersAreReady() {
    if (this.#players.size === 0) return false;
    const allPlayers = this.#players.values();
    for (const player of allPlayers) {
      if (!player.ready) return false;
    }
    return true;
  }

  #currentRound = 0;
  get currentRound() {
    return this.#currentRound;
  }
  resetGame() {
    this.#currentRound = 0;
    this.onGameStateChange(this);
  }
  nextRound() {
    this.#currentRound++;
    this.onGameStateChange(this);
  }

  constructor(onGameStateChange, onGameStart, onGameEnd) {
    this.onGameStateChange = onGameStateChange;
    this.onGameStart = onGameStart;
    this.onGameEnd = onGameEnd;
  }

  packagePlayerData() {
    const packaged = {};
    this.#players.forEach((player, id, map) => {
      packaged[id] = player.packageData();
    });
    return packaged;
  }

  // For sending only the necessary data over websockets.
  packageData() {
    return {
      state: this.#state,
      // Use the array'd version of players instead of the map, which cannot be stringified.
      players: this.packagePlayerData(),
      currentRound: this.#currentRound,
    };
  }

  startGame() {
    // this.#state = 'running';
    console.log('Game started!');
    if (this.onGameStart) this.onGameStart(this);
  }

  endGame() {
    this.#state = 'lobby';
    if (this.onGameEnd) this.onGameEnd(this);
  }

  update() {
    switch (this.#state) {
      case 'running': {
        if (this.onGameStateChange) this.onGameStateChange(this);
        clearTimeout(this.#updateTimeout);
        this.#updateTimeout = setTimeout(this.update.bind(this), 1000);
      }
    }
  }
}

module.exports = Game;
