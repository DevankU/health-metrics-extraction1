const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// User Service URL (VM3)
const USER_SERVICE_URL = process.env.USER_SERVICE_URL || 'http://localhost:4000';

// Helper to call User Service
async function getUser(email) {
    try {
        const response = await fetch(`${USER_SERVICE_URL}/users?email=${encodeURIComponent(email)}`);
        if (!response.ok) return null;
        return await response.json();
    } catch (error) {
        console.error('User Service Error:', error);
        return null; // Return null on error so logic proceeds (or change to throw if critical)
    }
}

async function createUser(userData) {
    const response = await fetch(`${USER_SERVICE_URL}/users`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
    });

    if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to create user');
    }
    return await response.json();
}

// Register
router.post('/register', async (req, res) => {
    try {
        const { email, password, role, full_name } = req.body;

        if (!email || !password || !role) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Check if user exists
        const existingUser = await getUser(email);
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Create user (Sending plain password as requested)
        const newUser = await createUser({
            email,
            password,
            role,
            full_name
        });

        // Generate token
        const token = jwt.sign(
            { userId: newUser.id, email: newUser.email, role: newUser.role },
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '24h' }
        );

        res.status(201).json({
            message: 'User registered successfully',
            token,
            user: newUser
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        // Get user from User Service
        const user = await getUser(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password (Plain Text Comparison as requested)
        if (user.password !== password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role },
            process.env.JWT_SECRET || 'fallback_secret',
            { expiresIn: '24h' }
        );

        // Don't send password back in response, just for cleanliness
        const userResponse = { ...user };
        delete userResponse.password;

        res.json({
            message: 'Login successful',
            token,
            user: userResponse
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Current User
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback_secret');

        const user = await getUser(decoded.email);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Return user info
        const userResponse = { ...user };
        delete userResponse.password;

        res.json({ user: userResponse });
    } catch (error) {
        console.error('Auth check error:', error);
        res.status(401).json({ error: 'Invalid token' });
    }
});

module.exports = router;
