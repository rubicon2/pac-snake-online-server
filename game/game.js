const Player = require('./player');
const Snake = require('./snake');
const { loopInt } = require('loop-range');
const {
  SNAKE_SETUP_DATA,
  UPDATE_INTERVAL_MS,
  MIN_POS,
  MAX_POS,
} = require('./data');
const SPAWN_FOOD_TIMEOUT_MS = 5000;

class Game {
  #updateTimeout = null;
  #spawnFoodTimeout = null;

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
  // For getting actual snake objects for all players.
  get snakes() {
    return [...this.#players.values()].map((player) => player.snake);
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
    if (this.#players.size === 0) this.endGame();
  }
  hasPlayer(id) {
    return this.#players.has(id);
  }
  setPlayerReady(id, isReady) {
    if (this.#players.has(id)) {
      this.#players.get(id).ready = isReady;
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

  #foodPickups = [];

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
      foodPickups: this.#foodPickups,
      currentRound: this.#currentRound,
    };
  }

  startGame() {
    if (this.onGameStart) this.onGameStart(this);
    this.#state = 'running';
    this.#createPlayerSnakes();
    this.#spawnFood(SPAWN_FOOD_TIMEOUT_MS);
    this.update();
  }

  endGame() {
    if (this.onGameEnd) this.onGameEnd(this);
    this.#state = 'lobby';
  }

  #getRandomPosition() {
    const foodPositions = this.#foodPickups.map((foodPickup) => ({
      x: foodPickup.x,
      y: foodPickup.y,
    }));
    const snakePositions = this.snakes.map((snake) => ({
      x: snake.headX,
      y: snake.headY,
    }));
    const projectedSnakePositions = this.snakes.map((snake) =>
      snake.getProjectedPosition(),
    );

    const invalidPositions = [
      ...foodPositions,
      ...snakePositions,
      ...projectedSnakePositions,
    ];
    let randomPosition = { x: 0, y: 0 };
    let isInvalid = true;

    generateRandom: while (isInvalid) {
      randomPosition = {
        x: loopInt(MIN_POS, MAX_POS, (MAX_POS - MIN_POS) * Math.random()),
        y: loopInt(MIN_POS, MAX_POS, (MAX_POS - MIN_POS) * Math.random()),
      };
      // Check this does not conflict with positions of existing items.
      for (let i = 0; i < invalidPositions.length; i++) {
        const current = invalidPositions[i];
        if (randomPosition.x === current.x && randomPosition.y === current.y) {
          // If current randomPosition conflicts with existing item, skip the
          // rest of the while loop and generate a new random number.
          continue generateRandom;
        }
      }
      isInvalid = false;
    }
    return randomPosition;
  }

  #spawnFood(delay) {
    clearTimeout(this.#spawnFoodTimeout);
    this.#spawnFoodTimeout = setTimeout(() => {
      const randomPosition = this.#getRandomPosition();
      this.#foodPickups.push(randomPosition);
    }, delay);
  }

  #createPlayerSnakes() {
    const players = [...this.#players.values()];
    for (let i = 0; i < players.length; i++) {
      const { x, y, direction } = SNAKE_SETUP_DATA[i];
      players[i].snake = new Snake(x, y, 3, direction);
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

      const { x: newX, y: newY } = snake.getProjectedPosition();

      // Collision detection for food pickups.
      for (const foodPickup of this.#foodPickups) {
        if (newX === foodPickup.x && newY === foodPickup.y) {
          // On the next update, the snake will not delete its tail in order to match the target length.
          snake.targetLength++;
          // Get rid of the food pickup that has been gobbled by the snake.
          this.#foodPickups = this.#foodPickups.filter(
            (pickup) => pickup !== foodPickup,
          );
          // Spawn another in after a delay.
          this.#spawnFood(SPAWN_FOOD_TIMEOUT_MS);
        }
      }

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
        break;
      }
    }
  }
}

module.exports = Game;
