-- 1. Agar pehle se database bana hai to use hatakar naya banayein
DROP DATABASE IF EXISTS sahitya_hub_new;
CREATE DATABASE sahitya_hub_new;
USE sahitya_hub_new;

-- 2. USERS TABLE
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    uniqueId VARCHAR(255) NOT NULL UNIQUE,
    username VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NULL,
    loginMethod VARCHAR(50) NOT NULL DEFAULT 'Email',
    avatar_url TEXT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'user',
    registrationDate TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. SITE SETTINGS TABLE
CREATE TABLE site_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    hero_title VARCHAR(255) NOT NULL,
    hero_desc TEXT NOT NULL,
    hero_bg_url TEXT NULL,
    hero_logo_url TEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 4. POST LIKES TABLE
CREATE TABLE post_likes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    post_id VARCHAR(255) NOT NULL,
    user_uniqueId VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_uniqueId) REFERENCES users(uniqueId) ON DELETE CASCADE
);

-- 5. AVATAR HISTORY TABLE
CREATE TABLE user_avatar_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_uniqueId VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    avatar_url TEXT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_uniqueId) REFERENCES users(uniqueId) ON DELETE CASCADE
);

-- 6. HOME CARDS TABLE (Featured/Article/Poem/Story Cards — 'page' column se decide hota hai konsa page)
CREATE TABLE home_cards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    card_id VARCHAR(50) NOT NULL UNIQUE,
    page VARCHAR(20) NOT NULL DEFAULT 'home',        -- 'home', 'article', 'poem', 'story'
    badge_text VARCHAR(50) NOT NULL DEFAULT '',
    title VARCHAR(255) NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    image_url TEXT NULL,
    author_name VARCHAR(100) NOT NULL DEFAULT '',
    media_type VARCHAR(10) NOT NULL DEFAULT 'image',
    is_draft TINYINT(1) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 7. CONTENT HISTORY TABLE
CREATE TABLE content_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    admin_username VARCHAR(255) NOT NULL,
    section VARCHAR(50) NOT NULL,
    card_id VARCHAR(50) NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ==========================================================
-- DEFAULT DATA INSERTION
-- ==========================================================

INSERT INTO site_settings (id, hero_title, hero_desc, hero_bg_url, hero_logo_url)
VALUES (1, "Art & Literature: Fresh Thoughts...", "Welcome to a beautiful world...", "img0.2.jpg", "img.3.png");

INSERT INTO home_cards (card_id, page, badge_text, title, description, image_url, author_name, media_type, is_draft) VALUES
('article-1', 'home', 'Article', "Discovering India's Rich Heritage", "An artwork by Akash Sharma showcasing India's diverse cultures, historic monuments, traditional dances, and the spirit of national unity.", "img.1.jpeg", "Akash Kumar", "image", 0),
('poem-1', 'home', 'Poem', "A Battlefield of Fate", "Man jumps in the battlefield of fate, With a shining sword in hand...", "img.2.png", "Akash Kumar", "image", 0),
('story-1', 'home', 'Story', "The Last Letter", "A soldier writes his final letter home, a story of courage, love, and the price of duty in the silence before battle.", "img.4.png", "Akash Kumar", "image", 0);

INSERT INTO users (uniqueId, username, email, loginMethod, role)
VALUES ('1083150284', 'shubham', 'personal.shubham1872@gmail.com', 'Google', 'admin');