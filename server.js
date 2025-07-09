const express = require('express');
const cors = require('cors');
const path = require("path");

const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const mysql = require('mysql2');
dotenv.config();

// --- NEW: Firebase Admin SDK Imports and Initialization ---
const admin = require('firebase-admin'); // Import firebase-admin

// IMPORTANT: Replace './config/your-firebase-adminsdk.json' with the actual path
// to your downloaded Firebase service account key file.
const serviceAccount = require('./schoolbusalert-97794-firebase-adminsdk-fbsvc-01aa78e2c3.json'); 

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
console.log('✅ Firebase Admin SDK initialized successfully.');
// --- END NEW ---


const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Middlewares
app.use(cors());
app.use(bodyParser.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Routes

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

// Attempt to connect to the database when the server starts
db.connect((err) => {
  if (err) {
    console.error('MySQL connection error:', err);
    // You might want to exit the process or handle this more gracefully
    // depending on whether your app can function without a DB connection.
    process.exit(1); // Exit if DB connection fails critical
  } else {
    console.log('MySQL connected ✅');

    // MODIFIED: Pass the 'admin' object along with 'db' to your routes
    // This allows your routes to access Firebase Admin SDK functionalities
    const apiRoutes = require('./routes')(db, admin); // Pass both db and admin
    app.use('/api', apiRoutes); // Mount your API routes under '/api'

    // Server listen
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} 🚀`);
    });
  }
});