class Snake {
  constructor(originX, originY, startLength, initialMoveDir) {
    this.headX = originX;
    this.headY = originY;
    this.startLength = startLength;
    this.initialMoveDir = initialMoveDir;
    this.nextMoveDir = initialMoveDir;
    this.lastMoveDir = initialMoveDir;
    this.targetLength = startLength;
    this.chunks = this.#createChunks();
    this.isAlive = true;
  }

  #createChunks() {
    // Just do one for now.
    return [new Chunk(this.headX, this.headY)];
  }

  kill() {
    this.isAlive = false;
    this.chunks = [];
  }

  moveTo(x, y) {
    this.headX = x;
    this.headY = y;
    this.chunks.unshift(new Chunk(x, y));
    this.lastMoveDir = this.nextMoveDir;
  }
}

class Chunk {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

module.exports = Snake;
