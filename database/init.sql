-- Create Users Table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('doctor', 'patient')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert Demo Users
-- Password hash for '123456' is roughly '$2a$10$YourHashedPasswordHere' (will use a real bcrypt hash in the implementation)
-- We will use a script to seed this properly, but here is the logic.

INSERT INTO users (email, password_hash, role)
VALUES 
    ('doctor@demo.com', '$2b$10$EpRnTzVlqHNP0.fkbpo9SOgy.hTe7ag/y.aCg0m7P0cO.jCl4t1.i', 'doctor'),
    ('patient@demo.com', '$2b$10$EpRnTzVlqHNP0.fkbpo9SOgy.hTe7ag/y.aCg0m7P0cO.jCl4t1.i', 'patient')
ON CONFLICT (email) DO NOTHING;
