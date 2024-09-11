const Color = require('./color');

const PLAYER_SETUP_DATA = [
  { color: new Color(255, 102, 204, 1) },
  { color: new Color(26, 102, 255, 1) },
  { color: new Color(213, 50, 0, 1) },
  { color: new Color(30, 190, 0, 1) },
];

const SNAKE_SETUP_DATA = [
  { x: 1, y: 1, direction: 'up' },
  { x: 8, y: 8, direction: 'down' },
  { x: 8, y: 1, direction: 'right' },
  { x: 1, y: 8, direction: 'left' },
];

// Use an array so these are easy to cycle through.
const GAME_SPEEDS = [
  { name: 'slow', ms: 500 },
  { name: 'normal', ms: 325 },
  { name: 'fast', ms: 200 },
];

const SPAWN_FOOD_TIMEOUT_MS = 5000;

const MIN_POS = 0;
const MAX_POS = 10;

module.exports = {
  PLAYER_SETUP_DATA,
  SNAKE_SETUP_DATA,
  GAME_SPEEDS,
  SPAWN_FOOD_TIMEOUT_MS,
  MIN_POS,
  MAX_POS,
};
