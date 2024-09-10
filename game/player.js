class Player {
  constructor(name, ws) {
    this.name = name;
    this.ws = ws;
    this.ready = false;
    this.roundsWon = 0;
    this.snake = null;
  }

  packageData() {
    return {
      name: this.name,
      ready: this.ready,
      roundsWon: this.roundsWon,
      snake: this.snake ? this.snake.packageData() : null,
    };
  }
}

module.exports = Player;
