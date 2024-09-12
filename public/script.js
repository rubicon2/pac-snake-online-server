// import DOMPurify from '/libs/purify.min.js';
const socket = new WebSocket('ws://localhost:8080');

// Feel like the server should generate a uuid and send back to client when they connect?
// Stop malicious users generating their own uuids.
// But if the uuid is saved to the user's cookies, they would be able to edit it anyway...

// How about, if there is a cookie for the uuid that is sent, if not the server generates a UUID and sends it back to the client.
// Then the client saves to cookies, and the server also adds it to a set of approved uuids.
// When the client tries to connect, the server will only allow the connection if the uuid provided by the client exists in the server's uuid set.
const uuid = self.crypto.randomUUID();

let pageContentElement = document.getElementById('content');
let currentLobbyElement = document.getElementById('current-lobby');
let clientNameElement = document.getElementById('client-name');
let lobbyListElement = document.getElementById('lobby-list');
let messagesElement = document.getElementById('messages');
let gameAreaElement = document.getElementById('game-area');
let gameOverlayElement = null;

socket.onopen = () => {
  socket.send(JSON.stringify({ type: 'opened', uuid }));
};

window.onbeforeunload = () => {
  socket.send(JSON.stringify({ type: 'closed', uuid }));
};

addEventListener('keydown', (event) => {
  const { key } = event;
  switch (key) {
    case 'w': {
      socket.send(
        JSON.stringify({ type: 'player_direction_changed', direction: 'up' }),
      );
      break;
    }

    case 'a': {
      socket.send(
        JSON.stringify({ type: 'player_direction_changed', direction: 'left' }),
      );
      break;
    }

    case 's': {
      socket.send(
        JSON.stringify({ type: 'player_direction_changed', direction: 'down' }),
      );
      break;
    }

    case 'd': {
      socket.send(
        JSON.stringify({
          type: 'player_direction_changed',
          direction: 'right',
        }),
      );
      break;
    }

    case 'r': {
      socket.send(
        JSON.stringify({
          type: 'player_ready_toggled',
        }),
      );
    }
  }
});

socket.onmessage = (event) => {
  const json = JSON.parse(event.data);
  switch (json.type) {
    case 'lobby_list_updated': {
      refreshLobbyListItems(lobbyListElement, json.lobbies);
      break;
    }

    case 'lobby_header_updated': {
      refreshLobbyHeader(currentLobbyElement, json.lobby_name);
      break;
    }

    case 'joined_lobby': {
      refreshLobbyHeader(currentLobbyElement, json.lobby_name);
      break;
    }

    case 'left_lobby': {
      refreshLobbyHeader(currentLobbyElement, 'the lobby list');
      break;
    }

    case 'name_updated': {
      clientNameElement.textContent = `Hey, ${validator.escape(json.client_name)}!`;
      break;
    }

    case 'game_started': {
      // Show the game screen.
      pageContentElement.remove();
      pageContentElement = createGamePage(json.game_state);
      document.body.appendChild(pageContentElement);
      break;
    }

    case 'game_ended': {
      // Show the lobby screen.
      pageContentElement.remove();
      // Will be filled with default information.
      pageContentElement = createLobbiesPage();
      document.body.appendChild(pageContentElement);
      // Get lobby info from server, which will respond with lobby_header_updated and lobby_list_updated events.
      requestLobbyHeaderUpdate();
      requestLobbyListUpdate();
      break;
    }

    case 'game_round_countdown_started': {
      if (gameAreaElement) {
        // Draw initial game state, i.e. snakes.
        refreshGamePage(json.game_state);
        // Draw countdown over screen.
        if (gameOverlayElement) gameOverlayElement.remove();
        gameOverlayElement = createGameOverlay();
        refreshGameOverlay(json.game_state);
        gameAreaElement.appendChild(gameOverlayElement);
      }
      break;
    }

    case 'game_round_countdown_updated': {
      if (gameOverlayElement) {
        refreshGameOverlay(json.game_state);
      }
      break;
    }

    case 'game_round_started': {
      // Clear off countdown.
      if (gameOverlayElement) gameOverlayElement.remove();
      break;
    }

    case 'game_round_ended': {
      if (gameOverlayElement) gameOverlayElement.remove();
      gameOverlayElement = createGameOverlay();
      gameOverlayElement.innerText = `${json.game_state.lastRoundWinner.toUpperCase()} WON THE ROUND`;
      gameAreaElement.appendChild(gameOverlayElement);
      break;
    }

    case 'game_round_failed': {
      if (gameOverlayElement) gameOverlayElement.remove();
      gameOverlayElement = createGameOverlay();
      gameOverlayElement.innerText = `NOBODY WON THE ROUND...`;
      gameAreaElement.appendChild(gameOverlayElement);
      break;
    }

    case 'game_over': {
      // Show name of winner and any stats.
      if (gameOverlayElement) gameOverlayElement.remove();
      gameOverlayElement = createGameOverlay();
      gameOverlayElement.appendChild(createGameOverInfo(json.game_state));
      gameAreaElement.appendChild(gameOverlayElement);
      break;
    }

    case 'single_player_game_over': {
      if (gameOverlayElement) gameOverlayElement.remove();
      gameOverlayElement = createGameOverlay();
      gameOverlayElement.textContent = 'GAME OVER';
      gameAreaElement.appendChild(gameOverlayElement);
      break;
    }

    case 'game_state_updated': {
      // Update the game display.
      if (gameAreaElement) refreshGamePage(json.game_state);
      break;
    }

    case 'message_received': {
      messagesElement.appendChild(
        createMessage(
          `${new Date(Date.now()).toLocaleTimeString()} - ${json.message}`,
        ),
      );
      break;
    }
  }
};

function createLobbiesPage() {
  const div = document.createElement('div');
  div.id = 'content';
  div.classList.add('screen-height');

  const h1 = document.createElement('h1');
  h1.textContent = 'Pac-Snake Online';
  div.appendChild(h1);

  // Top level ref for later access.
  clientNameElement = document.createElement('h2');
  clientNameElement.id = 'client-name';
  div.appendChild(clientNameElement);

  // Top level ref for later access.
  currentLobbyElement = createCurrentLobbyHeader();
  refreshLobbyHeader(currentLobbyElement, 'the lobby list');
  div.appendChild(currentLobbyElement);

  const lobbyControls = document.createElement('div');
  lobbyControls.classList.add('lobby-controls');
  div.appendChild(lobbyControls);

  const mainButtons = document.createElement('div');
  mainButtons.classList.add('buttons-horizontal');
  lobbyControls.appendChild(mainButtons);

  const readyButton = document.createElement('button');
  readyButton.type = 'button';
  readyButton.onclick = playerReady;
  readyButton.textContent = 'Ready';
  mainButtons.appendChild(readyButton);

  const notReadyButton = document.createElement('button');
  notReadyButton.type = 'button';
  notReadyButton.onclick = playerNotReady;
  notReadyButton.textContent = 'Not Ready';
  mainButtons.appendChild(notReadyButton);

  const leaveLobbyButton = document.createElement('button');
  leaveLobbyButton.type = 'button';
  leaveLobbyButton.onclick = leaveLobby;
  leaveLobbyButton.textContent = 'Leave Lobby';
  mainButtons.appendChild(leaveLobbyButton);

  const nameChangeForm = document.createElement('form');
  nameChangeForm.classList.add('lobby-form');
  nameChangeForm.onsubmit = requestNameChange;
  lobbyControls.appendChild(nameChangeForm);

  const nameLabel = document.createElement('label');
  nameLabel.htmlFor = 'client-name';
  nameLabel.textContent = 'Player name:';
  nameChangeForm.appendChild(nameLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'client-name';
  nameInput.name = 'client_name';
  nameInput.autocomplete = 'off';
  nameChangeForm.appendChild(nameInput);

  const nameSubmit = document.createElement('button');
  nameSubmit.textContent = 'Set Name';
  nameChangeForm.appendChild(nameSubmit);

  const lobbyForm = document.createElement('form');
  lobbyForm.classList.add('lobby-form');
  lobbyForm.onsubmit = requestNewLobby;
  lobbyControls.appendChild(lobbyForm);

  const lobbyNameLabel = document.createElement('label');
  lobbyNameLabel.htmlFor = 'lobby-name';
  lobbyNameLabel.textContent = 'Lobby name:';
  lobbyForm.appendChild(lobbyNameLabel);

  const lobbyNameInput = document.createElement('input');
  lobbyNameInput.type = 'text';
  lobbyNameInput.id = 'lobby-name';
  lobbyNameInput.name = 'lobby_name';
  lobbyNameInput.autocomplete = 'off';
  lobbyForm.appendChild(lobbyNameInput);

  const lobbySubmit = document.createElement('button');
  lobbySubmit.textContent = 'Create New Lobby';
  lobbyForm.appendChild(lobbySubmit);

  // Use top-level ref so we can access later.
  lobbyListElement = document.createElement('ul');
  lobbyListElement.id = 'lobby-list';
  div.appendChild(lobbyListElement);

  // Use top-level ref so we can access later.
  messagesElement = document.createElement('ul');
  messagesElement.id = 'messages';
  div.appendChild(messagesElement);

  return div;
}

function createGameOverInfo(game_state) {
  const div = document.createElement('div');
  div.classList.add('game-over-info');

  const winnerText = document.createElement('div');
  winnerText.classList.add('winner-text');
  winnerText.textContent = `${game_state.lastRoundWinner.toUpperCase()} WON THE GAME`;
  div.appendChild(winnerText);

  const statsContainer = document.createElement('stats-container');
  statsContainer.classList.add('stats-container');
  div.appendChild(statsContainer);

  const longestSnakePlayer = findPlayerWithLongestSnake(game_state.players);
  statsContainer.appendChild(createStatTitle('LONGEST SNAKE:'));
  statsContainer.appendChild(
    createStatValue(
      `${longestSnakePlayer.name.toUpperCase()} WITH ${longestSnakePlayer.longestSnakeLength}`,
    ),
  );

  const mostKillsPlayer = findPlayerWithMostKills(game_state.players);
  statsContainer.appendChild(createStatTitle('MOST KILLS:'));
  statsContainer.appendChild(
    createStatValue(
      `${mostKillsPlayer.name.toUpperCase()} WITH ${mostKillsPlayer.killCount} KILLS`,
    ),
  );

  const mostDeathsPlayer = findPlayerWithMostDeaths(game_state.players);
  statsContainer.appendChild(createStatTitle('MOST DEATHS: '));
  statsContainer.appendChild(
    createStatValue(
      `${mostDeathsPlayer.name.toUpperCase()} WITH ${mostDeathsPlayer.deathCount} DEATHS`,
    ),
  );

  return div;
}

function createStatTitle(statTitle) {
  const div = document.createElement('div');
  div.classList.add('stats-label');
  div.textContent = statTitle;
  return div;
}

function createStatValue(statValue) {
  const div = document.createElement('div');
  div.classList.add('stats-value');
  div.textContent = statValue;
  return div;
}

function findPlayerWithLongestSnake(players) {
  return Object.values(players).sort(
    (a, b) => b.longestSnakeLength - a.longestSnakeLength,
  )[0];
}

function findPlayerWithMostKills(players) {
  return Object.values(players).sort((a, b) => b.killCount - a.killCount)[0];
}

function findPlayerWithMostDeaths(players) {
  return Object.values(players).sort((a, b) => b.deathCount - a.deathCount)[0];
}

function createGameOverlay() {
  const div = document.createElement('div');
  div.classList.add('overlay');
  return div;
}

function refreshGameOverlay(game_state) {
  if (gameOverlayElement) {
    gameOverlayElement.textContent = game_state.countdownValue;
  }
}

function createGameArea() {
  const div = document.createElement('div');
  div.id = 'game-area';
  return div;
}

function createGamePage() {
  const div = document.createElement('div');
  div.id = 'content';
  gameAreaElement = createGameArea();
  div.appendChild(gameAreaElement);
  return div;
}

function createSnakeChunk(x, y, color) {
  const div = document.createElement('div');
  div.classList.add('game-obj');
  div.classList.add('snake-chunk');
  div.style.left = `${x * 80}px`;
  div.style.top = `${y * 80}px`;
  div.style.backgroundColor = color;
  return div;
}

function createFood(x, y) {
  const div = document.createElement('div');
  div.classList.add('game-obj');
  div.classList.add('food');
  div.style.left = `${x * 80 + 25}px`;
  div.style.top = `${y * 80 + 25}px`;
  return div;
}

function refreshGamePage(game_state) {
  // Remove all existing game objects.
  const existingChunks = gameAreaElement.querySelectorAll('.game-obj');
  for (const chunk of existingChunks) {
    chunk.remove();
  }

  const { state, players, foodPickups, currentRound } = game_state;

  // Create new snake chunks.
  for (const player of Object.values(players)) {
    const { color } = player;
    const { chunks, dir } = player.snake;
    for (const chunk of chunks) {
      const chunkElement = createSnakeChunk(
        chunk.x,
        chunk.y,
        randomisedColorToString(color),
      );
      const isHead =
        chunk.x === player.snake.headX && chunk.y === player.snake.headY;
      if (isHead) chunkElement.classList.add('snake-head', dir);
      gameAreaElement.appendChild(chunkElement);
    }
  }

  // Create food.
  for (const foodPickup of foodPickups) {
    const { x, y } = foodPickup;
    const foodElement = createFood(x, y);
    gameAreaElement.appendChild(foodElement);
  }
}

function randomisedColorToString(color) {
  const r = color.r * Math.max(Math.random(), 0.8);
  const g = color.g * Math.max(Math.random(), 0.8);
  const b = color.b * Math.max(Math.random(), 0.8);
  const a = Math.max(Math.random(), 0.8);
  return colorToString({ r, g, b, a });
}

function colorToString(color) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a})`;
}

function createMessage(message) {
  const li = document.createElement('li');
  li.innerText = message;
  return li;
}

function createCurrentLobbyHeader() {
  const p = document.createElement('p');
  p.id = 'current-lobby';
  return p;
}

function refreshLobbyHeader(element, lobbyName) {
  element.innerText = "You're in: ";
  const strong = document.createElement('strong');
  if (lobbyName != '') {
    strong.innerText = validator.escape(lobbyName);
  } else {
    strong.innerText = 'the lobby list';
  }
  element.appendChild(strong);
}

function refreshLobbyListItems(element, lobbies) {
  // Remove any existing items.
  const existingListItems = document.querySelectorAll('#lobby-list > li');
  const existingListSeparators = document.querySelectorAll(
    '.lobby-list-separator',
  );
  for (const existingListItem of [
    ...existingListItems,
    ...existingListSeparators,
  ]) {
    existingListItem.remove();
  }

  // Now make the new ones.
  for (const lobby of lobbies) {
    const { lobby_name, lobby_state, players } = lobby;
    const isGameRunning = lobby_state != 'lobby';

    const li = document.createElement('li');
    li.innerText = lobby_name;

    const lobbyInfo = createLobbyInfo(lobby, isGameRunning);
    li.appendChild(lobbyInfo);

    if (Object.keys(players).length > 0)
      li.appendChild(
        createLobbyPlayerList(Object.values(players), isGameRunning),
      );

    element.appendChild(li);

    const separator = document.createElement('div');
    separator.classList.add('lobby-list-separator');
    element.appendChild(separator);
  }
}

function createLobbyInfo(lobby, isGameRunning) {
  const { lobby_name, lobby_speed, player_count } = lobby;

  const div = document.createElement('div');
  div.classList.add('lobby-info');

  const mainInfo = document.createElement('div');
  div.appendChild(mainInfo);

  const gameStatusText = isGameRunning
    ? 'RUNNING'
    : player_count === 4
      ? 'FULL'
      : 'JOINABLE';

  const playerCount = document.createElement('span');
  playerCount.innerText = ` ${player_count}/4 - ${gameStatusText}`;
  mainInfo.appendChild(playerCount);

  const lobbyButtons = document.createElement('div');
  lobbyButtons.classList.add('buttons-horizontal');
  div.appendChild(lobbyButtons);

  const joinButton = document.createElement('button');
  joinButton.innerText = 'Join';
  joinButton.onclick = () => joinLobby(lobby_name);
  joinButton.disabled = isGameRunning;
  lobbyButtons.appendChild(joinButton);

  const closeButton = document.createElement('button');
  closeButton.innerText = 'Close';
  closeButton.onclick = () => closeLobby(lobby_name);
  closeButton.disabled = isGameRunning;
  lobbyButtons.appendChild(closeButton);

  const changeSpeedButton = document.createElement('button');
  changeSpeedButton.classList.add('speed-change-button');
  changeSpeedButton.innerText = lobby_speed.name;
  changeSpeedButton.onclick = () => changeLobbySpeed(lobby_name);
  changeSpeedButton.disabled = isGameRunning;
  lobbyButtons.appendChild(changeSpeedButton);

  return div;
}

function createLobbyPlayerList(players, isGameRunning) {
  const ul = document.createElement('ul');
  ul.classList.add('lobby-player-list');
  for (const player of players) {
    const li = document.createElement('li');
    li.style.backgroundColor = colorToString(player.color);
    li.innerText = `${player.name}`;

    const statusText = isGameRunning
      ? 'PLAYING'
      : player.ready
        ? 'READY'
        : 'NOT READY';

    const statusDisplay = document.createElement('div');
    statusDisplay.textContent = statusText;
    li.appendChild(statusDisplay);
    ul.appendChild(li);
  }
  return ul;
}

function requestLobbyHeaderUpdate() {
  socket.send(JSON.stringify({ type: 'lobby_header_update_request' }));
}

function requestLobbyListUpdate() {
  socket.send(JSON.stringify({ type: 'lobby_list_update_request' }));
}

function requestNameChange(event) {
  event.preventDefault();
  const { client_name } = Object.fromEntries(
    new FormData(event.currentTarget).entries(),
  );
  socket.send(JSON.stringify({ type: 'name_change_requested', client_name }));
}

function requestNewLobby(event) {
  event.preventDefault();
  const { lobby_name } = Object.fromEntries(
    new FormData(event.currentTarget).entries(),
  );
  socket.send(JSON.stringify({ type: 'new_lobby_requested', lobby_name }));
}

function joinLobby(lobby_name) {
  socket.send(
    JSON.stringify({ type: 'player_join_lobby_request', lobby_name }),
  );
}

function leaveLobby() {
  socket.send(JSON.stringify({ type: 'player_leave_lobby_request' }));
}

function closeLobby(lobby_name) {
  socket.send(JSON.stringify({ type: 'close_lobby_request', lobby_name }));
}

function changeLobbySpeed(lobby_name) {
  socket.send(
    JSON.stringify({ type: 'change_lobby_speed_request', lobby_name }),
  );
}

function playerReady() {
  socket.send(JSON.stringify({ type: 'player_ready_changed', ready: true }));
}

function playerNotReady() {
  socket.send(JSON.stringify({ type: 'player_ready_changed', ready: false }));
}

pageContentElement = createLobbiesPage();
document.body.appendChild(pageContentElement);
