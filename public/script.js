// import DOMPurify from '/libs/purify.min.js';
const socket = new WebSocket('ws://localhost:8080');

const uuid = self.crypto.randomUUID();

let pageContentElement = document.getElementById('content');
let currentLobbyElement = document.getElementById('current-lobby');
const clientNameElement = document.getElementById('client-name');
let lobbyListElement = document.getElementById('lobby-list');
const messagesElement = document.getElementById('messages');
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
      pageContentElement = createLobbiesPage();
      document.body.appendChild(pageContentElement);
      break;
    }

    case 'game_round_countdown_started': {
      if (gameAreaElement) {
        // Draw initial game state, i.e. snakes.
        refreshGamePage(json.game_state);
        // Draw countdown over screen.
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

  const h2 = document.createElement('h2');
  h2.id = 'client-name';
  div.appendChild(h2);

  const currentLobbyHeader = createCurrentLobbyHeader('default');
  div.appendChild(currentLobbyHeader);

  const readyButton = document.createElement('button');
  readyButton.type = 'button';
  readyButton.onclick = playerReady;
  readyButton.textContent = 'Ready';
  div.appendChild(readyButton);

  const notReadyButton = document.createElement('button');
  notReadyButton.type = 'button';
  notReadyButton.onclick = playerNotReady;
  notReadyButton.textContent = 'Not Ready';
  div.appendChild(notReadyButton);

  const leaveLobbyButton = document.createElement('button');
  leaveLobbyButton.type = 'button';
  leaveLobbyButton.onclick = leaveLobby;
  leaveLobbyButton.textContent = 'Leave Lobby';
  div.appendChild(leaveLobbyButton);

  return div;
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

function createSnakeChunk(x, y) {
  const div = document.createElement('div');
  div.classList.add('game-obj');
  div.classList.add('snake-chunk');
  div.style.left = `${x * 80}px`;
  div.style.top = `${y * 80}px`;
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
    const { chunks } = player.snake;
    for (const chunk of chunks) {
      const chunkElement = createSnakeChunk(chunk.x, chunk.y);
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

function createMessage(message) {
  const li = document.createElement('li');
  li.innerText = message;
  return li;
}

function createCurrentLobbyHeader(currentLobby) {
  const h2 = document.createElement('h2');
  h2.id = 'current-lobby';
  h2.innerText = validator.escape(currentLobby);
  return h2;
}

function refreshLobbyHeader(element, lobbyName) {
  element.innerText = "You're in: ";
  const strong = document.createElement('strong');
  strong.innerText = validator.escape(lobbyName);
  element.appendChild(strong);
}

function refreshLobbyListItems(element, lobbies) {
  // Remove any existing items.
  const existingListItems = document.querySelectorAll('#lobby-list > li');
  for (const existingListItem of existingListItems) {
    existingListItem.remove();
  }

  // Now make the new ones.
  for (const lobby of lobbies) {
    const { lobby_name, player_count, players } = lobby;
    const li = document.createElement('li');
    li.innerText = lobby_name;

    const playerCount = document.createElement('span');
    playerCount.innerText = ` ${player_count}/4`;
    li.appendChild(playerCount);

    const joinButton = document.createElement('button');
    joinButton.innerText = 'Join';
    joinButton.onclick = () => joinLobby(lobby_name);
    li.appendChild(joinButton);

    const closeButton = document.createElement('button');
    closeButton.innerText = 'Close';
    closeButton.onclick = () => closeLobby(lobby_name);
    li.appendChild(closeButton);

    if (Object.keys(players).length > 0)
      li.appendChild(createLobbyPlayerList(Object.values(players)));

    element.appendChild(li);
  }
}

function createLobbyPlayerList(players) {
  const ul = document.createElement('ul');
  for (const player of players) {
    const li = document.createElement('li');
    li.innerText = `${player.name} - ${player.ready ? 'READY' : 'NOT READY'}`;
    ul.appendChild(li);
  }
  return ul;
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

function playerReady() {
  socket.send(JSON.stringify({ type: 'player_ready_changed', ready: true }));
}

function playerNotReady() {
  socket.send(JSON.stringify({ type: 'player_ready_changed', ready: false }));
}
