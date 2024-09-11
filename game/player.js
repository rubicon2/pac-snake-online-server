class Player {
  constructor(name, ws, color) {
    this.name = name;
    this.ws = ws;
    this.color = color;
    this.ready = false;
    this.roundsWon = 0;
    this.snake = null;
    this.longestSnakeLength = 3;
    this.killCount = 0;
    this.deathCount = 0;
  }

  packageData() {
    return {
      name: this.name,
      color: this.color,
      ready: this.ready,
      roundsWon: this.roundsWon,
      longestSnakeLength: this.longestSnakeLength,
      killCount: this.killCount,
      deathCount: this.deathCount,
      snake: this.snake ? this.snake.packageData() : null,
    };
  }
}

module.exports = Player;
