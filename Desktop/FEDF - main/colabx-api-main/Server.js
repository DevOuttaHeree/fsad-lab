// Server.js - COMPLETE SERVER CODE WITH SEARCH ENDPOINT

// ------------------------------------------------------------------
// 🎯 0. Module Imports and Initial Setup
// ------------------------------------------------------------------
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = process.env.PORT || 3001; 

// ------------------------------------------------------------------
// 🎯 1. MongoDB Connection Setup
// ------------------------------------------------------------------

// SRV_URI can be used as an optional local fallback.
// NOTE: For deployment, ensure MONGO_URI is set correctly on Render.
const SRV_URI = "mongodb+srv://anjanmahadev02_db_user:Aysspsarma1@colabxcluster.ibqs9ym.mongodb.net/?appName=CoLabXCluster";

// **CRITICAL FIX:** Use the environment variable, falling back to SRV_URI if MONGO_URI isn't set
const uri = process.env.MONGO_URI || SRV_URI; 

const client = new MongoClient(uri, {
    // Fail faster if the connection can't be made
    serverSelectionTimeoutMS: 5000, 
});

let db;
const DB_NAME = 'CoLabX';

async function connectToMongo() {
    try {
        await client.connect();
        db = client.db(DB_NAME);
        console.log("✅ Connected successfully to MongoDB Atlas!");
    } catch (err) {
        console.error("❌ Failed to connect to MongoDB Atlas:", err);
        console.error("Connection URI used:", uri);
        throw err; // Stop server startup if DB fails
    }
}

// Middleware
// 🎯 CRITICAL DEPLOYMENT FIX: CORS configuration
const allowedOrigins = (process.env.CORS_ORIGINS || 'https://colabx-frontend.vercel.app,http://localhost:5500')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

app.use(cors({
    origin: function(origin, callback) {
        if (!origin || allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
        callback(new Error('CORS policy does not allow this origin.'), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl} - Origin: ${req.get('origin') || 'no-origin'}`);
    next();
});

// Start the app only after Mongo connection succeeds.
async function startServer() {
    try {
        await connectToMongo();
        app.listen(port, () => {
            console.log(`Server running on http://localhost:${port}`);
        });
    } catch (err) {
        console.error('Failed to start server due to DB connection error. Exiting.', err);
        // CRITICAL: Exit if DB connection fails
        process.exit(1); 
    }
}

startServer();

// ------------------------------------------------------------------
// 🎯 2. Registration Endpoint (POST /api/register)
// ------------------------------------------------------------------
app.post('/api/register', async (req, res) => {
    const { name, email, password, city, skills, experience, portfolio } = req.body;
    if (!db) return res.status(503).send({ message: "Database service unavailable. Connection failed." });
    if (!email || !password || !name) return res.status(400).send({ message: "Name, email, and password are required." });
    try {
        const existingUser = await db.collection('users').findOne({ email: email });
        if (existingUser) return res.status(409).send({ message: "Account already exists with this email." });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);
        
        let skillsArray = [];
        if (Array.isArray(skills)) skillsArray = skills.map(s => String(s).trim()).filter(Boolean);
        else if (typeof skills === 'string') skillsArray = skills.split(',').map(s => s.trim()).filter(Boolean);

        const newUser = {
            name, email, password: hashedPassword, city: city || '', skills: skillsArray,
            experience: Number(experience) || 0, portfolio: portfolio || '', profilePic: '', createdAt: new Date(),
        };
        const result = await db.collection('users').insertOne(newUser);
        res.status(201).send({ message: "User registered successfully!", uid: result.insertedId });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).send({ message: "Registration failed due to a server error." });
    }
});

// ------------------------------------------------------------------
// 🎯 3. Login Endpoint (POST /api/login)
// ------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!db) return res.status(503).send({ message: "Database service unavailable. Connection failed." });
    if (!email || !password) return res.status(400).send({ message: "Email and password are required." });

    try {
        const user = await db.collection('users').findOne({ email: email });
        if (!user) return res.status(401).send({ message: "Invalid email or password." });
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) return res.status(401).send({ message: "Invalid email or password." });

        delete user.password;
        const userData = { ...user, uid: user._id.toString() };
        delete userData._id;
        res.status(200).send({ message: "Login successful", user: userData });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).send({ message: "Server error during login." });
    }
});

// ... (Profile Fetch/Update Endpoints 4 & 5 remain the same) ...

// ------------------------------------------------------------------
// 🎯 6. All Profiles Endpoint (GET /api/profiles)
// ------------------------------------------------------------------
app.get('/api/profiles', async (req, res) => {
    if (!db) return res.status(503).send({ message: "Database service unavailable. Connection failed." });

    try {
        const profiles = await db.collection('users').find({}).sort({ createdAt: -1 }).toArray();
        const cleanedProfiles = profiles.map(user => {
            delete user.password;
            const userData = { ...user, uid: user._id.toString() };
            delete userData._id;
            return userData;
        });
        res.status(200).send(cleanedProfiles);
    } catch (error) {
        console.error("All profiles fetch error:", error);
        res.status(500).send({ message: "Server error fetching profiles." });
    }
});

// ------------------------------------------------------------------
// 🎯 8. Search Profiles Endpoint (GET /api/search)
// ------------------------------------------------------------------
app.get('/api/search', async (req, res) => {
    // Accept multiple search terms separated by space
    const searchQuery = req.query.query ? req.query.query.trim() : ''; 
    const locationQuery = req.query.location ? req.query.location.trim() : '';

    if (!db) return res.status(503).send({ message: "Database service unavailable." });
    
    // If both search and location are empty, return an empty array (or all profiles, depends on desired behavior)
    if (!searchQuery && !locationQuery) {
        return res.status(200).send([]);
    }

    try {
        const query = {};
        const $or = [];
        
        // Build the search query for Name and Skills
        if (searchQuery) {
            const searchRegex = new RegExp(searchQuery, 'i'); // Case-insensitive
            $or.push(
                { name: { $regex: searchRegex } }, // Search in name
                { skills: { $in: [searchRegex] } } // Search in skills array
            );
        }

        // Build the location query
        if (locationQuery) {
            const locationRegex = new RegExp(locationQuery, 'i');
            $or.push(
                { city: { $regex: locationRegex } } // Search in city/location
            );
        }
        
        // If we have any $or conditions, apply them
        if ($or.length > 0) {
            query.$or = $or;
        }

        const profiles = await db.collection('users').find(query).toArray();

        // Clean up data for the frontend
        const cleanedProfiles = profiles.map(user => {
            delete user.password;
            const userData = { ...user, uid: user._id.toString() };
            delete userData._id;
            return userData;
        });

        res.status(200).send(cleanedProfiles);
    } catch (error) {
        console.error("Search error:", error);
        res.status(500).send({ message: "Server error during search." });
    }
});

// ------------------------------------------------------------------
// 🎯 9. Health & graceful shutdown
// ------------------------------------------------------------------
// Health check endpoint
app.get('/health', (req, res) => {
    if (db) return res.status(200).send({ status: 'ok' });
    return res.status(503).send({ status: 'unavailable' });
});

// Graceful shutdown: close Mongo client before exiting
async function shutdown(signal) {
    console.log(`Received ${signal}. Closing Mongo client and exiting.`);
    try {
        await client.close();
        console.log('Mongo client closed.');
    } catch (err) {
        console.error('Error closing Mongo client:', err);
    }
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));