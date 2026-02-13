const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app       = express();
const DATA_FILE = path.join(__dirname, 'db.json');
const PORT      = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

function readDb() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return { records: [], changelog: [], waarMappings: {}, waarReview: [] };
    }
}

function writeDb(data) {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
}

app.get('/api/db', (req, res) => {
    res.json(readDb());
});

app.post('/api/db', (req, res) => {
    try {
        writeDb(req.body);
        res.json({ ok: true });
    } catch (err) {
        console.error('Write failed:', err);
        res.status(500).json({ error: 'Write failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Registratie App draait op http://localhost:${PORT}`);
});
