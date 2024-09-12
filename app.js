const express = require('express');
const gameServer = require('./gameServer');

require('dotenv').config();
const PORT = process.env.PORT || 3000;

const app = express();
// public/index.html will automatically be sent to the http client.
app.use(express.static('public'));
const wss = gameServer(app, PORT);
