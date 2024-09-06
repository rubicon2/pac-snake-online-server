const SNAKE_SETUP_DATA = [
  { x: 1, y: 1, direction: 'up' },
  { x: 8, y: 8, direction: 'down' },
  { x: 8, y: 1, direction: 'left' },
  { x: 1, y: 8, direction: 'right' },
];

const MIN_POS = 0;
const MAX_POS = 10;
const UPDATE_INTERVAL_MS = 1000;

module.exports = {
  SNAKE_SETUP_DATA,
  MIN_POS,
  MAX_POS,
  UPDATE_INTERVAL_MS,
};
