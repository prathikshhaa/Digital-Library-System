const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const session = require('express-session');
const connection = require('./db');

const app = express();

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Session
app.use(session({
    secret: 'library_secret',
    resave: false,
    saveUninitialized: false,
}));

// Multer setup for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueName + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// ---------------- ROUTES ----------------

// Login page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

// Login POST
app.post('/login', (req, res) => {
    const { email, password, role } = req.body;
    const query = 'SELECT * FROM users WHERE email=? AND password=? AND role=?';
    connection.query(query, [email, password, role], (err, results) => {
        if (err) throw err;
        if (results.length > 0) {
            req.session.user = {
                id: results[0].user_id,
                name: results[0].name,
                role: results[0].role
            };
            if (role === 'admin') res.sendFile(path.join(__dirname, 'views', 'admin.html'));
            else res.sendFile(path.join(__dirname, 'views', 'member.html'));
        } else {
            res.send('❌ Invalid credentials');
        }
    });
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Admin: Add User page
app.get('/add-user-page', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'adduser.html'));
});

// Admin: Add Book page
app.get('/add-book-page', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'addbook.html'));
});

// See Books page (frontend)
app.get('/see-books-page', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'seeBooks.html'));
});

// Add User (POST)
app.post('/add-user', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') 
        return res.json({ success: false, message: '❌ Only admin can add users' });

    const { name, email, role, password } = req.body;
    if (!name || !email || !role || !password) 
        return res.json({ success: false, message: '❌ Missing fields' });

    const query = 'INSERT INTO users (name, email, role, password) VALUES (?, ?, ?, ?)';
    connection.query(query, [name, email, role, password], (err) => {
        if (err) return res.json({ success: false, message: 'Database error' });
        res.json({ success: true, message: '✅ User added' });
    });
});

// Add Book (POST)
app.post('/add-book', upload.single('photo'), (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') 
        return res.json({ success: false, message: '❌ Only admin can add books' });

    const { title, author, category, total_copies } = req.body;
    const photo = req.file ? req.file.filename : null;

    if (!title || !author || !category || !total_copies) 
        return res.json({ success: false, message: '❌ Missing fields' });

    const query = 'INSERT INTO books (title, author, category, total_copies, available_copies, photo) VALUES (?, ?, ?, ?, ?, ?)';
    connection.query(query, [title, author, category, total_copies, total_copies, photo], (err) => {
        if (err) return res.json({ success: false, message: 'Database error' });
        res.json({ success: true, message: '✅ Book added' });
    });
});

// Get all books (API)
app.get('/see-books', (req, res) => {
    const query = 'SELECT * FROM books';
    connection.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch books' });
        res.json(results);
    });
});

// Borrow Book (member)
app.post('/borrow-book', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'member') 
        return res.status(403).send('❌ Only members can borrow books');

    const userId = req.session.user.id;
    const { book_id } = req.body;
    const borrow_date = new Date().toISOString().split('T')[0];

    // Check max 2 borrowed
    connection.query('SELECT COUNT(*) AS count FROM borrow_history WHERE user_id=? AND return_date IS NULL', [userId], (err, countRes) => {
        if (err) throw err;
        if (countRes[0].count >= 2) return res.send('❌ Max 2 books allowed');

        // Check available copies
        connection.query('SELECT available_copies, title FROM books WHERE book_id=?', [book_id], (err, bookRes) => {
            if (err) throw err;
            if (bookRes.length === 0 || bookRes[0].available_copies <= 0) return res.send('❌ No copies available');

            // Borrow book
            connection.query('INSERT INTO borrow_history (user_id, book_id, borrow_date) VALUES (?, ?, ?)', [userId, book_id, borrow_date], (err) => {
                if (err) throw err;
                connection.query('UPDATE books SET available_copies=available_copies-1 WHERE book_id=?', [book_id], (err) => {
                    if (err) throw err;
                    res.send(`✅ "${bookRes[0].title}" borrowed successfully`);
                });
            });
        });
    });
});

// History page
app.get('/history', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'history.html'));
});

// History data
app.get('/history/data', (req, res) => {
    if (!req.session.user) return res.status(401).send('❌ Please login');
    const user = req.session.user;

    let query = '';
    let params = [];
    if (user.role === 'admin') {
        query = `SELECT h.history_id, b.title, b.photo, h.borrow_date, h.return_date
                 FROM borrow_history h JOIN books b ON h.book_id = b.book_id`;
    } else {
        query = `SELECT h.history_id, b.title, b.photo, h.borrow_date, h.return_date
                 FROM borrow_history h JOIN books b ON h.book_id = b.book_id WHERE h.user_id=?`;
        params.push(user.id);
    }

    connection.query(query, params, (err, results) => {
        if (err) throw err;
        res.json(results);
    });
});

// Start server
app.listen(3000, () => console.log('🚀 Server running at http://localhost:3000'));
