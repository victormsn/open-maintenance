const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Base de datos PERSISTENTE
const db = new sqlite3.Database('/tmp/database.sqlite');

// Crear tabla SIEMPRE que se inicie
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      area TEXT NOT NULL,
      system TEXT NOT NULL,
      activity TEXT NOT NULL,
      frequency TEXT CHECK(frequency IN ('daily', 'weekly', 'monthly')),
      status TEXT DEFAULT 'pending',
      photo TEXT,
      note TEXT,
      user TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insertar tareas del día actual SIEMPRE
  const today = new Date().toISOString().split('T')[0];
  
  // Verificar si ya existen tareas para hoy
  db.get(`SELECT COUNT(*) as count FROM tasks WHERE date = ?`, [today], (err, row) => {
    if (err) {
      console.error('Error verificando tareas:', err);
      return;
    }
    
    if (row.count === 0) {
      console.log(`Insertando tareas para ${today}...`);
      
      const tasks = [
        {
          id: '1', date: today, area: 'Sótano', 
          system: 'Bombas', activity: 'Revisar ruido y presión',
          frequency: 'daily', status: 'pending', user: 'Técnico'
        },
        {
          id: '2', date: today, area: 'Ascensores', 
          system: 'Ascensor A', activity: 'Prueba básica de funcionamiento',
          frequency: 'daily', status: 'pending', user: 'Técnico'
        },
        {
          id: '3', date: today, area: 'Áreas Comunes', 
          system: 'Luces', activity: 'Revisar funcionamiento de todas las luces',
          frequency: 'daily', status: 'pending', user: 'Técnico'
        },
        {
          id: '4', date: today, area: 'Jardineras', 
          system: 'Riego', activity: 'Verificar encharcamientos',
          frequency: 'daily', status: 'pending', user: 'Técnico'
        },
        {
          id: '5', date: today, area: 'Sistema Eléctrico', 
          system: 'Tablero Principal', activity: 'Revisar indicadores',
          frequency: 'daily', status: 'pending', user: 'Técnico'
        }
      ];

      const stmt = db.prepare(`
        INSERT OR REPLACE INTO tasks 
        (id, date, area, system, activity, frequency, status, user) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      tasks.forEach(task => {
        stmt.run(
          task.id, task.date, task.area, task.system, 
          task.activity, task.frequency, task.status, task.user
        );
        console.log(`✓ Tarea agregada: ${task.system} - ${task.area}`);
      });
      
      stmt.finalize();
      console.log(`✅ ${tasks.length} tareas insertadas para ${today}`);
    } else {
      console.log(`✅ Ya existen ${row.count} tareas para ${today}`);
    }
  });
});

// Endpoints API
app.get('/api/tasks/today', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  db.all('SELECT * FROM tasks WHERE date = ? ORDER BY area, system', [today], (err, rows) => {
    if (err) {
      console.error('Error obteniendo tareas:', err);
      res.status(500).json({ error: err.message });
      return;
    }
    
    console.log(`📋 Devolviendo ${rows.length} tareas para ${today}`);
    res.json(rows);
  });
});

app.post('/api/tasks/:id/complete', (req, res) => {
  const { photo, note } = req.body;
  const taskId = req.params.id;
  
  console.log(`✅ Completando tarea ${taskId}:`, { photo, note });
  
  db.run(
    `UPDATE tasks SET status = "done", photo = ?, note = ?, 
     created_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [photo || 'https://via.placeholder.com/150', note || 'Sin nota', taskId],
    function(err) {
      if (err) {
        console.error('Error completando tarea:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      
      console.log(`✓ Tarea ${taskId} completada. Filas afectadas: ${this.changes}`);
      res.json({ 
        success: true, 
        updated: this.changes,
        message: 'Tarea marcada como completada'
      });
    }
  );
});

// Nuevo endpoint: obtener todas las tareas
app.get('/api/tasks', (req, res) => {
  db.all('SELECT * FROM tasks ORDER BY date DESC, area, system', [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Nuevo endpoint: crear nueva tarea
app.post('/api/tasks', (req, res) => {
  const { id, date, area, system, activity, frequency, user } = req.body;
  
  db.run(
    `INSERT INTO tasks (id, date, area, system, activity, frequency, user) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id || Date.now().toString(), date, area, system, activity, frequency, user || 'Técnico'],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ 
        success: true, 
        id: this.lastID,
        message: 'Tarea creada exitosamente'
      });
    }
  );
});

// Health check mejorado
app.get('/api/health', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  db.get(`SELECT COUNT(*) as total, 
                 SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completed 
          FROM tasks WHERE date = ?`, [today], (err, row) => {
    
    if (err) {
      res.json({ 
        status: 'ERROR', 
        error: err.message,
        timestamp: new Date().toISOString()
      });
      return;
    }
    
    res.json({ 
      status: 'OK', 
      service: 'OpenMaintenance Torre K',
      version: '1.0.0',
      database: 'SQLite persistente',
      today: today,
      tasks: {
        total: row.total || 0,
        completed: row.completed || 0,
        pending: (row.total || 0) - (row.completed || 0)
      },
      timestamp: new Date().toISOString()
    });
  });
});

// Página de información
app.get('/', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  db.get(`SELECT COUNT(*) as count FROM tasks WHERE date = ?`, [today], (err, row) => {
    const taskCount = row ? row.count : 0;
    
    res.send(`
      <html>
        <head>
          <title>OpenMaintenance Backend</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 30px; max-width: 800px; margin: 0 auto; }
            h1 { color: #1976d2; }
            .card { background: #f5f5f5; padding: 20px; border-radius: 10px; margin: 20px 0; }
            .endpoint { background: white; padding: 15px; border-left: 4px solid #4caf50; margin: 10px 0; }
            .success { color: #4caf50; }
            .info { color: #2196f3; }
          </style>
        </head>
        <body>
          <h1>✅ OpenMaintenance Torre K - Backend Activo</h1>
          <div class="card">
            <h2>📊 Estado del Sistema</h2>
            <p><strong>Fecha actual:</strong> ${today}</p>
            <p><strong>Tareas para hoy:</strong> <span class="success">${taskCount} tareas cargadas</span></p>
            <p><strong>Base de datos:</strong> SQLite persistente</p>
            <p><strong>Frontend:</strong> <a href="https://open-maintenance-frontend.onrender.com" target="_blank">https://open-maintenance-frontend.onrender.com</a></p>
          </div>
          
          <h2>🔌 Endpoints Disponibles</h2>
          <div class="endpoint">
            <strong>GET</strong> <a href="/api/health">/api/health</a> - Estado del servicio
          </div>
          <div class="endpoint">
            <strong>GET</strong> <a href="/api/tasks/today">/api/tasks/today</a> - Tareas del día (${taskCount})
          </div>
          <div class="endpoint">
            <strong>GET</strong> /api/tasks - Todas las tareas
          </div>
          <div class="endpoint">
            <strong>POST</strong> /api/tasks/:id/complete - Completar tarea (con foto y nota)
          </div>
          
          <h2>🚀 Prueba Rápida</h2>
          <div class="card">
            <p>Para probar que el frontend funciona:</p>
            <ol>
              <li>Abre el <a href="https://open-maintenance-frontend.onrender.com" target="_blank">Frontend</a></li>
              <li>Deberías ver ${taskCount} tareas de mantenimiento</li>
              <li>Haz clic en "📸 MARCAR HECHO" para completar una tarea</li>
            </ol>
            <p class="info">⚠️ Nota: El backend free tier puede tardar ~50s en responder si ha estado inactivo.</p>
          </div>
        </body>
      </html>
    `);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor backend iniciado en puerto ${PORT}`);
  console.log(`📅 Fecha actual: ${new Date().toISOString().split('T')[0]}`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
});
