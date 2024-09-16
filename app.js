const express = require('express');
const http = require('http');
const dotenv = require('dotenv');
const gameServer = require('./gameServer');

dotenv.config();
const PORT = process.env.PORT || 3000;

const app = express();
// public/index.html will automatically be sent to the http client.
app.use(express.static('public'));
const server = http.createServer(app);
gameServer(server);
server.listen(PORT);
