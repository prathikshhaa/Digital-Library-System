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
            res.redirect('/login.html?error=invalid');
        }
    });
});

app.get('/login.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get('/add-user-page', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'adduser.html'));
});

app.get('/add-book-page', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'addbook.html'));
});

app.get('/see-books-page', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'seeBooks.html'));
});

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

app.get('/see-books', (req, res) => {
    const query = 'SELECT * FROM books';
    connection.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Failed to fetch books' });
        res.json(results);
    });
});

app.get('/borrowed-books-page', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'borrowedBooks.html'));
});

app.get('/borrowed-books/data', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin')
        return res.status(403).send('❌ Only admin can view this');

    const query = `
        SELECT h.history_id AS id, u.name AS user_name, u.email AS user_email,
               b.title AS book_title, h.borrow_date, h.return_date
        FROM borrow_history h
        JOIN users u ON h.user_id = u.user_id
        JOIN books b ON h.book_id = b.book_id
    `;

    connection.query(query, (err, results) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(results);
    });
});

app.delete('/borrowed-books/delete/:id', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin')
        return res.status(403).json({ message: '❌ Only admin can delete records' });

    const historyId = req.params.id;

    const query = 'DELETE FROM borrow_history WHERE history_id = ?';
    connection.query(query, [historyId], (err, result) => {
        if (err) {
            console.error('DB deletion error:', err);
            return res.status(500).json({ message: '❌ Database error during deletion' });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: '❌ Record not found' });
        }

        res.status(200).json({ message: '✅ Record deleted successfully' });
    });
});

app.post('/borrow-book', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'member')
        return res.status(403).send('❌ Only members can borrow books');

    const userId = req.session.user.id;
    const { book_id } = req.body;
    const borrow_date = new Date().toISOString().split('T')[0];

    connection.query('SELECT COUNT(*) AS count FROM borrow_history WHERE user_id=? AND return_date IS NULL', [userId], (err, countRes) => {
        if (err) throw err;
        if (countRes[0].count >= 2) return res.send('❌ Max 2 books allowed');

        connection.query('SELECT available_copies, title FROM books WHERE book_id=?', [book_id], (err, bookRes) => {
            if (err) throw err;
            if (bookRes.length === 0 || bookRes[0].available_copies <= 0) return res.send('❌ No copies available');

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

app.get('/history', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'views', 'history.html'));
});

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

app.post('/return-book', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'member')
        return res.status(403).send('❌ Only members can return books');

    const userId = req.session.user.id;
    const { history_id, book_id } = req.body;
    const returnDate = new Date().toISOString().split('T')[0];

    const query1 = 'UPDATE borrow_history SET return_date=? WHERE history_id=? AND user_id=? AND return_date IS NULL';
    connection.query(query1, [returnDate, history_id, userId], (err, result) => {
        if (err) return res.status(500).send('❌ Error updating borrow history');
        if (result.affectedRows === 0) return res.status(400).json({ success: false, message: '❌ Book already returned or invalid request' });

        const query2 = 'UPDATE books SET available_copies = available_copies + 1 WHERE book_id=?';
        connection.query(query2, [book_id], (err) => {
            if (err) return res.status(500).send('❌ Error updating book copies');

            res.json({ success: true, message: '✅ Book returned successfully', return_date: returnDate });
        });
    });
});

// Start server
app.listen(3000, () => console.log('🚀 Server running at http://localhost:3000'));
