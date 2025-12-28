const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

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

  // FIX: Fecha correcta México UTC-6
  const now = new Date();
  const today = new Date(now.getTime() - (6 * 60 * 60000)).toISOString().split('T')[0];
  console.log('🕐 Fecha HOY (México):', today);
  
  // 1. Primero limpiar tareas de días anteriores
  db.run(`DELETE FROM tasks WHERE date < ?`, [today], function(err) {
    if (err) {
      console.error('Error limpiando tareas viejas:', err);
    } else {
      console.log(`🗑️ Tareas anteriores a ${today} eliminadas: ${this.changes}`);
    }
    
    // 2. Verificar si existen tareas para HOY
    db.get(`SELECT COUNT(*) as count FROM tasks WHERE date = ?`, [today], (err, row) => {
      if (err) {
        console.error('Error verificando tareas:', err);
        return;
      }
      
      console.log(`📊 Tareas existentes para ${today}: ${row.count}`);
      
      if (row.count === 0) {
        console.log(`🚀 Insertando tareas REALES para ${today}...`);
        
        const dayOfWeek = now.getDay(); // 0=Domingo, 1=Lunes...
        const dayOfMonth = now.getDate(); // 1-31
        
        // Tareas DIARIAS (siempre)
        const dailyTasks = [
          {
            id: `agua-${today}`,
            date: today,
            area: 'Sistema Hidráulico',
            system: 'Cisterna y Tinacos',
            activity: 'Revisar niveles de agua (FL-16)',
            frequency: 'daily',
            status: 'pending',
            user: 'Técnico'
          },
          {
            id: `agua-medidores-${today}`,
            date: today,
            area: 'Sanitarios',
            system: 'Medidores',
            activity: 'Lectura de medidores y detección de fugas (WC, llaves)',
            frequency: 'daily',
            status: 'pending',
            user: 'Técnico'
          },
          {
            id: `solar-${today}`,
            date: today,
            area: 'Azotea',
            system: 'Paneles Solares',
            activity: 'Revisar generación solar y balance con CFE (Shelly)',
            frequency: 'daily',
            status: 'pending',
            user: 'Técnico'
          },
          {
            id: `iluminacion-${today}`,
            date: today,
            area: 'Edificio',
            system: 'Iluminación',
            activity: 'Atención a inquilinos y cambio de luminarias',
            frequency: 'daily',
            status: 'pending',
            user: 'Técnico'
          }
        ];

        // Tareas SEMANALES (solo lunes = 1)
        const weeklyTasks = dayOfWeek === 1 ? [
          {
            id: `rampa-${today}`,
            date: today,
            area: 'Estacionamiento',
            system: 'Rampa Hidráulica',
            activity: 'Inspección visual, aceite y consumo en amperes',
            frequency: 'weekly',
            status: 'pending',
            user: 'Técnico'
          }
        ] : [];

        // Tareas MENSUALES (solo día 1 del mes)
        const monthlyTasks = dayOfMonth === 1 ? [
          {
            id: `azotea-${today}`,
            date: today,
            area: 'Azotea',
            system: 'Impermeabilización / Limpieza',
            activity: 'Limpieza de azotea y revisión general',
            frequency: 'monthly',
            status: 'pending',
            user: 'Técnico'
          }
        ] : [];

        // Combinar todas
        const tasks = [...dailyTasks, ...weeklyTasks, ...monthlyTasks];
        
        const stmt = db.prepare(`
          INSERT INTO tasks (id, date, area, system, activity, frequency, status, user) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        tasks.forEach(task => {
          stmt.run(
            task.id, task.date, task.area, task.system, 
            task.activity, task.frequency, task.status, task.user
          );
          console.log(`✅ ${task.system} - ${task.area}`);
        });
        
        stmt.finalize();
        console.log(`🎯 ${tasks.length} tareas REALES insertadas para ${today}`);
      } else {
        console.log(`👍 Ya existen ${row.count} tareas REALES para ${today}`);
      }
    });
  });
});

// Endpoints API
app.get('/api/tasks/today', (req, res) => {
  const now = new Date();
  const today = new Date(now.getTime() - (6 * 60 * 60000)).toISOString().split('T')[0];
  
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

// Health check mejorado
app.get('/api/health', (req, res) => {
  const now = new Date();
  const today = new Date(now.getTime() - (6 * 60 * 60000)).toISOString().split('T')[0];
  
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
      version: '2.0.0',
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

// Dashboard gerencia SIMPLE
app.get('/gerencia', (req, res) => {
  const now = new Date();
  const today = new Date(now.getTime() - (6 * 60 * 60000)).toISOString().split('T')[0];
  
  db.all(`
    SELECT area, system, activity, status, photo, note,
           strftime('%H:%M', created_at) as hora
    FROM tasks 
    WHERE date = ?
    ORDER BY 
      CASE status WHEN 'pending' THEN 1 ELSE 2 END,
      area
  `, [today], (err, tasks) => {
    
    const completadas = tasks.filter(t => t.status === 'done').length;
    const total = tasks.length;
    const porcentaje = total > 0 ? Math.round((completadas / total) * 100) : 0;
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Bitácora Torre K - ${today}</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { font-family: system-ui, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
          .container { max-width: 1000px; margin: 0 auto; }
          .header { background: #1a237e; color: white; padding: 25px; border-radius: 10px; margin-bottom: 20px; }
          .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin: 25px 0; }
          .stat { background: white; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 2px 5px rgba(0,0,0,0.1); }
          .stat .number { font-size: 2.5em; font-weight: bold; margin: 10px 0; }
          .task { background: white; padding: 20px; margin-bottom: 15px; border-radius: 8px; border-left: 5px solid #ccc; }
          .task.done { border-left-color: #4caf50; background: #f8fff8; }
          .task.pending { border-left-color: #ff9800; }
          .area { font-weight: bold; color: #333; font-size: 1.1em; }
          .system { color: #666; margin: 5px 0; }
          .activity { color: #444; }
          .foto img { max-width: 150px; border-radius: 5px; border: 1px solid #ddd; }
          .hora { color: #888; font-size: 0.9em; margin-top: 10px; }
          .nota { background: #f0f0f0; padding: 10px; border-radius: 5px; margin-top: 10px; font-style: italic; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>🏢 Bitácora Torre K - ${today}</h1>
            <p>Sistema de mantenimiento • Visión gerencial</p>
          </div>
          
          <div class="stats">
            <div class="stat">
              <div>Total tareas</div>
              <div class="number">${total}</div>
            </div>
            <div class="stat">
              <div>Completadas</div>
              <div class="number" style="color: #4caf50;">${completadas}</div>
            </div>
            <div class="stat">
              <div>Pendientes</div>
              <div class="number" style="color: #ff9800;">${total - completadas}</div>
            </div>
            <div class="stat">
              <div>Cumplimiento</div>
              <div class="number" style="color: #2196f3;">${porcentaje}%</div>
            </div>
          </div>
          
          <h2>📋 Detalle de actividades</h2>
          
          ${tasks.length === 0 ? 
            '<p style="text-align: center; padding: 40px; color: #666;">No hay actividades programadas para hoy.</p>' : 
            tasks.map(task => `
              <div class="task ${task.status}">
                <div class="area">${task.area}</div>
                <div class="system"><strong>${task.system}</strong></div>
                <div class="activity">${task.activity}</div>
                
                ${task.note ? `<div class="nota">📝 ${task.note}</div>` : ''}
                
                ${task.photo ? `
                  <div class="foto">
                    <strong>Evidencia:</strong><br>
                    <img src="${task.photo}" alt="Foto evidencia" onclick="window.open('${task.photo}')">
                  </div>
                ` : ''}
                
                <div class="hora">
                  ${task.status === 'done' ? '✅ Completado' : '⏳ Pendiente'} 
                  ${task.hora ? `• ${task.hora}` : ''}
                </div>
              </div>
            `).join('')
          }
        </div>
      </body>
      </html>
    `);
  });
});

// Página principal simple
app.get('/', (req, res) => {
  const now = new Date();
  const today = new Date(now.getTime() - (6 * 60 * 60000)).toISOString().split('T')[0];
  
  db.get(`SELECT COUNT(*) as count FROM tasks WHERE date = ?`, [today], (err, row) => {
    const taskCount = row ? row.count : 0;
    
    res.send(`
      <html>
        <head><title>OpenMaintenance Backend</title></head>
        <body style="font-family: Arial, sans-serif; padding: 30px; max-width: 800px; margin: 0 auto;">
          <h1 style="color: #1976d2;">✅ OpenMaintenance Torre K v2.0</h1>
          <div style="background: #f5f5f5; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h2>📊 Sistema en producción</h2>
            <p><strong>Fecha:</strong> ${today}</p>
            <p><strong>Tareas para hoy:</strong> <span style="color: #4caf50;">${taskCount} tareas cargadas</span></p>
            <p><strong>Frontend técnicos:</strong> <a href="https://open-maintenance-frontend.onrender.com" target="_blank">Abrir aplicación</a></p>
            <p><strong>Dashboard gerencia:</strong> <a href="/gerencia">Ver bitácora</a></p>
          </div>
          
          <h2>🔌 API Endpoints</h2>
          <ul>
            <li><a href="/api/health">/api/health</a> - Estado del servicio</li>
            <li><a href="/api/tasks/today">/api/tasks/today</a> - Tareas de hoy (${taskCount})</li>
            <li><strong>POST</strong> /api/tasks/:id/complete - Completar tarea</li>
          </ul>
        </body>
      </html>
    `);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Servidor backend v2.0 iniciado en puerto ${PORT}`);
});
