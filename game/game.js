const Player = require('./player');
const Snake = require('./snake');
const { loopInt } = require('loop-range');
const {
  PLAYER_SETUP_DATA,
  SNAKE_SETUP_DATA,
  GAME_SPEEDS,
  SPAWN_FOOD_TIMEOUT_MS,
  MIN_POS,
  MAX_POS,
} = require('./data');

require('dotenv').config();
const MIN_PLAYERS = process.env.MIN_PLAYERS || 1;

class Game {
  #updateTimeout = null;
  #spawnFoodTimeout = null;
  #roundOverTimeout = null;
  #countdownInterval = null;
  #currentSpeedIndex = 1;

  // state can be: 'lobby', 'running', 'countdown', 'round_over', 'game_over'
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
  get alivePlayers() {
    return [...this.#players.values()].filter((player) => player.snake.isAlive);
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
    // If we are reconnecting a player that has been disconnected, update their websocket.
    // Although really, this doesn't need to be here anymore. We could just update all players from here with the ids,
    // plop back onto the gameServer and it can map the ids to the websockets and names of each player...
    // Removes so much jank... WHY DIDN'T I USE THE IDS IN THE FIRST PLACE??
    if (this.#state !== 'lobby' && this.#players.has(id)) {
      this.#players.get(id).ws = ws;
    } else if (this.#state === 'lobby' && this.playerCanJoin(id)) {
      // As color is picked before next player is added to array, do not need to do size - 1!
      // If player leaves, colors must be reassigned.
      const playerColor = PLAYER_SETUP_DATA[this.#players.size].color;
      this.#players.set(id, new Player(name, ws, playerColor));
      this.onGameEvent('game_state_updated', this);
    }
  }
  #reassignPlayerColors() {
    const playerArr = [...this.#players.values()];
    for (let i = 0; i < playerArr.length; i++) {
      playerArr[i].color = PLAYER_SETUP_DATA[i].color;
    }
  }
  removePlayer(id) {
    this.#players.delete(id);
    // Reassign player colors if the game is in the lobby state (i.e. players can still join)
    if (this.#state === 'lobby') {
      this.#reassignPlayerColors();
    }
    this.onGameEvent('game_state_updated', this);
    if (this.#state !== 'lobby' && this.#players.size < MIN_PLAYERS)
      this.endGame();
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

  #countdownValue = 4;
  #lastRoundWinner = null;

  #currentRound = 0;
  get currentRound() {
    return this.#currentRound;
  }

  constructor(
    // So that we don't need to check if onGameEvent exists literally every time we want to use it.
    // Considered having a function that throws an error, to avoid strange errors where someone might forget
    // to supply an onGameEvent argument, but decided against it - game class shouldn't care what onGameEvent
    // does, if it does anything at all.
    name,
    onGameEvent = () => {},
    roundsToWin = 3,
    // index 1 is 'normal' speed.
    speed = GAME_SPEEDS[this.#currentSpeedIndex],
  ) {
    this.name = name;
    this.onGameEvent = onGameEvent;
    this.roundsToWin = roundsToWin;
    this.speed = speed;
  }

  changeSpeed() {
    this.#currentSpeedIndex = loopInt(
      0,
      GAME_SPEEDS.length,
      this.#currentSpeedIndex + 1,
    );
    this.speed = GAME_SPEEDS[this.#currentSpeedIndex];
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
      minPos: MIN_POS,
      maxPos: MAX_POS,
      speed: this.speed,
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
      player.resetStats();
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
    this.#countdownValue = 4;
    this.onGameEvent('game_round_countdown_started', this);
    // Then start the loop.
    clearInterval(this.#countdownInterval);
    this.#countdownInterval = setInterval(() => {
      if (this.#countdownValue <= 0) {
        clearInterval(this.#countdownInterval);
        this.#state = 'running';
        this.onGameEvent('game_round_started', this);
        this.#spawnFood(SPAWN_FOOD_TIMEOUT_MS);
        this.#update();
      } else {
        this.#countdownValue--;
      }
      this.onGameEvent('game_round_countdown_updated', this);
    }, 1000);
  }

  endGame() {
    clearInterval(this.#countdownInterval);
    clearTimeout(this.#roundOverTimeout);
    clearTimeout(this.#roundOverTimeout);
    clearTimeout(this.#updateTimeout);
    this.#state = 'lobby';
    // If any players left during the same and colors could not be reassigned, do it now.
    this.#reassignPlayerColors();
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
      players[i].snake = new Snake(x, y, 3, direction, () => {
        this.onGameEvent('game_state_updated', this);
      });
    }
  }

  #getRoundWinner() {
    const alivePlayers = this.alivePlayers;
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
    const isMultiplayerGame = playersArray.length > 1;

    const projectedPositions = new Map();
    for (const player of playersArray) {
      const { snake } = player;
      // Remove the tail of each snake before doing any collision checking.
      // Each snake moves sequentially, but it looks simultaneous - this avoids
      // a player getting killed by a tail that moves out of the way on the same update.
      if (snake.chunks.length >= snake.targetLength) snake.chunks.pop();
      // Get projected positions of all alive snakes.
      // Make it a map so we can just get these later on in the player loops without recalculating.
      projectedPositions.set(player, {
        position: player.snake.getProjectedPosition(),
        needsToDie: false,
      });
    }

    // See whether any of the projected positions conflict before checking individual snake chunks, etc.
    for (const player of projectedPositions.keys()) {
      // Do not check projected position of a dead snake.
      if (!player.snake.isAlive) continue;

      for (const otherPlayer of projectedPositions.keys()) {
        // Do not check projected position of one snake against itself.
        if (otherPlayer === player) continue;

        // Do not check projected position of a dead snake.
        if (!otherPlayer.snake.isAlive) continue;

        const { x, y } = projectedPositions.get(player).position;
        const { x: otherX, y: otherY } =
          projectedPositions.get(otherPlayer).position;

        // If two snakes are going to go into the same square on the next update.
        if (x === otherX && y === otherY) {
          // Find the longest snake - the winner.
          const playerLength = player.snake.chunks.length;
          const otherLength = otherPlayer.snake.chunks.length;

          if (playerLength >= otherLength) {
            projectedPositions.get(otherPlayer).needsToDie = true;
            // Only want the kill to count if this snake doesn't die too.
            if (playerLength > otherLength) player.killCount++;
          }
        }
      }
    }

    for (const current of projectedPositions) {
      const [player, values] = current;
      if (values.needsToDie) {
        player.snake.kill();
        player.deathCount++;
      }
    }

    // Now actually move snakes if there is nothing in the way, etc.
    for (const player of playersArray) {
      const { snake } = player;
      if (!snake.isAlive) continue;

      const { x: newX, y: newY } = projectedPositions.get(player).position;

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
          }
        }
      }

      // If current snake has collided with something and died, skip the rest of the loop.
      if (!snake.isAlive) continue;

      // If no collisions happened, create new chunk at newX and newY positions.
      snake.moveTo(newX, newY);
    }

    // If this is a multiplayer game, check if a player has won the round and deal with that.
    if (isMultiplayerGame) {
      const roundWinner = this.#getRoundWinner();
      if (roundWinner) {
        roundWinner.roundsWon++;
        this.#lastRoundWinner = roundWinner.name;
        // Check if game is over!
        if (roundWinner.roundsWon >= this.roundsToWin) {
          this.#handleGameOver();
        } else {
          // If not game over, then the round is over.
          this.#handleRoundOver();
        }
      }
    }

    // If all players are dead, deal with that.
    if (this.alivePlayers.length === 0) {
      this.#handleAllSnakesDead(isMultiplayerGame);
    }
  }

  #handleGameOver() {
    // Show winner message and game stats.
    this.#state = 'game_over';
    this.onGameEvent('game_over', this);
    // Go back to lobby after ten seconds.
    setTimeout(() => {
      this.endGame();
    }, 10000);
  }

  #handleRoundOver() {
    this.#state = 'round_over';
    this.onGameEvent('game_round_ended', this);
    clearTimeout(this.#roundOverTimeout);
    this.#roundOverTimeout = setTimeout(() => {
      this.#startRound();
    }, 5000);
  }

  #handleAllSnakesDead(isMultiplayerGame) {
    if (!isMultiplayerGame) {
      // If player dies in a singleplayer game, trigger the stats screen and end the game.
      this.#state = 'game_over';
      this.onGameEvent('single_player_game_over', this);
      setTimeout(() => {
        this.endGame();
      }, 10000);
    } else {
      // If all players are dead in a multiplayer game, trigger failure message and start a new round.
      this.#state = 'round_failed';
      this.onGameEvent('game_round_failed', this);
      clearTimeout(this.#roundOverTimeout);
      this.#roundOverTimeout = setTimeout(() => {
        this.#startRound();
      }, 5000);
    }
  }

  #update() {
    switch (this.#state) {
      case 'running': {
        this.#moveSnakes();
        this.onGameEvent('game_state_updated', this);
        clearTimeout(this.#updateTimeout);
        this.#updateTimeout = setTimeout(() => this.#update(), this.speed.ms);
        break;
      }
    }
  }
}

module.exports = Game;
