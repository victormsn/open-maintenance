const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Base de datos SQLite
const db = new sqlite3.Database('/tmp/database.sqlite');

// ==================== CREAR TABLAS MEJORADAS ====================
db.serialize(() => {
  // Tabla principal de actividades diarias
  db.run(`
    CREATE TABLE IF NOT EXISTS actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      ubicacion TEXT NOT NULL,
      actividad TEXT NOT NULL,
      sistema TEXT,
      tipo_actividad TEXT CHECK(tipo_actividad IN ('electricidad', 'plomeria', 'tablaroca', 'pintura', 'soldadura', 'jardineria', 'redes', 'limpieza', 'otro')),
      
      -- Equipos críticos (si aplica)
      equipo_critico TEXT CHECK(equipo_critico IN ('Elevador Mitsubishi', 'Rampa Hidráulica', 'Paneles Solares', 'Planta de Emergencia', 'Bomba Contra Incendio', '')),
      
      -- Datos de consumo (si aplica)
      agua_consumida REAL,
      energia_consumida REAL,
      observaciones TEXT,
      
      -- Control
      tecnico TEXT DEFAULT 'Técnico Torre K',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de EQUIPOS CRÍTICOS (con semaforización)
  db.run(`
    CREATE TABLE IF NOT EXISTS equipos_criticos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      estado TEXT CHECK(estado IN ('verde', 'amarillo', 'rojo')) DEFAULT 'verde',
      ubicacion TEXT,
      ultima_revision TEXT,
      proximo_mtto TEXT,
      horas_operacion INTEGER DEFAULT 0,
      observaciones TEXT,
      prioridad INTEGER DEFAULT 1
    )
  `);

  // Insertar equipos críticos
  const equiposCriticos = [
    { nombre: 'Elevador Mitsubishi', ubicacion: 'Torre K', prioridad: 1 },
    { nombre: 'Rampa Hidráulica', ubicacion: 'Estacionamiento', prioridad: 2 },
    { nombre: 'Paneles Solares', ubicacion: 'Azotea', prioridad: 2 },
    { nombre: 'Planta de Emergencia', ubicacion: 'Sótano', prioridad: 1 },
    { nombre: 'Bomba Contra Incendio', ubicacion: 'Sótano', prioridad: 1 }
  ];

  equiposCriticos.forEach(equipo => {
    db.run(
      `INSERT OR IGNORE INTO equipos_criticos (nombre, ubicacion, prioridad) VALUES (?, ?, ?)`,
      [equipo.nombre, equipo.ubicacion, equipo.prioridad]
    );
  });

  console.log('✅ Base de datos optimizada lista');
});

// ==================== ENDPOINTS PRINCIPALES ====================

// 1. REGISTRAR ACTIVIDAD DIARIA (FÁCIL Y RÁPIDO)
app.post('/api/actividad', (req, res) => {
  const {
    fecha = new Date().toISOString().split('T')[0],
    hora = new Date().toLocaleTimeString('es-MX', { hour12: false, hour: '2-digit', minute: '2-digit' }),
    ubicacion,
    actividad,
    sistema,
    tipo_actividad = 'otro',
    equipo_critico = '',
    agua_consumida,
    energia_consumida,
    observaciones = ''
  } = req.body;

  // Validar campos mínimos
  if (!ubicacion || !actividad) {
    return res.status(400).json({ error: 'Ubicación y actividad son requeridas' });
  }

  db.run(`
    INSERT INTO actividades 
    (fecha, hora, ubicacion, actividad, sistema, tipo_actividad, equipo_critico, agua_consumida, energia_consumida, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fecha, hora, ubicacion, actividad, sistema, tipo_actividad, equipo_critico, agua_consumida, energia_consumida, observaciones],
    function(err) {
      if (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
      }

      // Actualizar estado del equipo crítico si se menciona
      if (equipo_critico && observaciones.toLowerCase().includes('falla')) {
        db.run(
          `UPDATE equipos_criticos SET estado = 'amarillo', observaciones = ? WHERE nombre = ?`,
          [observaciones, equipo_critico]
        );
      }

      res.json({
        success: true,
        id: this.lastID,
        message: '✅ Actividad registrada correctamente'
      });
    }
  );
});

// 2. OBTENER ACTIVIDADES DEL DÍA (para el dashboard)
app.get('/api/actividades/hoy', (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  
  db.all(
    `SELECT *, 
            CASE 
              WHEN equipo_critico != '' THEN '⚡ ' || equipo_critico
              ELSE sistema
            END as categoria
     FROM actividades 
     WHERE fecha = ? 
     ORDER BY hora DESC`,
    [hoy],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 3. OBTENER ACTIVIDADES POR FECHA (para historial)
app.get('/api/actividades/:fecha', (req, res) => {
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha = ? 
     ORDER BY hora DESC`,
    [req.params.fecha],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 4. DASHBOARD GERENCIA (con semaforización)
app.get('/api/dashboard/gerencia', (req, res) => {
  // Obtener estado de equipos críticos
  db.all(
    `SELECT * FROM equipos_criticos ORDER BY prioridad, nombre`,
    [],
    (err, equipos) => {
      if (err) return res.status(500).json({ error: err.message });

      // Obtener actividades de hoy
      const hoy = new Date().toISOString().split('T')[0];
      db.all(
        `SELECT COUNT(*) as total, 
                SUM(COALESCE(agua_consumida, 0)) as agua_total,
                SUM(COALESCE(energia_consumida, 0)) as energia_total
         FROM actividades WHERE fecha = ?`,
        [hoy],
        (err, totals) => {
          if (err) return res.status(500).json({ error: err.message });

          // Obtener últimas 10 actividades
          db.all(
            `SELECT * FROM actividades 
             ORDER BY fecha DESC, hora DESC 
             LIMIT 10`,
            [],
            (err, ultimas) => {
              if (err) return res.status(500).json({ error: err.message });

              res.json({
                fecha: hoy,
                equipos_criticos: equipos,
                resumen_hoy: totals[0],
                ultimas_actividades: ultimas,
                semaforo: {
                  verdes: equipos.filter(e => e.estado === 'verde').length,
                  amarillos: equipos.filter(e => e.estado === 'amarillo').length,
                  rojos: equipos.filter(e => e.estado === 'rojo').length
                }
              });
            }
          );
        }
      );
    }
  );
});

// 5. ACTUALIZAR ESTADO DE EQUIPO CRÍTICO
app.put('/api/equipo/:nombre/estado', (req, res) => {
  const { estado, observaciones } = req.body;
  
  if (!['verde', 'amarillo', 'rojo'].includes(estado)) {
    return res.status(400).json({ error: 'Estado debe ser: verde, amarillo o rojo' });
  }

  db.run(
    `UPDATE equipos_criticos 
     SET estado = ?, observaciones = ?, ultima_revision = ?
     WHERE nombre = ?`,
    [estado, observaciones, new Date().toISOString().split('T')[0], req.params.nombre],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      
      res.json({
        success: true,
        message: `Estado actualizado a: ${estado.toUpperCase()}`
      });
    }
  );
});

// 6. DESCARGAR EXCEL (exportar a CSV)
app.get('/api/descargar/:fecha', (req, res) => {
  const { fecha } = req.params;
  const fechaDesde = fecha || new Date().toISOString().split('T')[0];
  
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha >= ? 
     ORDER BY fecha DESC, hora DESC`,
    [fechaDesde],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      // Convertir a CSV
      let csv = 'Fecha,Hora,Ubicación,Actividad,Sistema,Tipo,Equipo Crítico,Agua (L),Energía (kWh),Observaciones,Técnico\n';
      
      rows.forEach(row => {
        csv += `"${row.fecha}","${row.hora}","${row.ubicacion}","${row.actividad}","${row.sistema || ''}","${row.tipo_actividad}","${row.equipo_critico || ''}","${row.agua_consumida || ''}","${row.energia_consumida || ''}","${row.observaciones || ''}","${row.tecnico}"\n`;
      });

      // Enviar como archivo descargable
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="mantenimiento_torre_k_${fechaDesde}.csv"`);
      res.send(csv);
    }
  );
});

// ==================== INTERFACES HTML MEJORADAS ====================

// INTERFAZ TÉCNICO (SÚPER SIMPLE)
app.get('/tecnico', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitácora Diaria - Torre K</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f8f9fa; }
        .container { max-width: 800px; margin: 0 auto; padding: 20px; }
        
        .header { 
          background: linear-gradient(135deg, #2c3e50 0%, #1a252f 100%);
          color: white; 
          padding: 25px; 
          border-radius: 10px; 
          margin-bottom: 25px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .form-rapido {
          background: white;
          padding: 25px;
          border-radius: 10px;
          margin-bottom: 25px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        
        .form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin-bottom: 20px;
        }
        
        label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: #2c3e50;
          font-size: 0.9em;
        }
        
        input, select, textarea {
          width: 100%;
          padding: 12px;
          border: 2px solid #e9ecef;
          border-radius: 8px;
          font-size: 16px;
          transition: border 0.3s;
        }
        
        input:focus, select:focus, textarea:focus {
          outline: none;
          border-color: #3498db;
        }
        
        .btn {
          background: #27ae60;
          color: white;
          border: none;
          padding: 15px 30px;
          border-radius: 8px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.3s;
          display: inline-block;
          text-align: center;
        }
        
        .btn:hover { background: #219653; }
        .btn-descargar { background: #2980b9; margin-left: 10px; }
        .btn-descargar:hover { background: #1c6ea4; }
        
        .actividades-hoy {
          background: white;
          padding: 25px;
          border-radius: 10px;
          margin-top: 25px;
        }
        
        .actividad-item {
          padding: 15px;
          border-left: 4px solid #27ae60;
          margin-bottom: 10px;
          background: #f8f9fa;
          border-radius: 6px;
        }
        
        .actividad-item.critico { border-left-color: #e74c3c; }
        .actividad-item.atencion { border-left-color: #f39c12; }
        
        .hora {
          font-size: 0.9em;
          color: #7f8c8d;
          background: #e9ecef;
          padding: 3px 8px;
          border-radius: 12px;
          display: inline-block;
          margin-right: 10px;
        }
        
        .equipo-critico {
          display: inline-block;
          background: #fff3cd;
          color: #856404;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 0.85em;
          margin-left: 10px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>📝 Bitácora Diaria - Torre K</h1>
          <p>Registro rápido de actividades • ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            <strong>Regla:</strong> Sin registro, no se hizo.
          </p>
        </div>
        
        <!-- FORMULARIO RÁPIDO -->
        <div class="form-rapido">
          <h2 style="margin-bottom: 20px; color: #2c3e50;">➕ Nueva Actividad</h2>
          
          <form id="formActividad">
            <div class="form-row">
              <div>
                <label>📍 Ubicación:</label>
                <input type="text" id="ubicacion" placeholder="Ej: Planta Baja, Azotea, Sótano..." required>
              </div>
              <div>
                <label>🕒 Hora:</label>
                <input type="time" id="hora" value="${new Date().toLocaleTimeString('es-MX', { hour12: false, hour: '2-digit', minute: '2-digit' })}" required>
              </div>
            </div>
            
            <div style="margin-bottom: 20px;">
              <label>🔧 Actividad realizada:</label>
              <textarea id="actividad" rows="2" placeholder="Ej: Se cambió horario del timer a 6 PM encendido, 3 AM apagado..." required></textarea>
            </div>
            
            <div class="form-row">
              <div>
                <label>📋 Tipo de actividad:</label>
                <select id="tipo_actividad">
                  <option value="electricidad">⚡ Electricidad</option>
                  <option value="plomeria">🔧 Plomería</option>
                  <option value="jardineria">🌿 Jardinería</option>
                  <option value="limpieza">🧹 Limpieza</option>
                  <option value="redes">🌐 Redes</option>
                  <option value="pintura">🎨 Pintura</option>
                  <option value="tablaroca">📐 Tablaroca</option>
                  <option value="soldadura">🔩 Soldadura</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              
              <div>
                <label>⚡ Equipo crítico (si aplica):</label>
                <select id="equipo_critico">
                  <option value="">-- Ninguno --</option>
                  <option value="Elevador Mitsubishi">🚪 Elevador Mitsubishi</option>
                  <option value="Rampa Hidráulica">🔄 Rampa Hidráulica</option>
                  <option value="Paneles Solares">☀️ Paneles Solares</option>
                  <option value="Planta de Emergencia">🔋 Planta Emergencia</option>
                  <option value="Bomba Contra Incendio">🚒 Bomba Incendio</option>
                </select>
              </div>
            </div>
            
            <div class="form-row">
              <div>
                <label>💧 Agua consumida (litros):</label>
                <input type="number" id="agua_consumida" step="0.1" placeholder="Opcional">
              </div>
              <div>
                <label>⚡ Energía consumida (kWh):</label>
                <input type="number" id="energia_consumida" step="0.1" placeholder="Opcional">
              </div>
            </div>
            
            <div style="margin-bottom: 20px;">
              <label>📝 Observaciones:</label>
              <textarea id="observaciones" rows="2" placeholder="Detalles importantes, hallazgos..."></textarea>
            </div>
            
            <button type="submit" class="btn">✅ Guardar Actividad</button>
          </form>
        </div>
        
        <!-- ACTIVIDADES DE HOY -->
        <div class="actividades-hoy">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="color: #2c3e50;">📋 Actividades de hoy</h2>
            <div>
              <button onclick="cargarActividades()" class="btn">🔄 Actualizar</button>
              <button onclick="descargarExcel()" class="btn btn-descargar">📥 Descargar Excel</button>
            </div>
          </div>
          
          <div id="listaActividades">
            <p style="text-align: center; color: #7f8c8d; padding: 20px;">
              Cargando actividades...
            </p>
          </div>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        
        // Cargar actividades al iniciar
        cargarActividades();
        
        // Formulario para agregar actividad
        document.getElementById('formActividad').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const actividad = {
            ubicacion: document.getElementById('ubicacion').value,
            hora: document.getElementById('hora').value,
            actividad: document.getElementById('actividad').value,
            tipo_actividad: document.getElementById('tipo_actividad').value,
            equipo_critico: document.getElementById('equipo_critico').value,
            agua_consumida: document.getElementById('agua_consumida').value || null,
            energia_consumida: document.getElementById('energia_consumida').value || null,
            observaciones: document.getElementById('observaciones').value
          };
          
          try {
            const response = await fetch(API_URL + '/api/actividad', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(actividad)
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert('✅ Actividad registrada correctamente');
              document.getElementById('formActividad').reset();
              document.getElementById('hora').value = new Date().toLocaleTimeString('es-MX', { hour12: false, hour: '2-digit', minute: '2-digit' });
              cargarActividades();
            } else {
              alert('❌ Error: ' + (data.error || 'No se pudo guardar'));
            }
          } catch (error) {
            alert('❌ Error de conexión');
            console.error(error);
          }
        });
        
        // Cargar actividades
        async function cargarActividades() {
          try {
            const response = await fetch(API_URL + '/api/actividades/hoy');
            const actividades = await response.json();
            
            const lista = document.getElementById('listaActividades');
            
            if (actividades.length === 0) {
              lista.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px;">No hay actividades registradas hoy</p>';
              return;
            }
            
            lista.innerHTML = actividades.map(a => \`
              <div class="actividad-item \${a.equipo_critico ? 'critico' : ''}">
                <div>
                  <span class="hora">\${a.hora}</span>
                  <strong>\${a.actividad}</strong>
                  \${a.equipo_critico ? '<span class="equipo-critico">' + a.equipo_critico + '</span>' : ''}
                </div>
                <div style="margin-top: 8px; color: #5a6268;">
                  📍 \${a.ubicacion} • \${a.tipo_actividad}
                  \${a.agua_consumida ? ' • 💧 ' + a.agua_consumida + 'L' : ''}
                  \${a.energia_consumida ? ' • ⚡ ' + a.energia_consumida + 'kWh' : ''}
                </div>
                \${a.observaciones ? '<div style="margin-top: 8px; font-style: italic; color: #6c757d;">' + a.observaciones + '</div>' : ''}
              </div>
            \`).join('');
          } catch (error) {
            console.error('Error cargando actividades:', error);
            document.getElementById('listaActividades').innerHTML = 
              '<p style="color: #e74c3c; text-align: center;">Error cargando actividades</p>';
          }
        }
        
        // Descargar Excel
        async function descargarExcel() {
          const hoy = new Date().toISOString().split('T')[0];
          window.open(API_URL + '/api/descargar/' + hoy, '_blank');
        }
        
        // Auto-refresh cada 2 minutos
        setInterval(cargarActividades, 120000);
      </script>
    </body>
    </html>
  `);
});

// DASHBOARD GERENCIA (CON SEMAFORIZACIÓN)
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
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f8f9fa; }
        .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
        
        .header { 
          background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
          color: white; 
          padding: 30px; 
          border-radius: 10px; 
          margin-bottom: 30px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }
        
        .semaforo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .semaforo-card {
          background: white;
          padding: 25px;
          border-radius: 10px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
          text-align: center;
          transition: transform 0.3s;
          border-top: 5px solid;
        }
        
        .semaforo-card:hover { transform: translateY(-5px); }
        .semaforo-card.verde { border-color: #27ae60; }
        .semaforo-card.amarillo { border-color: #f39c12; }
        .semaforo-card.rojo { border-color: #e74c3c; }
        
        .status-icon {
          font-size: 3em;
          margin-bottom: 15px;
        }
        
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin: 30px 0;
        }
        
        .stat-card {
          background: white;
          padding: 20px;
          border-radius: 10px;
          text-align: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        
        .stat-value {
          font-size: 2.5em;
          font-weight: bold;
          margin: 10px 0;
        }
        
        .actividades-recientes {
          background: white;
          padding: 25px;
          border-radius: 10px;
          margin-top: 30px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
        }
        
        .btn {
          background: #2980b9;
          color: white;
          border: none;
          padding: 12px 25px;
          border-radius: 8px;
          font-size: 16px;
          cursor: pointer;
          margin: 10px 5px;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }
        
        .btn:hover { background: #1c6ea4; }
        .btn-descargar { background: #27ae60; }
        .btn-descargar:hover { background: #219653; }
        
        .badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 0.85em;
          font-weight: 600;
          margin-left: 10px;
        }
        
        .badge-verde { background: #d5f4e6; color: #27ae60; }
        .badge-amarillo { background: #fff3cd; color: #856404; }
        .badge-rojo { background: #f8d7da; color: #721c24; }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🏢 Dashboard Gerencia - Torre K</h1>
          <p>Estado de sistemas en tiempo real • ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <div style="margin-top: 20px;">
            <button onclick="cargarDashboard()" class="btn">🔄 Actualizar</button>
            <button onclick="descargarReporte()" class="btn btn-descargar">📥 Descargar Reporte</button>
            <button onclick="window.open('/tecnico', '_blank')" class="btn">👷 Ver Bitácora</button>
          </div>
        </div>
        
        <!-- SEMÁFORO DE EQUIPOS CRÍTICOS -->
        <h2 style="color: #2c3e50; margin-bottom: 20px;">🚦 Semáforo de Equipos Críticos</h2>
        <div class="semaforo-grid" id="semaforoGrid">
          <p>Cargando equipos...</p>
        </div>
        
        <!-- ESTADÍSTICAS -->
        <div class="stats-grid">
          <div class="stat-card">
            <div>📋 Actividades Hoy</div>
            <div class="stat-value" id="totalActividades">0</div>
            <div>registros</div>
          </div>
          
          <div class="stat-card">
            <div>💧 Agua Consumida</div>
            <div class="stat-value" id="totalAgua">0</div>
            <div>litros</div>
          </div>
          
          <div class="stat-card">
            <div>⚡ Energía Consumida</div>
            <div class="stat-value" id="totalEnergia">0</div>
            <div>kWh</div>
          </div>
          
          <div class="stat-card">
            <div>🔧 Equipos Operativos</div>
            <div class="stat-value" id="equiposVerdes">0</div>
            <div>de <span id="totalEquipos">0</span></div>
          </div>
        </div>
        
        <!-- ACTIVIDADES RECIENTES -->
        <div class="actividades-recientes">
          <h2 style="color: #2c3e50; margin-bottom: 20px;">📝 Actividades Recientes</h2>
          <div id="actividadesRecientes">
            <p>Cargando actividades...</p>
          </div>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        
        // Cargar dashboard
        cargarDashboard();
        
        async function cargarDashboard() {
          try {
            const response = await fetch(API_URL + '/api/dashboard/gerencia');
            const data = await response.json();
            
            // Actualizar semáforo
            const semaforoGrid = document.getElementById('semaforoGrid');
            semaforoGrid.innerHTML = data.equipos_criticos.map(eq => \`
              <div class="semaforo-card \${eq.estado}">
                <div class="status-icon">
                  \${eq.estado === 'verde' ? '🟢' : eq.estado === 'amarillo' ? '🟡' : '🔴'}
                </div>
                <h3>\${eq.nombre}</h3>
                <p>\${eq.ubicacion}</p>
                <div style="margin: 15px 0;">
                  <span class="badge badge-\${eq.estado}">
                    \${eq.estado === 'verde' ? 'OPERATIVO' : eq.estado === 'amarillo' ? 'ATENCIÓN' : 'CRÍTICO'}
                  </span>
                </div>
                <p style="font-size: 0.9em; color: #666; margin-top: 10px;">
                  Última revisión: \${eq.ultima_revision || 'N/A'}
                </p>
                <button onclick="cambiarEstado('\${eq.nombre}')" class="btn" style="margin-top: 10px;">
                  Cambiar Estado
                </button>
              </div>
            \`).join('');
            
            // Actualizar estadísticas
            document.getElementById('totalActividades').textContent = data.resumen_hoy.total || 0;
            document.getElementById('totalAgua').textContent = data.resumen_hoy.agua_total || 0;
            document.getElementById('totalEnergia').textContent = data.resumen_hoy.energia_total || 0;
            document.getElementById('equiposVerdes').textContent = data.semaforo.verdes;
            document.getElementById('totalEquipos').textContent = data.equipos_criticos.length;
            
            // Actualizar actividades recientes
            const actividadesDiv = document.getElementById('actividadesRecientes');
            actividadesDiv.innerHTML = data.ultimas_actividades.map(a => \`
              <div style="padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
                <div>
                  <div>
                    <strong>\${a.actividad}</strong>
                    \${a.equipo_critico ? '<span class="badge" style="background: #fff3cd;">' + a.equipo_critico + '</span>' : ''}
                  </div>
                  <div style="color: #666; font-size: 0.9em; margin-top: 5px;">
                    📍 \${a.ubicacion} • \${a.hora} • \${a.fecha}
                  </div>
                </div>
                <div style="color: #999; font-size: 0.9em;">
                  \${a.tipo_actividad}
                </div>
              </div>
            \`).join('');
            
          } catch (error) {
            console.error('Error cargando dashboard:', error);
            alert('Error cargando datos del dashboard');
          }
        }
        
        function cambiarEstado(nombreEquipo) {
          const nuevoEstado = prompt('Cambiar estado de ' + nombreEquipo + '\\n(verde, amarillo, rojo):');
          
          if (nuevoEstado && ['verde', 'amarillo', 'rojo'].includes(nuevoEstado.toLowerCase())) {
            const observaciones = prompt('Observaciones (opcional):');
            
            fetch(API_URL + '/api/equipo/' + encodeURIComponent(nombreEquipo) + '/estado', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                estado: nuevoEstado.toLowerCase(),
                observaciones: observaciones || ''
              })
            })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                alert('✅ Estado actualizado');
                cargarDashboard();
              }
            })
            .catch(err => {
              alert('❌ Error actualizando estado');
            });
          }
        }
        
        function descargarReporte() {
          const hoy = new Date().toISOString().split('T')[0];
          window.open(API_URL + '/api/descargar/' + hoy, '_blank');
        }
        
        // Auto-refresh cada 3 minutos
        setInterval(cargarDashboard, 180000);
      </script>
    </body>
    </html>
  `);
});

// PÁGINA PRINCIPAL
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sistema de Mantenimiento - Torre K</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { 
          font-family: 'Segoe UI', system-ui, sans-serif; 
          margin: 0; 
          padding: 0; 
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .container {
          background: white;
          border-radius: 20px;
          padding: 40px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
          text-align: center;
          max-width: 500px;
          width: 90%;
        }
        
        h1 { 
          color: #2c3e50; 
          margin-bottom: 10px;
          font-size: 2.5em;
        }
        
        .subtitle {
          color: #7f8c8d;
          margin-bottom: 30px;
          font-size: 1.1em;
        }
        
        .card {
          background: #f8f9fa;
          border-radius: 15px;
          padding: 30px;
          margin: 20px 0;
          transition: transform 0.3s, box-shadow 0.3s;
          cursor: pointer;
          border: 2px solid transparent;
        }
        
        .card:hover {
          transform: translateY(-5px);
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          border-color: #3498db;
        }
        
        .card.tecnico { border-left: 5px solid #27ae60; }
        .card.gerencia { border-left: 5px solid #2980b9; }
        
        .btn {
          display: inline-block;
          background: #3498db;
          color: white;
          text-decoration: none;
          padding: 15px 30px;
          border-radius: 10px;
          font-weight: bold;
          margin-top: 20px;
          transition: background 0.3s;
        }
        
        .btn:hover { background: #2980b9; }
        .btn-tecnico { background: #27ae60; }
        .btn-tecnico:hover { background: #219653; }
        .btn-gerencia { background: #9b59b6; }
        .btn-gerencia:hover { background: #8e44ad; }
        
        .rule {
          margin: 30px 0;
          padding: 15px;
          background: #fff3cd;
          border-radius: 10px;
          border-left: 4px solid #f39c12;
          font-style: italic;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏢 Torre K Maintenance</h1>
        <div class="subtitle">
          Sistema abierto de mantenimiento • ${new Date().toLocaleDateString('es-MX')}
        </div>
        
        <div class="rule">
          <strong>📋 Regla fundamental:</strong><br>
          "Sin registro, no se hizo"
        </div>
        
        <div class="card tecnico" onclick="window.location.href='/tecnico'">
          <h2>👷 Para Técnicos</h2>
          <p>Registro rápido de actividades diarias</p>
          <p style="font-size: 0.9em; color: #666;">
            • Agregar actividades en segundos<br>
            • Registrar consumo de agua/energía<br>
            • Seguimiento de equipos críticos
          </p>
          <a href="/tecnico" class="btn btn-tecnico">Abrir Bitácora →</a>
        </div>
        
        <div class="card gerencia" onclick="window.location.href='/gerencia'">
          <h2>👔 Para Gerencia</h2>
          <p>Dashboard con semáforo de estado</p>
          <p style="font-size: 0.9em; color: #666;">
            • Ver estado de equipos (verde/amarillo/rojo)<br>
            • Revisar actividades recientes<br>
            • Descargar reportes en Excel
          </p>
          <a href="/gerencia" class="btn btn-gerencia">Abrir Dashboard →</a>
        </div>
        
        <div style="margin-top: 30px; color: #7f8c8d; font-size: 0.9em;">
          <p>OpenMaintenance Torre K • Sin burocracia, sin excusas</p>
          <p>Backend: <a href="${process.env.RENDER_EXTERNAL_URL || 'https://open-maintenance.onrender.com'}" target="_blank">${process.env.RENDER_EXTERNAL_URL || 'https://open-maintenance.onrender.com'}</a></p>
        </div>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=========================================`);
  console.log(`🚀 Sistema de Mantenimiento Torre K`);
  console.log(`📅 ${new Date().toLocaleString('es-MX')}`);
  console.log(`🌐 URL Principal: http://localhost:${PORT}`);
  console.log(`👷 Técnico: http://localhost:${PORT}/tecnico`);
  console.log(`👔 Gerencia: http://localhost:${PORT}/gerencia`);
  console.log(`=========================================\n`);
});
   
