const express = require('express');
require('dotenv').config();

const PORT = process.env.PORT || 80;

const app = express();

app.get('/', (req, res) => {
  res.send('<h1>Hello, world</h1>');
});

app.listen(PORT);
