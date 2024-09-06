class Player {
  ready = false;
  constructor(name, ws) {
    this.name = name;
    this.ws = ws;
    this.snake = null;
  }

  packageData() {
    return {
      name: this.name,
      ready: this.ready,
    };
  }
}

module.exports = Player;
