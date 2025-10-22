const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.')); // Serve static files

// Initialize SQLite database
const db = new sqlite3.Database('./teachers.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.run(`CREATE TABLE IF NOT EXISTS teachers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        avgRating REAL DEFAULT 0,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacherId INTEGER,
        rating INTEGER NOT NULL,
        reason TEXT NOT NULL,
        date TEXT NOT NULL,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacherId) REFERENCES teachers(id)
    )`);
}

// Routes

// Get all teachers with their reviews
app.get('/api/teachers', (req, res) => {
    const query = `
        SELECT t.*, 
               COUNT(r.id) as reviewCount,
               GROUP_CONCAT(json_object('rating', r.rating, 'reason', r.reason, 'date', r.date)) as reviews
        FROM teachers t
        LEFT JOIN reviews r ON t.id = r.teacherId
        GROUP BY t.id
        ORDER BY t.avgRating DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        const teachers = rows.map(row => ({
            id: row.id,
            name: row.name,
            description: row.description,
            avgRating: parseFloat(row.avgRating),
            reviews: row.reviews ? JSON.parse(`[${row.reviews}]`) : [],
            reviewCount: row.reviewCount
        }));

        res.json(teachers);
    });
});

// Add a new teacher
app.post('/api/teachers', (req, res) => {
    const { name, description, rating, reason } = req.body;

    // Check if teacher already exists
    db.get('SELECT * FROM teachers WHERE LOWER(name) = LOWER(?)', [name], (err, existingTeacher) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        if (existingTeacher) {
            res.status(400).json({ error: 'Teacher already exists', teacherId: existingTeacher.id });
            return;
        }

        // Insert new teacher
        db.run('INSERT INTO teachers (name, description, avgRating) VALUES (?, ?, ?)', 
            [name, description, rating], function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            const teacherId = this.lastID;

            // Add first review
            db.run('INSERT INTO reviews (teacherId, rating, reason, date) VALUES (?, ?, ?, ?)',
                [teacherId, rating, reason, new Date().toLocaleDateString()], (err) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                res.json({ 
                    id: teacherId, 
                    name, 
                    description, 
                    avgRating: parseFloat(rating),
                    reviews: [{ rating: parseInt(rating), reason, date: new Date().toLocaleDateString() }]
                });
            });
        });
    });
});

// Add review to existing teacher
app.post('/api/teachers/:id/reviews', (req, res) => {
    const teacherId = req.params.id;
    const { rating, reason } = req.body;

    // Add review
    db.run('INSERT INTO reviews (teacherId, rating, reason, date) VALUES (?, ?, ?, ?)',
        [teacherId, rating, reason, new Date().toLocaleDateString()], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }

        // Recalculate average rating
        db.get('SELECT AVG(rating) as newAvg FROM reviews WHERE teacherId = ?', [teacherId], (err, result) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            // Update teacher's average rating
            db.run('UPDATE teachers SET avgRating = ? WHERE id = ?', [result.newAvg, teacherId], (err) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                res.json({ success: true, newAvg: result.newAvg });
            });
        });
    });
});

// Serve the main HTML file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Visit: http://localhost:${PORT}`);
});