const { loopInt } = require('loop-range');
const Player = require('./player');
const Snake = require('./snake');

const SNAKE_SETUP_DATA = [
  { x: 0, y: 0, direction: 'up' },
  { x: 9, y: 9, direction: 'down' },
  { x: 9, y: 0, direction: 'left' },
  { x: 0, y: 9, direction: 'right' },
];

const MIN_POS = 0;
const MAX_POS = 10;
const UPDATE_INTERVAL_MS = 1000;

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
    if (this.onGameStart) this.onGameStart(this);
    this.#state = 'running';
    this.#createPlayerSnakes();
    this.update();
  }

  endGame() {
    if (this.onGameEnd) this.onGameEnd(this);
    this.#state = 'lobby';
  }

  #createPlayerSnakes() {
    for (const player of this.#players.values()) {
      player.snake = new Snake(0, 0, 3, 'up');
      // Just do the first snake...
      break;
    }
  }

  #moveSnakes() {
    // Need to do collision checking here and not on player class, as we can check the positions of other snakes only here.
    const playersArray = [...this.#players.values()];

    // Remove the tail of each snake before doing any collision checking.
    // Each snake moves sequentially, but it looks simultaneous - this avoids
    // a player getting killed by a tail that moves out of the way on the same update.
    for (const player of playersArray) {
      player.snake.chunks.pop();
    }

    for (const player of playersArray) {
      const { snake } = player;
      if (!snake.isAlive) continue;

      // Calculate projected position.
      const { headX, headY, nextMoveDir } = snake;
      const newX = loopInt(
        MIN_POS,
        MAX_POS,
        headX +
          1 * (nextMoveDir === 'right' ? 1 : nextMoveDir === 'left' ? -1 : 0),
      );
      const newY = loopInt(
        MIN_POS,
        MAX_POS,
        headY +
          1 * (nextMoveDir === 'up' ? -1 : nextMoveDir === 'down' ? 1 : 0),
      );

      // Collision detected for that gorgeous food

      // Collision detection for the snakes.
      for (const otherPlayer of playersArray) {
        const { snake: otherSnake } = otherPlayer;
        // So player can run over dead snakes with impunity.
        if (!otherSnake.isAlive) continue;

        for (const chunk of otherSnake.chunks) {
          // If other is this snake, ignore the first entry in the chunks array.
          if (
            otherSnake === snake &&
            chunk.x === snake.headX &&
            chunk.y === snake.headY
          )
            continue;
          // Otherwise, check all those chunks for collisions.
          if (chunk.x === newX && chunk.y === newY) {
            // Destroy snake.
            // How to do that sequential snake destruction like in the old version?
            snake.kill();
          }
        }
      }

      // If current snake has collided with something and died, skip the rest of the loop.
      if (!snake.isAlive) continue;

      // If no collisions happened, create new chunk at newX and newY positions.
      snake.moveTo(newX, newY);
    }
  }

  update() {
    switch (this.#state) {
      case 'running': {
        this.#moveSnakes();
        if (this.onGameStateChange) this.onGameStateChange(this);
        clearTimeout(this.#updateTimeout);
        this.#updateTimeout = setTimeout(
          this.update.bind(this),
          UPDATE_INTERVAL_MS,
        );
      }
    }
  }
}

module.exports = Game;
