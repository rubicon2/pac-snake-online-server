const { loopInt } = require('loop-range');
const { MIN_POS, MAX_POS } = require('./data');

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
    const chunks = [];
    const xMult =
      this.initialMoveDir === 'left'
        ? 1
        : this.initialMoveDir === 'right'
          ? -1
          : 0;
    const yMult =
      this.initialMoveDir === 'up'
        ? 1
        : this.initialMoveDir === 'down'
          ? -1
          : 0;
    for (let i = 0; i < this.startLength; i++) {
      const x = loopInt(MIN_POS, MAX_POS, this.headX + i * xMult);
      const y = loopInt(MIN_POS, MAX_POS, this.headY + i * yMult);
      chunks.push(new Chunk(x, y));
    }
    return chunks;
  }

  kill() {
    this.isAlive = false;
    this.chunks = [];
  }

  handleInput(direction) {
    switch (this.lastMoveDir) {
      case 'up': {
        if (direction !== 'down') this.nextMoveDir = direction;
        break;
      }
      case 'down': {
        if (direction !== 'up') this.nextMoveDir = direction;
        break;
      }
      case 'left': {
        if (direction !== 'right') this.nextMoveDir = direction;
        break;
      }
      case 'right': {
        if (direction !== 'left') this.nextMoveDir = direction;
        break;
      }
    }
  }

  getProjectedPosition() {
    const x = loopInt(
      MIN_POS,
      MAX_POS,
      this.headX +
        1 *
          (this.nextMoveDir === 'right'
            ? 1
            : this.nextMoveDir === 'left'
              ? -1
              : 0),
    );
    const y = loopInt(
      MIN_POS,
      MAX_POS,
      this.headY +
        1 *
          (this.nextMoveDir === 'up'
            ? -1
            : this.nextMoveDir === 'down'
              ? 1
              : 0),
    );
    return { x, y };
  }

  moveTo(x, y) {
    this.headX = x;
    this.headY = y;
    this.chunks.unshift(new Chunk(x, y));
    this.lastMoveDir = this.nextMoveDir;
  }

  packageData() {
    return {
      headX: this.headX,
      headY: this.headY,
      dir: this.lastMoveDir,
      isAlive: this.isAlive,
      chunks: this.chunks,
    };
  }
}

class Chunk {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}

module.exports = Snake;
