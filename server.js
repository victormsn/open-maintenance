const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

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
      tipo_actividad TEXT,
      
      -- Sistemas/equipos afectados
      sistemas_afectados TEXT,
      
      -- Datos de consumo (si aplica)
      agua_consumida REAL,
      energia_consumida REAL,
      observaciones TEXT,
      
      -- Cambio de estado de equipo (si aplica)
      equipo_critico TEXT,
      nuevo_estado TEXT,
      
      tecnico TEXT DEFAULT 'Técnico Torre K',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de SISTEMAS CRÍTICOS (con semaforización automática)
  db.run(`
    CREATE TABLE IF NOT EXISTS sistemas_criticos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      categoria TEXT NOT NULL,
      estado TEXT CHECK(estado IN ('verde', 'amarillo', 'rojo')) DEFAULT 'verde',
      ubicacion TEXT,
      ultima_actividad TEXT,
      observaciones TEXT,
      prioridad INTEGER DEFAULT 1
    )
  `);

  // Insertar TODOS los sistemas críticos (actualizado)
  const sistemasCriticos = [
    // CATEGORÍA 1: INFRAESTRUCTURA CRÍTICA (prioridad máxima)
    { nombre: 'Cisterna de Agua', categoria: 'agua', ubicacion: 'Sótano', prioridad: 1 },
    { nombre: 'Tanque Elevado', categoria: 'agua', ubicacion: 'Azotea', prioridad: 1 },
    { nombre: 'Sistema Eléctrico Principal', categoria: 'electricidad', ubicacion: 'Cuarto Eléctrico', prioridad: 1 },
    { nombre: 'Tablero General', categoria: 'electricidad', ubicacion: 'Sótano', prioridad: 1 },
    { nombre: 'Elevador Mitsubishi', categoria: 'transporte', ubicacion: 'Torre K', prioridad: 1 },
    
    // CATEGORÍA 2: SEGURIDAD
    { nombre: 'Bomba Contra Incendio', categoria: 'seguridad', ubicacion: 'Sótano', prioridad: 1 },
    { nombre: 'Sistema Contra Incendio', categoria: 'seguridad', ubicacion: 'Todo el edificio', prioridad: 1 },
    { nombre: 'Planta de Emergencia', categoria: 'electricidad', ubicacion: 'Sótano', prioridad: 1 },
    
    // CATEGORÍA 3: SISTEMAS DE INGRESOS
    { nombre: 'Software de Tickets Estacionamiento', categoria: 'ingresos', ubicacion: 'Caseta Estacionamiento', prioridad: 1 },
    { nombre: 'Barrera Estacionamiento', categoria: 'ingresos', ubicacion: 'Entrada Estacionamiento', prioridad: 2 },
    { nombre: 'Cámaras de Seguridad', categoria: 'seguridad', ubicacion: 'Todo el edificio', prioridad: 2 },
    
    // CATEGORÍA 4: INFRAESTRUCTURA GENERAL
    { nombre: 'Paneles Solares', categoria: 'energia', ubicacion: 'Azotea', prioridad: 2 },
    { nombre: 'Rampa Hidráulica', categoria: 'acceso', ubicacion: 'Estacionamiento', prioridad: 2 },
    { nombre: 'Sistema de Drenaje', categoria: 'plomeria', ubicacion: 'Todo el edificio', prioridad: 3 },
    { nombre: 'Aire Acondicionado Central', categoria: 'clima', ubicacion: 'Azotea', prioridad: 3 },
    { nombre: 'Sistema de Gas', categoria: 'gas', ubicacion: 'Cocinas', prioridad: 1 },
  ];

  sistemasCriticos.forEach(sistema => {
    db.run(
      `INSERT OR IGNORE INTO sistemas_criticos (nombre, categoria, ubicacion, prioridad) VALUES (?, ?, ?, ?)`,
      [sistema.nombre, sistema.categoria, sistema.ubicacion, sistema.prioridad]
    );
  });

  console.log('✅ Base de datos con sistemas críticos completa');
});

// ==================== ENDPOINTS MEJORADOS ====================

// 1. REGISTRAR ACTIVIDAD DIARIA (con opción de cambiar estado de sistema)
app.post('/api/actividad', (req, res) => {
  const {
    fecha = new Date().toISOString().split('T')[0],
    hora = new Date().toLocaleTimeString('es-MX', { hour12: false, hour: '2-digit', minute: '2-digit' }),
    ubicacion,
    actividad,
    tipo_actividad = 'otro',
    sistemas_afectados = '',
    equipo_critico = '',
    nuevo_estado = '',
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
    (fecha, hora, ubicacion, actividad, tipo_actividad, sistemas_afectados, equipo_critico, nuevo_estado, agua_consumida, energia_consumida, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fecha, hora, ubicacion, actividad, tipo_actividad, sistemas_afectados, equipo_critico, nuevo_estado, agua_consumida || null, energia_consumida || null, observaciones],
    function(err) {
      if (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
      }

      // ✅ ACTUALIZAR ESTADO DEL SISTEMA CRÍTICO SI SE ESPECIFICA
      if (equipo_critico && nuevo_estado && ['verde', 'amarillo', 'rojo'].includes(nuevo_estado)) {
        db.run(
          `UPDATE sistemas_criticos 
           SET estado = ?, ultima_actividad = ?, observaciones = ?
           WHERE nombre = ?`,
          [nuevo_estado, `${fecha} ${hora}`, observaciones || 'Estado cambiado por técnico', equipo_critico],
          function(updateErr) {
            if (updateErr) console.error('Error actualizando sistema:', updateErr);
            else console.log(`✅ Estado de ${equipo_critico} cambiado a ${nuevo_estado}`);
          }
        );
      }

      res.json({
        success: true,
        id: this.lastID,
        message: '✅ Actividad registrada correctamente' + 
                (equipo_critico ? ` y estado de ${equipo_critico} actualizado` : '')
      });
    }
  );
});

// 2. OBTENER ACTIVIDADES DEL DÍA
app.get('/api/actividades/hoy', (req, res) => {
  const hoy = new Date().toISOString().split('T')[0];
  
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha = ? 
     ORDER BY hora DESC`,
    [hoy],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 3. DASHBOARD GERENCIA (solo lectura)
app.get('/api/dashboard/gerencia', (req, res) => {
  // Obtener sistemas por categoría
  db.all(
    `SELECT *, 
            CASE 
              WHEN estado = 'verde' THEN '🟢 OPERATIVO'
              WHEN estado = 'amarillo' THEN '🟡 ATENCIÓN'
              ELSE '🔴 CRÍTICO'
            END as estado_texto
     FROM sistemas_criticos 
     ORDER BY 
       CASE estado 
         WHEN 'rojo' THEN 1
         WHEN 'amarillo' THEN 2
         ELSE 3
       END,
       prioridad,
       categoria,
       nombre`,
    [],
    (err, sistemas) => {
      if (err) return res.status(500).json({ error: err.message });

      // Obtener resumen por categoría
      db.all(
        `SELECT 
           categoria,
           COUNT(*) as total,
           SUM(CASE WHEN estado = 'verde' THEN 1 ELSE 0 END) as verdes,
           SUM(CASE WHEN estado = 'amarillo' THEN 1 ELSE 0 END) as amarillos,
           SUM(CASE WHEN estado = 'rojo' THEN 1 ELSE 0 END) as rojos
         FROM sistemas_criticos 
         GROUP BY categoria
         ORDER BY 
           SUM(CASE WHEN estado = 'rojo' THEN 1 ELSE 0 END) DESC,
           SUM(CASE WHEN estado = 'amarillo' THEN 1 ELSE 0 END) DESC`,
        [],
        (err, categorias) => {
          if (err) return res.status(500).json({ error: err.message });

          // Obtener últimas actividades con cambios de estado
          db.all(
            `SELECT * FROM actividades 
             WHERE equipo_critico != '' OR nuevo_estado != ''
             ORDER BY created_at DESC 
             LIMIT 10`,
            [],
            (err, cambios) => {
              if (err) return res.status(500).json({ error: err.message });

              res.json({
                fecha: new Date().toISOString().split('T')[0],
                sistemas_criticos: sistemas,
                resumen_categorias: categorias,
                cambios_recientes: cambios,
                semaforo_total: {
                  total: sistemas.length,
                  verdes: sistemas.filter(s => s.estado === 'verde').length,
                  amarillos: sistemas.filter(s => s.estado === 'amarillo').length,
                  rojos: sistemas.filter(s => s.estado === 'rojo').length
                }
              });
            }
          );
        }
      );
    }
  );
});

// 4. OBTENER SISTEMAS CRÍTICOS PARA SELECT (técnico)
app.get('/api/sistemas-criticos', (req, res) => {
  db.all(
    `SELECT nombre, categoria, estado, ubicacion 
     FROM sistemas_criticos 
     ORDER BY categoria, nombre`,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 5. HISTORIAL DE CAMBIOS DE UN SISTEMA
app.get('/api/historial-sistema/:nombre', (req, res) => {
  db.all(
    `SELECT fecha, hora, actividad, nuevo_estado, observaciones, tecnico
     FROM actividades 
     WHERE equipo_critico = ?
     ORDER BY fecha DESC, hora DESC
     LIMIT 20`,
    [req.params.nombre],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 6. DESCARGAR REPORTE COMPLETO
app.get('/api/descargar/reporte', (req, res) => {
  const fecha = new Date().toISOString().split('T')[0];
  
  // Obtener todas las actividades del mes
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha >= date('now', '-30 days')
     ORDER BY fecha DESC, hora DESC`,
    [],
    (err, actividades) => {
      if (err) return res.status(500).json({ error: err.message });

      // Obtener estado actual de sistemas
      db.all(
        `SELECT * FROM sistemas_criticos ORDER BY categoria, nombre`,
        [],
        (err, sistemas) => {
          if (err) return res.status(500).json({ error: err.message });

          // Crear CSV
          let csv = '=== SISTEMAS CRÍTICOS TORRE K ===\n';
          csv += 'Categoría,Sistema,Ubicación,Estado,Última Actividad,Observaciones\n';
          
          sistemas.forEach(s => {
            csv += `"${s.categoria}","${s.nombre}","${s.ubicacion}","${s.estado}","${s.ultima_actividad || ''}","${s.observaciones || ''}"\n`;
          });

          csv += '\n=== ACTIVIDADES RECIENTES (30 días) ===\n';
          csv += 'Fecha,Hora,Ubicación,Actividad,Sistema Afectado,Nuevo Estado,Observaciones\n';
          
          actividades.forEach(a => {
            csv += `"${a.fecha}","${a.hora}","${a.ubicacion}","${a.actividad}","${a.equipo_critico || ''}","${a.nuevo_estado || ''}","${a.observaciones || ''}"\n`;
          });

          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="reporte_torre_k_${fecha}.csv"`);
          res.send(csv);
        }
      );
    }
  );
});

// ==================== INTERFACES HTML ====================

// INTERFAZ TÉCNICO MEJORADA (con cambio de estado)
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
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #f8f9fa; }
        .container { max-width: 900px; margin: 0 auto; padding: 20px; }
        
        .header { 
          background: linear-gradient(135deg, #2c3e50 0%, #1a252f 100%);
          color: white; 
          padding: 25px; 
          border-radius: 10px; 
          margin-bottom: 25px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .form-section {
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
          margin-right: 10px;
        }
        
        .btn:hover { background: #219653; }
        .btn-cambiar-estado { background: #f39c12; }
        .btn-cambiar-estado:hover { background: #e67e22; }
        
        .actividad-item {
          padding: 15px;
          border-left: 4px solid;
          margin-bottom: 10px;
          background: #f8f9fa;
          border-radius: 6px;
        }
        
        .estado-verde { border-left-color: #27ae60; }
        .estado-amarillo { border-left-color: #f39c12; }
        .estado-rojo { border-left-color: #e74c3c; }
        
        .badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 12px;
          font-size: 0.85em;
          font-weight: 600;
          margin-left: 10px;
        }
        
        .badge-verde { background: #d5f4e6; color: #27ae60; }
        .badge-amarillo { background: #fff3cd; color: #856404; }
        .badge-rojo { background: #f8d7da; color: #721c24; }
        
        .estado-selector {
          display: flex;
          gap: 10px;
          margin-top: 10px;
        }
        
        .estado-btn {
          flex: 1;
          padding: 10px;
          text-align: center;
          border-radius: 6px;
          cursor: pointer;
          border: 2px solid #ddd;
          background: white;
          font-weight: 600;
        }
        
        .estado-btn.selected {
          border-width: 3px;
        }
        
        .estado-btn.verde { border-color: #27ae60; color: #27ae60; }
        .estado-btn.amarillo { border-color: #f39c12; color: #f39c12; }
        .estado-btn.rojo { border-color: #e74c3c; color: #e74c3c; }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🔧 Bitácora Técnico - Torre K</h1>
          <p>Registro de actividades y cambio de estado de sistemas • ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            <strong>⚠️ IMPORTANTE:</strong> Reporta fallas y cambia estado de sistemas aquí
          </p>
        </div>
        
        <!-- FORMULARIO PRINCIPAL -->
        <div class="form-section">
          <h2 style="margin-bottom: 20px; color: #2c3e50;">➕ Registrar Actividad</h2>
          
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
              <textarea id="actividad" rows="3" placeholder="Ej: Revisión de cisterna, cambio de bomba, reparación eléctrica..." required></textarea>
            </div>
            
            <div class="form-row">
              <div>
                <label>📋 Tipo de actividad:</label>
                <select id="tipo_actividad">
                  <option value="electricidad">⚡ Electricidad</option>
                  <option value="plomeria">🔧 Plomería</option>
                  <option value="agua">💧 Sistema de Agua</option>
                  <option value="seguridad">🛡️ Seguridad</option>
                  <option value="ingresos">💰 Sistemas de Ingresos</option>
                  <option value="jardineria">🌿 Jardinería</option>
                  <option value="limpieza">🧹 Limpieza</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              
              <div>
                <label>⚡ Sistema crítico afectado:</label>
                <select id="equipo_critico">
                  <option value="">-- Ninguno (actividad general) --</option>
                  <optgroup label="💧 Agua">
                    <option value="Cisterna de Agua">Cisterna de Agua</option>
                    <option value="Tanque Elevado">Tanque Elevado</option>
                  </optgroup>
                  <optgroup label="⚡ Electricidad">
                    <option value="Sistema Eléctrico Principal">Sistema Eléctrico Principal</option>
                    <option value="Tablero General">Tablero General</option>
                    <option value="Planta de Emergencia">Planta de Emergencia</option>
                  </optgroup>
                  <optgroup label="🚪 Transporte">
                    <option value="Elevador Mitsubishi">Elevador Mitsubishi</option>
                    <option value="Rampa Hidráulica">Rampa Hidráulica</option>
                  </optgroup>
                  <optgroup label="🛡️ Seguridad">
                    <option value="Bomba Contra Incendio">Bomba Contra Incendio</option>
                    <option value="Sistema Contra Incendio">Sistema Contra Incendio</option>
                  </optgroup>
                  <optgroup label="💰 Ingresos">
                    <option value="Software de Tickets Estacionamiento">Software Tickets Estacionamiento</option>
                    <option value="Barrera Estacionamiento">Barrera Estacionamiento</option>
                  </optgroup>
                  <optgroup label="☀️ Energía">
                    <option value="Paneles Solares">Paneles Solares</option>
                  </optgroup>
                </select>
              </div>
            </div>
            
            <!-- SELECTOR DE ESTADO (solo si se selecciona sistema crítico) -->
            <div id="selectorEstado" style="display: none; margin-bottom: 20px;">
              <label>🚦 Cambiar estado del sistema:</label>
              <div class="estado-selector">
                <div class="estado-btn verde" data-estado="verde" onclick="seleccionarEstado('verde')">
                  🟢 OPERATIVO
                </div>
                <div class="estado-btn amarillo" data-estado="amarillo" onclick="seleccionarEstado('amarillo')">
                  🟡 ATENCIÓN
                </div>
                <div class="estado-btn rojo" data-estado="rojo" onclick="seleccionarEstado('rojo')">
                  🔴 CRÍTICO
                </div>
              </div>
              <input type="hidden" id="nuevo_estado" value="">
              <p style="font-size: 0.85em; color: #666; margin-top: 8px;">
                <strong>Guía:</strong> Verde=Normal • Amarillo=Falla menor • Rojo=Falla grave/Paro
              </p>
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
              <label>📝 Observaciones/Diagnóstico:</label>
              <textarea id="observaciones" rows="3" placeholder="Detalles de la falla, hallazgos, recomendaciones..."></textarea>
            </div>
            
            <button type="submit" class="btn">✅ Guardar Actividad</button>
          </form>
        </div>
        
        <!-- ACTIVIDADES DE HOY -->
        <div class="form-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="color: #2c3e50;">📋 Actividades de hoy</h2>
            <div>
              <button onclick="cargarActividades()" class="btn">🔄 Actualizar</button>
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
        let estadoSeleccionado = '';
        
        // Cargar actividades al iniciar
        cargarActividades();
        
        // Mostrar/ocultar selector de estado según sistema seleccionado
        document.getElementById('equipo_critico').addEventListener('change', function() {
          const selector = document.getElementById('selectorEstado');
          if (this.value) {
            selector.style.display = 'block';
          } else {
            selector.style.display = 'none';
            estadoSeleccionado = '';
            document.getElementById('nuevo_estado').value = '';
          }
        });
        
        // Seleccionar estado
        function seleccionarEstado(estado) {
          estadoSeleccionado = estado;
          document.getElementById('nuevo_estado').value = estado;
          
          // Remover selección anterior
          document.querySelectorAll('.estado-btn').forEach(btn => {
            btn.classList.remove('selected');
          });
          
          // Marcar como seleccionado
          document.querySelector(\`.estado-btn[data-estado="\${estado}"]\`).classList.add('selected');
        }
        
        // Formulario para agregar actividad
        document.getElementById('formActividad').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const actividad = {
            ubicacion: document.getElementById('ubicacion').value,
            hora: document.getElementById('hora').value,
            actividad: document.getElementById('actividad').value,
            tipo_actividad: document.getElementById('tipo_actividad').value,
            equipo_critico: document.getElementById('equipo_critico').value,
            nuevo_estado: document.getElementById('nuevo_estado').value,
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
              alert('✅ ' + data.message);
              document.getElementById('formActividad').reset();
              document.getElementById('selectorEstado').style.display = 'none';
              document.getElementById('hora').value = new Date().toLocaleTimeString('es-MX', { hour12: false, hour: '2-digit', minute: '2-digit' });
              estadoSeleccionado = '';
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
            
            lista.innerHTML = actividades.map(a => {
              let estadoClass = '';
              let estadoBadge = '';
              
              if (a.nuevo_estado === 'verde') {
                estadoClass = 'estado-verde';
                estadoBadge = '<span class="badge badge-verde">🟢 OPERATIVO</span>';
              } else if (a.nuevo_estado === 'amarillo') {
                estadoClass = 'estado-amarillo';
                estadoBadge = '<span class="badge badge-amarillo">🟡 ATENCIÓN</span>';
              } else if (a.nuevo_estado === 'rojo') {
                estadoClass = 'estado-rojo';
                estadoBadge = '<span class="badge badge-rojo">🔴 CRÍTICO</span>';
              }
              
              return \`
                <div class="actividad-item \${estadoClass}">
                  <div>
                    <span style="background: #e9ecef; padding: 3px 8px; border-radius: 12px; font-size: 0.9em; color: #7f8c8d;">
                      \${a.hora}
                    </span>
                    <strong>\${a.actividad}</strong>
                    \${a.equipo_critico ? '<span style="background: #fff3cd; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 10px;">' + a.equipo_critico + '</span>' : ''}
                    \${estadoBadge}
                  </div>
                  <div style="margin-top: 8px; color: #5a6268;">
                    📍 \${a.ubicacion} • \${a.tipo_actividad}
                  </div>
                  \${a.observaciones ? '<div style="margin-top: 8px; font-style: italic; color: #6c757d;">' + a.observaciones + '</div>' : ''}
                </div>
              \`;
            }).join('');
          } catch (error) {
            console.error('Error cargando actividades:', error);
            document.getElementById('listaActividades').innerHTML = 
              '<p style="color: #e74c3c; text-align: center;">Error cargando actividades</p>';
          }
        }
        
        // Auto-refresh cada 2 minutos
        setInterval(cargarActividades, 120000);
      </script>
    </body>
    </html>
  `);
});

// DASHBOARD GERENCIA (SOLO LECTURA)
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
        .container { max-width: 1300px; margin: 0 auto; padding: 20px; }
        
        .header { 
          background: linear-gradient(135deg, #1a237e 0%, #283593 100%);
          color: white; 
          padding: 30px; 
          border-radius: 10px; 
          margin-bottom: 30px;
          box-shadow: 0 4px 15px rgba(0,0,0,0.1);
        }
        
        .stats-overview {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
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
        
        .categorias-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .categoria-card {
          background: white;
          padding: 25px;
          border-radius: 10px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
        }
        
        .sistemas-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .sistema-card {
          background: white;
          padding: 20px;
          border-radius: 10px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
          border-top: 5px solid;
        }
        
        .sistema-card.verde { border-color: #27ae60; }
        .sistema-card.amarillo { border-color: #f39c12; }
        .sistema-card.rojo { border-color: #e74c3c; }
        
        .estado-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 0.85em;
          font-weight: 600;
          margin-top: 10px;
        }
        
        .badge-verde { background: #d5f4e6; color: #27ae60; }
        .badge-amarillo { background: #fff3cd; color: #856404; }
        .badge-rojo { background: #f8d7da; color: #721c24; }
        
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
          text-decoration: none;
        }
        
        .btn:hover { background: #1c6ea4; }
        .btn-descargar { background: #27ae60; }
        .btn-descargar:hover { background: #219653; }
        
        .cambios-recientes {
          background: white;
          padding: 25px;
          border-radius: 10px;
          margin-top: 30px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🏢 Dashboard Gerencia - Torre K</h1>
          <p>Estado de sistemas críticos en tiempo real • ${new Date().toLocaleDateString('es-MX', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
          <div style="margin-top: 20px;">
            <button onclick="cargarDashboard()" class="btn">🔄 Actualizar</button>
            <button onclick="descargarReporte()" class="btn btn-descargar">📥 Descargar Reporte</button>
            <a href="/tecnico" target="_blank" class="btn">👷 Ver Bitácora Técnica</a>
          </div>
        </div>
        
        <!-- ESTADÍSTICAS GENERALES -->
        <h2 style="color: #2c3e50; margin-bottom: 15px;">📊 Resumen General</h2>
        <div class="stats-overview">
          <div class="stat-card">
            <div>🟢 Operativos</div>
            <div class="stat-value" id="totalVerdes">0</div>
            <div>sistemas</div>
          </div>
          
          <div class="stat-card">
            <div>🟡 En Atención</div>
            <div class="stat-value" id="totalAmarillos">0</div>
            <div>sistemas</div>
          </div>
          
          <div class="stat-card">
            <div>🔴 Críticos</div>
            <div class="stat-value" id="totalRojos">0</div>
            <div>sistemas</div>
          </div>
          
          <div class="stat-card">
            <div>📋 Total Sistemas</div>
            <div class="stat-value" id="totalSistemas">0</div>
            <div>monitoreados</div>
          </div>
        </div>
        
        <!-- SISTEMAS POR CATEGORÍA -->
        <h2 style="color: #2c3e50; margin: 30px 0 15px 0;">📂 Sistemas por Categoría</h2>
        <div class="categorias-grid" id="categoriasGrid"></div>
        
        <!-- TODOS LOS SISTEMAS CRÍTICOS -->
        <h2 style="color: #2c3e50; margin: 30px 0 15px 0;">🚦 Semáforo de Todos los Sistemas</h2>
        <div class="sistemas-grid" id="sistemasGrid">
          <p>Cargando sistemas...</p>
        </div>
        
        <!-- CAMBIOS RECIENTES -->
        <div class="cambios-recientes">
          <h2 style="color: #2c3e50; margin-bottom: 20px;">📝 Cambios Recientes de Estado</h2>
          <div id="cambiosRecientes">
            <p>Cargando cambios...</p>
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
            
            // Actualizar estadísticas generales
            document.getElementById('totalVerdes').textContent = data.semaforo_total.verdes;
            document.getElementById('totalAmarillos').textContent = data.semaforo_total.amarillos;
            document.getElementById('totalRojos').textContent = data.semaforo_total.rojos;
            document.getElementById('totalSistemas').textContent = data.semaforo_total.total;
            
            // Mostrar categorías
            const categoriasGrid = document.getElementById('categoriasGrid');
            categoriasGrid.innerHTML = data.resumen_categorias.map(cat => \`
              <div class="categoria-card">
                <h3>\${cat.categoria.toUpperCase()}</h3>
                <div style="margin: 15px 0;">
                  <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                    <span>🟢 Operativos:</span>
                    <strong>\${cat.verdes || 0}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                    <span>🟡 Atención:</span>
                    <strong>\${cat.amarillos || 0}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin: 5px 0;">
                    <span>🔴 Críticos:</span>
                    <strong>\${cat.rojos || 0}</strong>
                  </div>
                  <div style="display: flex; justify-content: space-between; margin: 5px 0; border-top: 1px solid #eee; padding-top: 8px;">
                    <span>📊 Total:</span>
                    <strong>\${cat.total || 0}</strong>
                  </div>
                </div>
              </div>
            \`).join('');
            
            // Mostrar todos los sistemas
            const sistemasGrid = document.getElementById('sistemasGrid');
            sistemasGrid.innerHTML = data.sistemas_criticos.map(s => \`
              <div class="sistema-card \${s.estado}">
                <div style="font-size: 0.9em; color: #666; margin-bottom: 5px;">
                  \${s.categoria}
                </div>
                <h3 style="margin: 0 0 10px 0;">\${s.nombre}</h3>
                <p style="color: #666; margin: 5px 0; font-size: 0.9em;">
                  📍 \${s.ubicacion}
                </p>
                <div class="estado-badge badge-\${s.estado}">
                  \${s.estado_texto}
                </div>
                <p style="font-size: 0.85em; color: #999; margin-top: 10px;">
                  Última actividad:<br>
                  \${s.ultima_actividad || 'Sin registro'}
                </p>
              </div>
            \`).join('');
            
            // Mostrar cambios recientes
            const cambiosDiv = document.getElementById('cambiosRecientes');
            if (data.cambios_recientes.length === 0) {
              cambiosDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No hay cambios recientes</p>';
            } else {
              cambiosDiv.innerHTML = data.cambios_recientes.map(c => {
                let estadoBadge = '';
                if (c.nuevo_estado === 'verde') {
                  estadoBadge = '<span class="badge-verde" style="margin-left: 10px;">🟢 OPERATIVO</span>';
                } else if (c.nuevo_estado === 'amarillo') {
                  estadoBadge = '<span class="badge-amarillo" style="margin-left: 10px;">🟡 ATENCIÓN</span>';
                } else if (c.nuevo_estado === 'rojo') {
                  estadoBadge = '<span class="badge-rojo" style="margin-left: 10px;">🔴 CRÍTICO</span>';
                }
                
                return \`
                  <div style="padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
                    <div style="flex: 1;">
                      <div>
                        <strong>\${c.actividad}</strong>
                        \${c.equipo_critico ? '<span style="background: #e9ecef; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 10px;">' + c.equipo_critico + '</span>' : ''}
                        \${estadoBadge}
                      </div>
                      <div style="color: #666; font-size: 0.9em; margin-top: 5px;">
                        📍 \${c.ubicacion} • \${c.hora} • \${c.fecha}
                      </div>
                      \${c.observaciones ? '<div style="color: #666; font-size: 0.9em; margin-top: 5px; font-style: italic;">' + c.observaciones + '</div>' : ''}
                    </div>
                    <div style="color: #999; font-size: 0.9em; min-width: 100px; text-align: right;">
                      \${c.tecnico}
                    </div>
                  </div>
                \`;
              }).join('');
            }
            
          } catch (error) {
            console.error('Error cargando dashboard:', error);
            alert('Error cargando datos del dashboard');
          }
        }
        
        function descargarReporte() {
          window.open(API_URL + '/api/descargar/reporte', '_blank');
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
          text-decoration: none;
          color: inherit;
          display: block;
        }
        
        .card:hover {
          transform: translateY(-5px);
          box-shadow: 0 10px 30px rgba(0,0,0,0.1);
          border-color: #3498db;
        }
        
        .card.tecnico { border-left: 5px solid #27ae60; }
        .card.gerencia { border-left: 5px solid #2980b9; }
        
        .sistemas-criticos {
          margin: 30px 0;
          padding: 20px;
          background: #fff3cd;
          border-radius: 10px;
          border-left: 4px solid #f39c12;
          text-align: left;
        }
        
        .sistemas-criticos h3 {
          margin-top: 0;
          color: #856404;
        }
        
        .sistemas-list {
          font-size: 0.9em;
          columns: 2;
        }
        
        .sistemas-list li {
          margin-bottom: 5px;
        }
        
        .rule {
          margin: 20px 0;
          padding: 15px;
          background: #d5f4e6;
          border-radius: 10px;
          border-left: 4px solid #27ae60;
          font-style: italic;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏢 Torre K Maintenance</h1>
        <div class="subtitle">
          Sistema de mantenimiento integral • ${new Date().toLocaleDateString('es-MX')}
        </div>
        
        <div class="rule">
          <strong>📋 Regla fundamental:</strong><br>
          "Sin registro, no se hizo"
        </div>
        
        <a href="/tecnico" class="card tecnico">
          <h2>👷 Área Técnica</h2>
          <p>Registro de actividades y cambios de estado</p>
          <p style="font-size: 0.9em; color: #666;">
            • Reportar fallas y actividades<br>
            • Cambiar estado de sistemas (verde/amarillo/rojo)<br>
            • Registrar consumo de agua/energía
          </p>
        </a>
        
        <a href="/gerencia" class="card gerencia">
          <h2>👔 Dashboard Gerencia</h2>
          <p>Monitoreo de todos los sistemas críticos</p>
          <p style="font-size: 0.9em; color: #666;">
            • Ver semáforo de estado completo<br>
            • Revisar cambios recientes<br>
            • Descargar reportes en Excel
          </p>
        </a>
        
        <div class="sistemas-criticos">
          <h3>⚠️ Sistemas Críticos Monitoreados:</h3>
          <ul class="sistemas-list">
            <li>💧 Cisterna de Agua</li>
            <li>⚡ Sistema Eléctrico</li>
            <li>🚪 Elevador Mitsubishi</li>
            <li>🛡️ Bomba Contra Incendio</li>
            <li>💰 Software de Tickets</li>
            <li>🔋 Planta de Emergencia</li>
            <li>☀️ Paneles Solares</li>
            <li>🔄 Rampa Hidráulica</li>
          </ul>
        </div>
        
        <div style="margin-top: 20px; color: #7f8c8d; font-size: 0.85em;">
          <p>Sistema integral para mantenimiento de Torre K</p>
          <p><strong>Recordatorio:</strong> El técnico cambia estados, gerencia solo monitorea.</p>
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
  console.log(`👷 Técnico (cambia estados): http://localhost:${PORT}/tecnico`);
  console.log(`👔 Gerencia (solo lectura): http://localhost:${PORT}/gerencia`);
  console.log(`=========================================\n`);
});
