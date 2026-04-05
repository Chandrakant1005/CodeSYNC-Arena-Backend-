CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS meetings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  meeting_id VARCHAR(32) NOT NULL UNIQUE,
  room_slug VARCHAR(64) NOT NULL UNIQUE,
  title VARCHAR(150) NOT NULL,
  owner_id INT NOT NULL,
  status ENUM('active', 'ended') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS meeting_participants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  meeting_id INT NOT NULL,
  user_id INT NOT NULL,
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP NULL,
  is_active TINYINT(1) DEFAULT 1,
  INDEX idx_meeting_participants_meeting_id (meeting_id),
  INDEX idx_meeting_participants_user_id (user_id),
  INDEX idx_meeting_user_active (meeting_id, user_id, is_active),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
