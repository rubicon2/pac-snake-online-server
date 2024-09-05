class Player {
  ready = false;
  constructor(name, ws) {
    this.name = name;
    this.ws = ws;
    this.direction = 'up';
  }

  handleDirection(direction) {
    this.direction = direction;
  }

  packageData() {
    return {
      name: this.name,
      ready: this.ready,
    };
  }
}

module.exports = Player;
