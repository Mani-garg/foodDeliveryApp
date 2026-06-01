const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const restaurantRoutes = require('./routes/restaurants');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'restaurant-service' });
});

app.use('/api/v1/restaurants', restaurantRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
