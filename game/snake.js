class Snake {
  constructor(originX, originY, startLength, initialMoveDir) {
    this.originX = originX;
    this.originY = originY;
    this.startLength = startLength;
    this.initialMoveDir = initialMoveDir;
    this.lastMoveDir = initialMoveDir;
    this.targetLength = startLength;
    this.chunks = [];
    this.chunks.push(new Chunk(this.originX, this.originY));
  }
}

class Chunk {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

module.exports = Snake;
