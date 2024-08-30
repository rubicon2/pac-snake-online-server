const socket = new WebSocket('ws://localhost:8080');

const uuid = self.crypto.randomUUID();

let messagesElement = document.getElementById('messages');

socket.onopen = () => {
  socket.send(JSON.stringify({ type: 'opened', uuid }));
};

window.onbeforeunload = () => {
  socket.send(JSON.stringify({ type: 'closed', uuid }));
};

socket.onmessage = (event) => {
  const json = JSON.parse(event.data);
  switch (json.type) {
    case 'messages_updated': {
      console.log('Received message updates!');
      messagesElement.remove();
      messagesElement = createMessagesList(json.messages);
      document.body.appendChild(messagesElement);
      break;
    }
  }
};

function createMessagesList(messages) {
  const ul = document.createElement('ul');
  ul.id = 'messages';
  for (const message of messages) {
    const li = document.createElement('li');
    li.innerText = message;
    ul.appendChild(li);
  }
  return ul;
}

function sendMessage(event) {
  event.preventDefault();
  const { message } = Object.fromEntries(
    new FormData(event.currentTarget).entries(),
  );
  socket.send(JSON.stringify({ type: 'message_submitted', message }));
}
