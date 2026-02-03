const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const DB_FILE = path.join(__dirname, 'users.json');

app.use(cors());
app.use(bodyParser.json());

// Helper to read users
const readUsers = () => {
    if (!fs.existsSync(DB_FILE)) {
        return [];
    }
    const data = fs.readFileSync(DB_FILE, 'utf8');
    try {
        return JSON.parse(data);
    } catch (e) {
        return [];
    }
};

// Helper to write users
const writeUsers = (users) => {
    fs.writeFileSync(DB_FILE, JSON.stringify(users, null, 2));
};

// GET user by email
app.get('/users', (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    const users = readUsers();
    const user = users.find(u => u.email.toLowerCase() === email.toLowerCase());

    if (user) {
        res.json(user);
    } else {
        res.status(404).json({ error: 'User not found' });
    }
});

// CREATE user
app.post('/users', (req, res) => {
    const { email, password_hash, role, full_name, avatar_url } = req.body;

    if (!email || !password_hash || !role) {
        return res.status(400).json({ error: 'Missing fields' });
    }

    const users = readUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
        return res.status(409).json({ error: 'User already exists' });
    }

    const newUser = {
        id: Date.now().toString(),
        email,
        password_hash,
        role,
        full_name: full_name || email.split('@')[0],
        avatar_url,
        created_at: new Date().toISOString()
    };

    users.push(newUser);
    writeUsers(users);

    res.status(201).json(newUser);
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'user-json-store' });
});

app.listen(PORT, () => {
    console.log(`User Service running on port ${PORT}`);
    // Ensure DB file exists
    if (!fs.existsSync(DB_FILE)) {
        writeUsers([]);
        console.log('Created empty users.json');
    }
});
