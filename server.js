const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Base de datos SQLite en memoria (para empezar)
const db = new sqlite3.Database(':memory:');

// Crear tabla de tareas
db.serialize(() => {
  db.run(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      area TEXT NOT NULL,
      system TEXT NOT NULL,
      activity TEXT NOT NULL,
      frequency TEXT,
      status TEXT DEFAULT 'pending',
      photo TEXT,
      note TEXT,
      user TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insertar tareas de ejemplo (Torre K)
  const tasks = [
    {
      id: '1', date: '2024-12-28', area: 'Sótano', 
      system: 'Bombas', activity: 'Revisar ruido/presión',
      frequency: 'daily', status: 'pending', user: 'Técnico'
    },
    {
      id: '2', date: '2024-12-28', area: 'Ascensores', 
      system: 'Ascensor A', activity: 'Prueba básica',
      frequency: 'daily', status: 'pending', user: 'Técnico'
    }
  ];

  const stmt = db.prepare(`
    INSERT INTO tasks (id, date, area, system, activity, frequency, status, user) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  tasks.forEach(task => {
    stmt.run(task.id, task.date, task.area, task.system, 
             task.activity, task.frequency, task.status, task.user);
  });
  stmt.finalize();
});

// Endpoints API
app.get('/api/tasks/today', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.all('SELECT * FROM tasks WHERE date = ?', [today], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

app.post('/api/tasks/:id/complete', (req, res) => {
  const { photo, note } = req.body;
  db.run(
    'UPDATE tasks SET status = "done", photo = ?, note = ? WHERE id = ?',
    [photo, note, req.params.id],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true, updated: this.changes });
    }
  );
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    service: 'OpenMaintenance Torre K',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (req, res) => {
  res.send(`
    <html>
      <head><title>OpenMaintenance Backend</title></head>
      <body style="font-family: Arial, sans-serif; padding: 20px;">
        <h1>✅ OpenMaintenance Torre K - Backend Activo</h1>
        <p>Endpoints disponibles:</p>
        <ul>
          <li><a href="/api/health">/api/health</a> - Estado del servicio</li>
          <li><a href="/api/tasks/today">/api/tasks/today</a> - Tareas del día</li>
          <li><code>POST /api/tasks/:id/complete</code> - Completar tarea</li>
        </ul>
        <p><strong>Frontend:</strong> Próximamente en otra URL</p>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
  console.log(`📡 API disponible en: http://localhost:${PORT}`);
});
