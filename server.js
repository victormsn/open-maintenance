const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

// Base de datos
const db = new sqlite3.Database('/tmp/database.sqlite');

// Crear tabla de actividades (tu Excel)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      actividad TEXT NOT NULL,
      tipo_mantenimiento TEXT CHECK(tipo_mantenimiento IN ('preventivo', 'correctivo', 'predictivo')),
      estado TEXT CHECK(estado IN ('ok', 'pendiente')),
      sistema TEXT,
      area TEXT,
      observaciones TEXT,
      foto TEXT,
      tecnico TEXT DEFAULT 'Técnico',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Crear tabla de sistemas (estado general)
  db.run(`
    CREATE TABLE IF NOT EXISTS sistemas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sistema TEXT UNIQUE NOT NULL,
      estado TEXT CHECK(estado IN ('ok', 'pendiente', 'atencion')) DEFAULT 'ok',
      ultima_revision TEXT,
      observaciones TEXT
    )
  `);

  // Insertar sistemas base si no existen
  const sistemasBase = [
    'Electrico', 'Plomeria', 'Datos y Redes', 'Luminarias', 'Agua',
    'Drenaje', 'Filtraciones', 'Elevador', 'Rampa Hidraulica',
    'Paneles Solares', 'Bomba Contra Incendio', 'Planta de Emergencia',
    'Jardineria', 'Pintura'
  ];

  sistemasBase.forEach(sistema => {
    db.run(
      `INSERT OR IGNORE INTO sistemas (sistema, estado) VALUES (?, 'ok')`,
      [sistema]
    );
  });

  console.log('✅ Base de datos lista');
});

// ========== ENDPOINTS PARA TÉCNICO ==========

// 1. Agregar nueva actividad (como llenar Excel)
app.post('/api/actividad', (req, res) => {
  const { fecha, actividad, tipo_mantenimiento, estado, sistema, area, observaciones } = req.body;
  
  const fechaActual = fecha || new Date().toISOString().split('T')[0];
  
  db.run(`
    INSERT INTO actividades (fecha, actividad, tipo_mantenimiento, estado, sistema, area, observaciones) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [fechaActual, actividad, tipo_mantenimiento, estado, sistema, area, observaciones],
    function(err) {
      if (err) {
        console.error('Error agregando actividad:', err);
        res.status(500).json({ error: err.message });
        return;
      }
      
      // Si hay sistema especificado, actualizar su estado
      if (sistema) {
        db.run(
          `UPDATE sistemas SET estado = ?, ultima_revision = ? WHERE sistema = ?`,
          [estado === 'pendiente' ? 'pendiente' : 'ok', fechaActual, sistema]
        );
      }
      
      res.json({ 
        success: true, 
        id: this.lastID,
        message: 'Actividad registrada correctamente'
      });
    }
  );
});

// 2. Obtener actividades del día
app.get('/api/actividades/hoy', (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  
  db.all(
    `SELECT * FROM actividades WHERE fecha = ? ORDER BY created_at DESC`,
    [hoy],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 3. Obtener actividades por fecha
app.get('/api/actividades/:fecha', (req, res) => {
  db.all(
    `SELECT * FROM actividades WHERE fecha = ? ORDER BY created_at DESC`,
    [req.params.fecha],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// ========== ENDPOINTS PARA GERENCIA ==========

// 4. Dashboard gerencia (estado de sistemas)
app.get('/api/gerencia/sistemas', (req, res) => {
  db.all(
    `SELECT s.*, 
            COUNT(a.id) as actividades_30d,
            GROUP_CONCAT(DISTINCT a.fecha) as fechas_revision
     FROM sistemas s
     LEFT JOIN actividades a ON a.sistema = s.sistema 
            AND a.fecha >= date('now', '-30 days')
     GROUP BY s.sistema
     ORDER BY 
       CASE s.estado 
         WHEN 'pendiente' THEN 1
         WHEN 'atencion' THEN 2
         ELSE 3
       END, s.sistema`,
    [],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 5. Ver actividades pendientes de un sistema
app.get('/api/gerencia/sistema/:nombre/pendientes', (req, res) => {
  db.all(
    `SELECT * FROM actividades 
     WHERE sistema = ? AND estado = 'pendiente'
     ORDER BY fecha DESC`,
    [req.params.nombre],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    }
  );
});

// 6. Actualizar estado de sistema (gerencia)
app.put('/api/gerencia/sistema/:nombre', (req, res) => {
  const { estado, observaciones } = req.body;
  
  db.run(
    `UPDATE sistemas SET estado = ?, observaciones = ?, ultima_revision = ? WHERE sistema = ?`,
    [estado, observaciones, new Date().toISOString().split('T')[0], req.params.nombre],
    function(err) {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ 
        success: true, 
        updated: this.changes,
        message: 'Estado actualizado'
      });
    }
  );
});

// ========== INTERFACES HTML SIMPLES ==========

// Interfaz TÉCNICO (para agregar actividades)
app.get('/tecnico', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitácora Técnico - Torre K</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; padding: 20px; background: #f0f2f5; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { background: #1e88e5; color: white; padding: 25px; border-radius: 10px; margin-bottom: 25px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; margin-bottom: 8px; font-weight: 600; color: #333; }
        input, select, textarea { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 16px; }
        button { background: #43a047; color: white; border: none; padding: 15px 30px; border-radius: 6px; font-size: 16px; cursor: pointer; }
        button:hover { background: #2e7d32; }
        .actividades-list { margin-top: 30px; }
        .actividad { background: white; padding: 15px; margin-bottom: 10px; border-radius: 6px; border-left: 4px solid #43a047; }
        .actividad.pendiente { border-left-color: #fb8c00; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📝 Bitácora Diaria - Torre K</h1>
          <p>Registra tus actividades del día</p>
        </div>
        
        <form id="formActividad">
          <div class="form-group">
            <label>Actividad realizada:</label>
            <input type="text" id="actividad" placeholder="Ej: Lectura de medidores de agua, cambio de lámpara..." required>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div class="form-group">
              <label>Tipo de mantenimiento:</label>
              <select id="tipo_mantenimiento">
                <option value="preventivo">Preventivo</option>
                <option value="correctivo">Correctivo</option>
                <option value="predictivo">Predictivo</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Estado:</label>
              <select id="estado">
                <option value="ok">OK (Completado)</option>
                <option value="pendiente">Pendiente</option>
              </select>
            </div>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
            <div class="form-group">
              <label>Sistema:</label>
              <select id="sistema">
                <option value="">-- Seleccionar --</option>
                <option value="Electrico">Electrico</option>
                <option value="Plomeria">Plomeria</option>
                <option value="Agua">Agua</option>
                <option value="Drenaje">Drenaje</option>
                <option value="Elevador">Elevador</option>
                <option value="Paneles Solares">Paneles Solares</option>
                <option value="Jardineria">Jardineria</option>
                <option value="Rampa Hidraulica">Rampa Hidraulica</option>
                <option value="Luminarias">Luminarias</option>
                <option value="Pintura">Pintura</option>
              </select>
            </div>
            
            <div class="form-group">
              <label>Área:</label>
              <input type="text" id="area" placeholder="Ej: Fachada, Azotea, Planta Baja...">
            </div>
          </div>
          
          <div class="form-group">
            <label>Observaciones:</label>
            <textarea id="observaciones" rows="3" placeholder="Detalles, hallazgos, recomendaciones..."></textarea>
          </div>
          
          <button type="submit">➕ Agregar Actividad</button>
        </form>
        
        <div class="actividades-list">
          <h3 style="margin: 30px 0 15px 0;">Actividades de hoy</h3>
          <div id="listaActividades"></div>
        </div>
      </div>
      
      <script>
        const API_URL = 'https://open-maintenance.onrender.com';
        
        // Cargar actividades al iniciar
        cargarActividades();
        
        // Formulario para agregar actividad
        document.getElementById('formActividad').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const actividad = {
            actividad: document.getElementById('actividad').value,
            tipo_mantenimiento: document.getElementById('tipo_mantenimiento').value,
            estado: document.getElementById('estado').value,
            sistema: document.getElementById('sistema').value,
            area: document.getElementById('area').value,
            observaciones: document.getElementById('observaciones').value
          };
          
          try {
            const response = await fetch(API_URL + '/api/actividad', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(actividad)
            });
            
            if (response.ok) {
              alert('✅ Actividad registrada');
              document.getElementById('formActividad').reset();
              cargarActividades();
            }
          } catch (error) {
            alert('Error al registrar actividad');
          }
        });
        
        async function cargarActividades() {
          try {
            const response = await fetch(API_URL + '/api/actividades/hoy');
            const actividades = await response.json();
            
            const lista = document.getElementById('listaActividades');
            lista.innerHTML = actividades.map(a => \`
              <div class="actividad \${a.estado === 'pendiente' ? 'pendiente' : ''}">
                <strong>\${a.actividad}</strong>
                <div style="margin-top: 5px; color: #666; font-size: 0.9em;">
                  \${a.tipo_mantenimiento} • \${a.sistema || 'Sin sistema'} • \${a.estado === 'ok' ? '✅ OK' : '⏳ Pendiente'}
                </div>
                \${a.observaciones ? '<div style="margin-top: 5px; font-style: italic;">' + a.observaciones + '</div>' : ''}
              </div>
            \`).join('');
          } catch (error) {
            console.error('Error cargando actividades:', error);
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Dashboard GERENCIA
app.get('/gerencia', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Dashboard Gerencia - Torre K</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: system-ui, sans-serif; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #2c3e50 0%, #34495e 100%); color: white; padding: 30px; border-radius: 10px; margin-bottom: 30px; }
        .sistemas-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }
        .sistema-card { background: white; padding: 25px; border-radius: 10px; box-shadow: 0 3px 10px rgba(0,0,0,0.1); text-align: center; cursor: pointer; transition: all 0.3s; }
        .sistema-card:hover { transform: translateY(-5px); box-shadow: 0 5px 15px rgba(0,0,0,0.2); }
        .sistema-card.ok { border-top: 5px solid #27ae60; }
        .sistema-card.pendiente { border-top: 5px solid #e74c3c; }
        .sistema-card.atencion { border-top: 5px solid #f39c12; }
        .status { font-size: 2.5rem; margin-bottom: 10px; }
        .actividades-panel { background: white; padding: 25px; border-radius: 10px; margin-top: 30px; display: none; }
        .actividad-item { padding: 15px; border-bottom: 1px solid #eee; }
        .actividad-item:last-child { border-bottom: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🏢 Dashboard Gerencia - Torre K</h1>
          <p>Estado de sistemas en tiempo real • ${new Date().toLocaleDateString('es-ES')}</p>
        </div>
        
        <h2 style="margin-bottom: 20px;">📊 Estado de Sistemas</h2>
        <div class="sistemas-grid" id="sistemasGrid"></div>
        
        <div id="actividadesPanel" class="actividades-panel">
          <h3 id="panelTitulo"></h3>
          <div id="actividadesList"></div>
        </div>
      </div>
      
      <script>
        const API_URL = 'https://open-maintenance.onrender.com';
        
        // Cargar sistemas
        cargarSistemas();
        
        async function cargarSistemas() {
          try {
            const response = await fetch(API_URL + '/api/gerencia/sistemas');
            const sistemas = await response.json();
            
            const grid = document.getElementById('sistemasGrid');
            grid.innerHTML = sistemas.map(s => \`
              <div class="sistema-card \${s.estado}" onclick="verActividades('\${s.sistema}')">
                <div class="status">\${getStatusIcon(s.estado)}</div>
                <h3>\${s.sistema}</h3>
                <p>\${s.estado === 'ok' ? 'Operativo' : s.estado === 'pendiente' ? 'Pendiente' : 'Atención'}</p>
                <small>\${s.actividades_30d || 0} actividades (30 días)</small>
              </div>
            \`).join('');
          } catch (error) {
            console.error('Error:', error);
          }
        }
        
        async function verActividades(sistema) {
          try {
            const response = await fetch(API_URL + '/api/gerencia/sistema/' + encodeURIComponent(sistema) + '/pendientes');
            const actividades = await response.json();
            
            const panel = document.getElementById('actividadesPanel');
            const titulo = document.getElementById('panelTitulo');
            const lista = document.getElementById('actividadesList');
            
            titulo.textContent = \`Actividades pendientes - \${sistema}\`;
            
            if (actividades.length === 0) {
              lista.innerHTML = '<p style="text-align: center; padding: 20px; color: #666;">No hay actividades pendientes para este sistema.</p>';
            } else {
              lista.innerHTML = actividades.map(a => \`
                <div class="actividad-item">
                  <strong>\${a.actividad}</strong>
                  <div style="color: #666; margin-top: 5px;">
                    \${a.fecha} • \${a.tipo_mantenimiento}
                  </div>
                  \${a.observaciones ? '<div style="margin-top: 5px; font-style: italic;">' + a.observaciones + '</div>' : ''}
                </div>
              \`).join('');
            }
            
            panel.style.display = 'block';
            panel.scrollIntoView({ behavior: 'smooth' });
          } catch (error) {
            console.error('Error:', error);
          }
        }
        
        function getStatusIcon(estado) {
          return estado === 'ok' ? '🟢' : estado === 'pendiente' ? '🔴' : '🟡';
        }
        
        // Auto-refresh cada 2 minutos
        setInterval(cargarSistemas, 120000);
      </script>
    </body>
    </html>
  `);
});

// Página principal
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Bitácora Torre K</title></head>
    <body style="font-family: Arial, sans-serif; padding: 30px; max-width: 800px; margin: 0 auto; text-align: center;">
      <h1 style="color: #1e88e5;">🏢 Bitácora Torre K</h1>
      <div style="margin: 40px 0;">
        <div style="display: inline-block; margin: 20px; padding: 30px; background: #e3f2fd; border-radius: 10px; width: 300px;">
          <h2>👷 Para Técnicos</h2>
          <p>Registra tus actividades diarias</p>
          <a href="/tecnico" style="display: inline-block; background: #1e88e5; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Abrir Bitácora</a>
        </div>
        
        <div style="display: inline-block; margin: 20px; padding: 30px; background: #f3e5f5; border-radius: 10px; width: 300px;">
          <h2>👔 Para Gerencia</h2>
          <p>Monitorea estado de sistemas</p>
          <a href="/gerencia" style="display: inline-block; background: #7b1fa2; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Abrir Dashboard</a>
        </div>
      </div>
      
      <div style="margin-top: 40px; color: #666;">
        <p>Sistema simple para registro de mantenimiento</p>
        <p><strong>Regla:</strong> Sin registro, no se hizo.</p>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Bitácora Torre K iniciada en puerto ${PORT}`);
});
