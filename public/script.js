const socket = new WebSocket('ws://localhost:8080');

const uuid = self.crypto.randomUUID();

let currentLobbyElement = document.getElementById('current-lobby');
let lobbyListElement = document.getElementById('lobby-list');
const messagesElement = document.getElementById('messages');

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
      currentLobbyElement.innerText = `You're in: ${json.lobby_name}`;
      break;
    }

    case 'left_lobby': {
      currentLobbyElement.innerText = `You're in the lobby list`;
      break;
    }

    case 'game_updated': {
      console.log('Game state updated: ', json.game_state);
      // Draw game on screen or whatever.
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

function createMessage(message) {
  const li = document.createElement('li');
  li.innerText = message;
  return li;
}

function createCurrentLobbyHeader(currentLobby) {
  const h2 = document.createElement('h2');
  h2.id = 'current-lobby';
  h2.innerText = currentLobby;
  return h2;
}

function refreshLobbyListItems(element, lobbies) {
  // Remove any existing items.
  const existingListItems = document.querySelectorAll('#lobby-list > li');
  for (const existingListItem of existingListItems) {
    existingListItem.remove();
  }

  // Now make the new ones.
  for (const lobby of lobbies) {
    const { lobby_name, player_count } = lobby;
    const li = document.createElement('li');
    li.innerText = lobby_name;
    li.onclick = () => joinLobby(lobby_name);

    const playerCount = document.createElement('span');
    playerCount.innerText = ` ${player_count}/4`;
    li.appendChild(playerCount);
    element.appendChild(li);
  }
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

function playerReady() {
  socket.send(JSON.stringify({ type: 'player_ready_changed', ready: true }));
}

function playerNotReady() {
  socket.send(JSON.stringify({ type: 'player_ready_changed', ready: false }));
}
