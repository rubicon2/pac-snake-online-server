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
const MIN_PLAYERS = process.env.MIN_PLAYERS || 2;

class Game {
  #updateTimeout = null;
  #spawnFoodTimeout = null;
  #roundOverTimeout = null;
  #countdownInterval = null;

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
      this.onGameEvent('game_state_updated', this);
    }
  }
  removePlayer(id) {
    this.#players.delete(id);
    this.onGameEvent('game_state_updated', this);
    if (this.#players.size < MIN_PLAYERS) this.endGame();
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
    if (this.#players.size < MIN_PLAYERS) return false;
    const allPlayers = this.#players.values();
    for (const player of allPlayers) {
      if (!player.ready) return false;
    }
    return true;
  }

  #foodPickups = [];

  #countdownValue = 3;
  #lastRoundWinner = null;

  #currentRound = 0;
  get currentRound() {
    return this.#currentRound;
  }
  nextRound() {
    this.#currentRound++;
    this.onGameEvent('game_round_started', this);
  }

  constructor(
    // So that we don't need to check if onGameEvent exists literally every time we want to use it.
    // Considered having a function that throws an error, to avoid strange errors where someone might forget
    // to supply an onGameEvent argument, but decided against it - game class shouldn't care what onGameEvent
    // does, if it does anything at all.
    onGameEvent = () => {},
    roundsToWin = 3,
    speed = UPDATE_INTERVAL_MS,
  ) {
    this.onGameEvent = onGameEvent;
    this.roundsToWin = roundsToWin;
    this.speed = speed;
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
      countdownValue: this.#countdownValue,
      currentRound: this.#currentRound,
      lastRoundWinner: this.#lastRoundWinner,
    };
  }

  #resetPlayerStats() {
    for (const player of this.#players.values()) {
      player.longestSnakeLength = 0;
      player.killCount = 0;
      player.deathCount = 0;
    }
  }

  startGame() {
    if (this.#players.size < MIN_PLAYERS) {
      throw new Error(
        `Cannot start a game with less than ${MIN_PLAYERS} players.`,
      );
    }
    this.#resetPlayerStats();
    this.onGameEvent('game_started', this);
    this.#startRound();
  }

  #startRound() {
    // Reset game objects.
    this.#foodPickups = [];
    this.#createPlayerSnakes();
    // Do a countdown and let the clients know it is starting.
    this.#startCountdown();
  }

  #startCountdown() {
    this.#state = 'countdown';
    this.#countdownValue = 3;
    this.onGameEvent('game_round_countdown_started', this);
    // Then start the loop.
    clearInterval(this.#countdownInterval);
    this.#countdownInterval = setInterval(() => {
      if (this.#countdownValue === 'GO!') {
        clearInterval(this.#countdownInterval);
        this.#state = 'running';
        this.onGameEvent('game_round_started', this);
        this.#spawnFood(SPAWN_FOOD_TIMEOUT_MS);
        this.update();
      } else {
        this.#countdownValue--;
        if (this.#countdownValue === 0) this.#countdownValue = 'GO!';
      }
      this.onGameEvent('game_round_countdown_updated', this);
    }, 1000);
  }

  endGame() {
    this.#state = 'lobby';
    for (const player of this.#players.values()) {
      player.ready = false;
    }
    this.onGameEvent('game_ended', this);
  }

  #getRandomPosition() {
    const foodPositions = this.#foodPickups.map((foodPickup) => ({
      x: foodPickup.x,
      y: foodPickup.y,
    }));
    // Get chunk arrays from each snake and then concat into a single array.
    const chunkPositions = this.snakes
      .map((snake) => snake.chunks)
      .reduce((all, chunks) => [...all, ...chunks], []);
    const projectedSnakePositions = this.snakes.map((snake) =>
      snake.getProjectedPosition(),
    );

    const invalidPositions = [
      ...foodPositions,
      ...chunkPositions,
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

  #getRoundWinner() {
    const alivePlayers = [...this.#players.values()].filter(
      (player) => player.snake.isAlive,
    );
    if (alivePlayers.length === 1) {
      const lastPlayerStanding = alivePlayers[0];
      return lastPlayerStanding;
    } else {
      return null;
    }
  }

  #moveSnakes() {
    // Need to do collision checking here and not on player class, as we can check the positions of other snakes only here.
    const playersArray = [...this.#players.values()];

    // Remove the tail of each snake before doing any collision checking.
    // Each snake moves sequentially, but it looks simultaneous - this avoids
    // a player getting killed by a tail that moves out of the way on the same update.
    for (const player of playersArray) {
      const { snake } = player;
      if (snake.chunks.length >= snake.targetLength) snake.chunks.pop();
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
          // Update player's stats for the game if they have set a new record!
          if (player.longestSnakeLength < snake.targetLength)
            player.longestSnakeLength = snake.targetLength;
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
            snake.kill();
            // Update stats for players.
            player.deathCount++;
            otherPlayer.killCount++;
            // Check if a player has won the round and deal with that.
            const roundWinner = this.#getRoundWinner();
            if (roundWinner) {
              roundWinner.roundsWon++;
              this.#lastRoundWinner = roundWinner.name;
              // Check if game is over!
              if (roundWinner.roundsWon >= this.roundsToWin) {
                // Show winner message and game stats.
                this.#state = 'game_over';
                this.onGameEvent('game_over', this);
              } else {
                // If not, do all this stuff...
                this.#state = 'round_over';
                this.onGameEvent('game_round_ended', this);
                clearTimeout(this.#roundOverTimeout);
                this.#roundOverTimeout = setTimeout(() => {
                  this.#startRound();
                }, 5000);
              }
            }
            // If all players are dead and no-one won, deal with that.
            if (this.snakes.length === 0) {
              this.#state = 'round_over';
              this.onGameEvent('game_round_failed', this);
              clearTimeout(this.#roundOverTimeout);
              this.#roundOverTimeout = setTimeout(() => {
                this.#startRound();
              }, 5000);
            }
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
        this.onGameEvent('game_state_updated', this);
        clearTimeout(this.#updateTimeout);
        this.#updateTimeout = setTimeout(
          () => this.update(),
          UPDATE_INTERVAL_MS,
        );
        break;
      }
    }
  }
}

module.exports = Game;
