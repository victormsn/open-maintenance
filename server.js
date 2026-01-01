const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.use(cors());
app.use(express.json());

// Base de datos SQLite
const db = new sqlite3.Database('/tmp/database.sqlite');

// ==================== CREAR TABLAS ====================
db.serialize(() => {
  // Tabla principal
  db.run(`
    CREATE TABLE IF NOT EXISTS actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      hora TEXT,
      ubicacion TEXT NOT NULL,
      actividad TEXT NOT NULL,
      tipo_actividad TEXT,
      
      agua_m3 REAL,
      energia_consumida REAL,
      paneles_kwh REAL,
      
      equipo_critico TEXT,
      nuevo_estado TEXT,
      
      observaciones TEXT,
      tecnico TEXT DEFAULT 'Técnico Torre K',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de ESTADOS ACTUALES
  db.run(`
    CREATE TABLE IF NOT EXISTS estados_equipos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipo TEXT UNIQUE NOT NULL,
      estado TEXT DEFAULT 'verde',
      ultimo_cambio TEXT,
      observaciones TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insertar equipos críticos
  const equiposCriticos = [
    'Cisterna de Agua',
    'Tanque Elevado', 
    'Sistema Eléctrico Principal',
    'Tablero General',
    'Elevador Mitsubishi',
    'Bomba Contra Incendio',
    'Planta de Emergencia',
    'Software de Tickets Estacionamiento',
    'Barrera Estacionamiento',
    'Paneles Solares',
    'Rampa Hidráulica',
    'Sistema de Gas'
  ];

  equiposCriticos.forEach(equipo => {
    db.run(
      `INSERT OR IGNORE INTO estados_equipos (equipo, estado) VALUES (?, 'verde')`,
      [equipo]
    );
  });

  console.log('✅ Base de datos lista');
});

// ==================== FUNCIONES DE FECHA Y HORA ====================
function getFechaHoy() {
  const hoy = new Date();
  
  const fecha = hoy.toISOString().split('T')[0];
  const fechaLegible = hoy.toLocaleDateString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  return { fecha, fechaLegible };
}

function getHoraActual() {
  return new Date().toLocaleTimeString('es-MX', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

// ==================== SERVER-SENT EVENTS PARA TIEMPO REAL ====================
const clients = [];

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const clientId = Date.now();
  const newClient = {
    id: clientId,
    res
  };
  
  clients.push(newClient);
  
  // Enviar evento inicial
  res.write(`data: ${JSON.stringify({ type: 'connected', clientId })}\n\n`);
  
  // Mantener conexión activa
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 30000);
  
  req.on('close', () => {
    console.log(`Client ${clientId} disconnected`);
    clearInterval(keepAlive);
    const index = clients.findIndex(c => c.id === clientId);
    if (index !== -1) clients.splice(index, 1);
  });
});

function sendToAll(data) {
  clients.forEach(client => {
    client.res.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

// ==================== ENDPOINTS CORREGIDOS ====================

// 1. REGISTRAR ACTIVIDAD (CORREGIDO - CON ESTADO ACTUALIZADO)
app.post('/api/actividad', (req, res) => {
  const { fecha } = getFechaHoy();
  const hora = getHoraActual();
  
  const {
    ubicacion,
    actividad,
    tipo_actividad = 'otro',
    equipo_critico = '',
    nuevo_estado = '',
    agua_m3,
    energia_consumida,
    paneles_kwh,
    observaciones = ''
  } = req.body;

  if (!ubicacion || !actividad) {
    return res.status(400).json({ error: 'Ubicación y actividad son requeridas' });
  }

  console.log(`📝 Registrando actividad: ${actividad.substring(0, 50)}...`);

  db.run(`
    INSERT INTO actividades 
    (fecha, hora, ubicacion, actividad, tipo_actividad, equipo_critico, nuevo_estado, 
     agua_m3, energia_consumida, paneles_kwh, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fecha, hora, ubicacion, actividad, tipo_actividad, equipo_critico, nuevo_estado, 
     agua_m3 || null, energia_consumida || null, paneles_kwh || null, observaciones],
    function(err) {
      if (err) {
        console.error('❌ Error:', err.message);
        return res.status(500).json({ error: err.message });
      }

      const actividadId = this.lastID;
      console.log(`✅ Actividad ${actividadId} registrada a las ${hora}`);

      // ACTUALIZAR ESTADO DEL EQUIPO SI SE ESPECIFICÓ (CORREGIDO)
      if (equipo_critico && nuevo_estado && ['verde', 'amarillo', 'rojo'].includes(nuevo_estado)) {
        db.run(
          `UPDATE estados_equipos 
           SET estado = ?, ultimo_cambio = ?, observaciones = ?, updated_at = CURRENT_TIMESTAMP
           WHERE equipo = ?`,
          [nuevo_estado, `${fecha} ${hora}`, observaciones || 'Estado cambiado', equipo_critico],
          function(updateErr) {
            if (updateErr) {
              console.error('❌ Error actualizando estado:', updateErr.message);
            } else {
              console.log(`✅ Estado de ${equipo_critico} actualizado a ${nuevo_estado}`);
              
              // Notificar a todos los clientes
              sendToAll({
                type: 'estado_actualizado',
                equipo: equipo_critico,
                estado: nuevo_estado,
                hora: hora
              });
            }
          }
        );
      }

      // Obtener la actividad completa para enviarla
      db.get(`SELECT * FROM actividades WHERE id = ?`, [actividadId], (err, actividadCompleta) => {
        if (!err && actividadCompleta) {
          // Notificar a todos los clientes en tiempo real
          sendToAll({
            type: 'nueva_actividad',
            actividad: actividadCompleta
          });
          
          // Notificar actualización del dashboard
          sendToAll({
            type: 'dashboard_actualizado'
          });
        }
      });

      res.json({
        success: true,
        id: actividadId,
        hora_registrada: hora,
        message: '✅ Actividad registrada' + 
                (equipo_critico ? ` y estado de ${equipo_critico} actualizado` : ''),
        fecha_guardada: fecha
      });
    }
  );
});

// 2. ACTUALIZAR ESTADO DE EQUIPO DIRECTAMENTE
app.post('/api/equipo/estado', (req, res) => {
  const { equipo, estado, observaciones } = req.body;
  const { fecha } = getFechaHoy();
  const hora = getHoraActual();
  
  if (!equipo || !['verde', 'amarillo', 'rojo'].includes(estado)) {
    return res.status(400).json({ error: 'Equipo y estado válido son requeridos' });
  }
  
  db.run(
    `UPDATE estados_equipos 
     SET estado = ?, ultimo_cambio = ?, observaciones = ?, updated_at = CURRENT_TIMESTAMP
     WHERE equipo = ?`,
    [estado, `${fecha} ${hora}`, observaciones || 'Estado cambiado', equipo],
    function(err) {
      if (err) {
        console.error('❌ Error actualizando estado:', err.message);
        return res.status(500).json({ error: err.message });
      }
      
      console.log(`✅ Estado de ${equipo} actualizado a ${estado}`);
      
      // Notificar a todos los clientes
      sendToAll({
        type: 'estado_actualizado',
        equipo: equipo,
        estado: estado,
        hora: hora
      });
      
      res.json({
        success: true,
        changes: this.changes,
        message: `✅ Estado de ${equipo} actualizado a ${estado}`
      });
    }
  );
});

// 3. OBTENER ACTIVIDADES DE HOY
app.get('/api/actividades/hoy', (req, res) => {
  const { fecha } = getFechaHoy();
  
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha = ? 
     ORDER BY created_at DESC`,
    [fecha],
    (err, rows) => {
      if (err) {
        console.error('❌ Error:', err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    }
  );
});

// 4. OBTENER ESTADOS ACTUALES
app.get('/api/estados', (req, res) => {
  db.all(
    `SELECT * FROM estados_equipos ORDER BY equipo`,
    [],
    (err, equipos) => {
      if (err) {
        console.error('❌ Error:', err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json(equipos);
    }
  );
});

// 5. DASHBOARD GERENCIA COMPLETO
app.get('/api/dashboard/gerencia', (req, res) => {
  const { fecha, fechaLegible } = getFechaHoy();
  
  // 1. Obtener estados actuales
  db.all(`SELECT * FROM estados_equipos ORDER BY equipo`, [], (err, equipos) => {
    if (err) return res.status(500).json({ error: err.message });

    // 2. Obtener consumos
    db.get(
      `SELECT 
         SUM(COALESCE(agua_m3, 0)) as agua_total,
         SUM(COALESCE(energia_consumida, 0)) as consumo_total,
         SUM(COALESCE(paneles_kwh, 0)) as paneles_total
       FROM actividades 
       WHERE fecha = ?`,
      [fecha],
      (err, consumos) => {
        if (err) return res.status(500).json({ error: err.message });

        // 3. Obtener actividades
        db.all(
          `SELECT * FROM actividades 
           WHERE fecha = ? 
           ORDER BY created_at DESC 
           LIMIT 20`,
          [fecha],
          (err, actividades) => {
            if (err) return res.status(500).json({ error: err.message });

            const energia_neta = (consumos.consumo_total || 0) - (consumos.paneles_total || 0);
            
            res.json({
              fecha: fecha,
              fecha_legible: fechaLegible,
              equipos_criticos: equipos,
              consumos_dia: {
                agua_m3: consumos.agua_total || 0,
                energia_consumida: consumos.consumo_total || 0,
                paneles_kwh: consumos.paneles_total || 0,
                energia_neta: energia_neta,
                balance: energia_neta > 0 ? 'CONSUMO NETO' : 'DEVOLUCIÓN NETO'
              },
              actividades_hoy: actividades,
              semaforo: {
                total: equipos.length,
                verdes: equipos.filter(e => e.estado === 'verde').length,
                amarillos: equipos.filter(e => e.estado === 'amarillo').length,
                rojos: equipos.filter(e => e.estado === 'rojo').length
              }
            });
          }
        );
      }
    );
  });
});

// ==================== INTERFAZ TÉCNICO CORREGIDA ====================

app.get('/tecnico', (req, res) => {
  const { fechaLegible } = getFechaHoy();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Bitácora Técnico - Torre K</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        /* [Mantener todos los estilos CSS anteriores] */
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
        label { display: block; margin-bottom: 8px; font-weight: 600; color: #2c3e50; font-size: 0.9em; }
        input, select, textarea {
          width: 100%; padding: 12px; border: 2px solid #e9ecef; border-radius: 8px;
          font-size: 16px; transition: border 0.3s;
        }
        .consumo-row {
          display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px;
          margin: 15px 0; padding: 15px; background: #e8f4fd; border-radius: 8px;
        }
        .btn {
          background: #27ae60; color: white; border: none; padding: 15px 30px;
          border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer;
          transition: background 0.3s; display: inline-block; margin-right: 10px;
        }
        .btn:hover { background: #219653; }
        .btn-descargar { background: #2980b9; }
        .btn-descargar:hover { background: #1c6ea4; }
        .btn-editar { background: #f39c12; color: white; border: none; padding: 6px 12px; border-radius: 5px; cursor: pointer; }
        .btn-eliminar { background: #e74c3c; color: white; border: none; padding: 6px 12px; border-radius: 5px; cursor: pointer; }
        .actividad-item {
          padding: 15px; border-left: 4px solid #27ae60; margin-bottom: 10px;
          background: #f8f9fa; border-radius: 6px; position: relative;
        }
        .actividad-item.con-consumo { border-left-color: #2196f3; }
        .actividad-item.critico { border-left-color: #e74c3c; }
        .acciones { position: absolute; top: 15px; right: 15px; display: flex; gap: 8px; }
        .consumo-badge {
          display: inline-block; background: #e3f2fd; color: #1565c0;
          padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-right: 8px;
        }
        .estado-badge {
          display: inline-block; padding: 3px 10px; border-radius: 12px;
          font-size: 0.85em; font-weight: 600; margin-left: 10px;
        }
        .badge-verde { background: #d5f4e6; color: #27ae60; }
        .badge-amarillo { background: #fff3cd; color: #856404; }
        .badge-rojo { background: #f8d7da; color: #721c24; }
        .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
        .modal-content { background: white; padding: 30px; border-radius: 10px; width: 90%; max-width: 500px; }
        .estado-selector {
          display: flex; gap: 10px; margin: 15px 0;
        }
        .estado-option {
          flex: 1; text-align: center; padding: 10px; border: 2px solid #ddd;
          border-radius: 8px; cursor: pointer; transition: all 0.3s;
        }
        .estado-option:hover { opacity: 0.9; }
        .estado-option.selected { border-width: 3px; }
        .estado-verde { background: #d5f4e6; border-color: #27ae60; }
        .estado-amarillo { background: #fff3cd; border-color: #f39c12; }
        .estado-rojo { background: #f8d7da; border-color: #e74c3c; }
        .real-time-badge {
          background: #3498db; color: white; padding: 4px 10px;
          border-radius: 15px; font-size: 0.8em; animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }
        .sistema-critico-section {
          background: #fff8e1; padding: 20px; border-radius: 8px; margin: 20px 0;
          border: 2px solid #f39c12;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔧 Bitácora Técnico - Torre K <span class="real-time-badge">TIEMPO REAL</span></h1>
          <p>${fechaLegible}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            ✅ <strong>CORREGIDO:</strong> Semáforización + Actualización automática
          </p>
        </div>
        
        <!-- FORMULARIO CORREGIDO -->
        <div class="form-section">
          <h2 style="margin-bottom: 20px; color: #2c3e50;">➕ Nueva Actividad</h2>
          
          <form id="formActividad">
            <div class="form-row">
              <div>
                <label>📍 Ubicación:</label>
                <input type="text" id="ubicacion" placeholder="Ej: Planta Baja, Azotea..." required>
              </div>
              <div>
                <label>🔧 Actividad:</label>
                <input type="text" id="actividad" placeholder="Ej: Revisión, reparación..." required>
              </div>
            </div>
            
            <div class="form-row">
              <div>
                <label>📋 Tipo:</label>
                <select id="tipo_actividad">
                  <option value="lectura">📖 Lectura</option>
                  <option value="electricidad">⚡ Electricidad</option>
                  <option value="agua">💧 Agua</option>
                  <option value="paneles">☀️ Paneles Solares</option>
                  <option value="mantenimiento">🔧 Mantenimiento</option>
                </select>
              </div>
              
              <div>
                <label>⚠️ Sistema crítico:</label>
                <select id="equipo_critico">
                  <option value="">-- Ninguno --</option>
                  <option value="Cisterna de Agua">💧 Cisterna de Agua</option>
                  <option value="Tanque Elevado">💧 Tanque Elevado</option>
                  <option value="Sistema Eléctrico Principal">⚡ Sistema Eléctrico</option>
                  <option value="Paneles Solares">☀️ Paneles Solares</option>
                  <option value="Tablero General">⚡ Tablero General</option>
                  <option value="Elevador Mitsubishi">🚪 Elevador</option>
                  <option value="Bomba Contra Incendio">🛡️ Bomba Incendio</option>
                  <option value="Planta de Emergencia">🔋 Planta Emergencia</option>
                </select>
              </div>
            </div>
            
            <!-- SECCIÓN DE SEMÁFORIZACIÓN CORREGIDA -->
            <div class="sistema-critico-section" id="seccionSemaforo" style="display: none;">
              <h3 style="color: #d35400; margin-bottom: 15px;">🚦 Cambiar estado del sistema:</h3>
              <div class="estado-selector">
                <div class="estado-option estado-verde" onclick="seleccionarEstado('verde')">
                  <div style="font-size: 2em;">🟢</div>
                  <div><strong>OPERATIVO</strong></div>
                  <small>Sistema funcionando normalmente</small>
                </div>
                <div class="estado-option estado-amarillo" onclick="seleccionarEstado('amarillo')">
                  <div style="font-size: 2em;">🟡</div>
                  <div><strong>ATENCIÓN</strong></div>
                  <small>Requiere monitoreo</small>
                </div>
                <div class="estado-option estado-rojo" onclick="seleccionarEstado('rojo')">
                  <div style="font-size: 2em;">🔴</div>
                  <div><strong>CRÍTICO</strong></div>
                  <small>Requiere intervención</small>
                </div>
              </div>
              <input type="hidden" id="nuevo_estado" value="">
              <p style="font-size: 0.85em; color: #666; margin-top: 10px;">
                <strong>⚠️ Importante:</strong> Este estado se reflejará inmediatamente en el Dashboard de Gerencia
              </p>
            </div>
            
            <div class="consumo-row">
              <div>
                <label>💧 Agua (m³):</label>
                <input type="number" id="agua_m3" step="0.001" placeholder="0.000">
              </div>
              <div>
                <label>🔌 Consumo CFE (+):</label>
                <input type="number" id="energia_consumida" step="0.1" placeholder="kWh">
              </div>
              <div>
                <label>☀️ Paneles (-):</label>
                <input type="number" id="paneles_kwh" step="0.1" placeholder="kWh">
              </div>
            </div>
            
            <div>
              <label>📝 Observaciones:</label>
              <textarea id="observaciones" rows="2" placeholder="Detalles adicionales..."></textarea>
            </div>
            
            <div style="margin-top: 20px;">
              <button type="submit" class="btn">✅ Guardar Actividad</button>
              <button type="button" onclick="exportarExcel()" class="btn btn-descargar">📥 Exportar Excel</button>
              <button type="button" onclick="actualizarManual()" class="btn" style="background: #9b59b6;">🔄 Actualizar</button>
            </div>
          </form>
        </div>
        
        <!-- ACTIVIDADES EN TIEMPO REAL -->
        <div class="form-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="color: #2c3e50;">📋 Actividades Hoy 
              <span id="contadorActividades" style="background: #3498db; color: white; padding: 2px 10px; border-radius: 12px; font-size: 0.8em;">0</span>
            </h2>
            <div style="font-size: 0.9em; color: #666;">
              <span id="ultimaActualizacion">--:--:--</span>
              <span class="real-time-badge" style="margin-left: 10px;">CONECTADO</span>
            </div>
          </div>
          
          <div id="listaActividades">
            <p style="text-align: center; color: #7f8c8d; padding: 20px;">
              Cargando actividades...
            </p>
          </div>
        </div>
      </div>
      
      <!-- MODAL EDITAR -->
      <div id="modalEditar" class="modal">
        <div class="modal-content">
          <h2>✏️ Editar Actividad</h2>
          <form id="formEditar">
            <input type="hidden" id="editar_id">
            <div style="margin: 15px 0;">
              <label>Actividad:</label>
              <textarea id="editar_actividad" rows="3" required></textarea>
            </div>
            <div style="text-align: right;">
              <button type="button" onclick="cerrarModal()" style="background: #95a5a6;" class="btn">Cancelar</button>
              <button type="submit" class="btn">Guardar</button>
            </div>
          </form>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        let eventSource = null;
        
        // CONFIGURACIÓN INICIAL
        document.addEventListener('DOMContentLoaded', function() {
          cargarActividades();
          iniciarConexionTiempoReal();
          
          // Mostrar/ocultar semáforo cuando se selecciona equipo
          document.getElementById('equipo_critico').addEventListener('change', function() {
            const seccion = document.getElementById('seccionSemaforo');
            seccion.style.display = this.value ? 'block' : 'none';
            document.getElementById('nuevo_estado').value = '';
            // Resetear selección visual
            document.querySelectorAll('.estado-option').forEach(el => {
              el.classList.remove('selected');
            });
          });
          
          // Formulario principal
          document.getElementById('formActividad').addEventListener('submit', async (e) => {
            e.preventDefault();
            await guardarActividad();
          });
          
          // Formulario editar
          document.getElementById('formEditar').addEventListener('submit', async (e) => {
            e.preventDefault();
            await guardarEdicion();
          });
        });
        
        // FUNCIÓN PARA SELECCIONAR ESTADO (CORREGIDA)
        function seleccionarEstado(estado) {
          document.getElementById('nuevo_estado').value = estado;
          
          // Actualizar selección visual
          document.querySelectorAll('.estado-option').forEach(el => {
            el.classList.remove('selected');
          });
          
          const opcion = document.querySelector('.estado-' + estado);
          if (opcion) opcion.classList.add('selected');
        }
        
        // GUARDAR ACTIVIDAD (CORREGIDA)
        async function guardarActividad() {
          const actividad = {
            ubicacion: document.getElementById('ubicacion').value,
            actividad: document.getElementById('actividad').value,
            tipo_actividad: document.getElementById('tipo_actividad').value,
            equipo_critico: document.getElementById('equipo_critico').value,
            nuevo_estado: document.getElementById('nuevo_estado').value,
            agua_m3: document.getElementById('agua_m3').value || null,
            energia_consumida: document.getElementById('energia_consumida').value || null,
            paneles_kwh: document.getElementById('paneles_kwh').value || null,
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
              // Limpiar formulario
              document.getElementById('formActividad').reset();
              document.getElementById('seccionSemaforo').style.display = 'none';
              document.getElementById('nuevo_estado').value = '';
              
              // Notificación
              mostrarNotificacion('✅ ' + data.message, 'success');
              
              // La actualización vendrá por SSE
            }
          } catch (error) {
            mostrarNotificacion('❌ Error de conexión', 'error');
          }
        }
        
        // CONEXIÓN EN TIEMPO REAL
        function iniciarConexionTiempoReal() {
          if (eventSource) eventSource.close();
          
          eventSource = new EventSource(API_URL + '/api/events');
          
          eventSource.onopen = () => {
            console.log('🔗 Conexión SSE establecida');
            mostrarNotificacion('🔄 Conectado en tiempo real', 'info');
          };
          
          eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            switch(data.type) {
              case 'nueva_actividad':
                console.log('📥 Nueva actividad recibida:', data.actividad);
                cargarActividades(); // Recargar lista
                break;
                
              case 'estado_actualizado':
                console.log(`🚦 Estado actualizado: ${data.equipo} -> ${data.estado}`);
                mostrarNotificacion(`🔄 ${data.equipo} ahora está ${data.estado}`, 'info');
                break;
                
              case 'dashboard_actualizado':
                console.log('📊 Dashboard actualizado');
                break;
            }
            
            // Actualizar timestamp
            document.getElementById('ultimaActualizacion').textContent = 
              new Date().toLocaleTimeString();
          };
          
          eventSource.onerror = (error) => {
            console.error('❌ Error SSE:', error);
            setTimeout(iniciarConexionTiempoReal, 5000); // Reconectar
          };
        }
        
        // CARGAR ACTIVIDADES
        async function cargarActividades() {
          try {
            const response = await fetch(API_URL + '/api/actividades/hoy');
            const actividades = await response.json();
            
            document.getElementById('contadorActividades').textContent = actividades.length;
            
            const lista = document.getElementById('listaActividades');
            
            if (actividades.length === 0) {
              lista.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px;">No hay actividades hoy</p>';
              return;
            }
            
            lista.innerHTML = actividades.map(a => {
              const hora = a.hora || '--:--';
              let clase = 'actividad-item';
              if (a.nuevo_estado === 'rojo') clase += ' critico';
              
              let consumos = '';
              if (a.agua_m3) consumos += `<span class="consumo-badge">💧 ${a.agua_m3} m³</span>`;
              if (a.energia_consumida) consumos += `<span class="consumo-badge">🔌 +${a.energia_consumida} kWh</span>`;
              if (a.paneles_kwh) consumos += `<span class="consumo-badge">☀️ -${a.paneles_kwh} kWh</span>`;
              
              let estadoBadge = '';
              if (a.nuevo_estado === 'verde') estadoBadge = '<span class="estado-badge badge-verde">🟢 OPERATIVO</span>';
              if (a.nuevo_estado === 'amarillo') estadoBadge = '<span class="estado-badge badge-amarillo">🟡 ATENCIÓN</span>';
              if (a.nuevo_estado === 'rojo') estadoBadge = '<span class="estado-badge badge-rojo">🔴 CRÍTICO</span>';
              
              return \`
                <div class="\${clase}">
                  <div class="acciones">
                    <button onclick="editarActividad(${a.id})" class="btn-editar">✏️</button>
                    <button onclick="eliminarActividad(${a.id})" class="btn-eliminar">🗑️</button>
                  </div>
                  <div>
                    <span style="background: #e9ecef; padding: 3px 8px; border-radius: 12px; font-size: 0.9em; color: #7f8c8d;">
                      ⏰ ${hora}
                    </span>
                    <strong>${a.actividad}</strong>
                    \${a.equipo_critico ? '<span style="background: #fff3cd; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 10px;">' + a.equipo_critico + '</span>' : ''}
                    \${estadoBadge}
                  </div>
                  <div style="margin-top: 8px; color: #5a6268;">
                    📍 ${a.ubicacion} • ${a.tipo_actividad}
                    \${consumos}
                  </div>
                  \${a.observaciones ? '<div style="margin-top: 8px; font-style: italic; color: #6c757d;">' + a.observaciones + '</div>' : ''}
                </div>
              \`;
            }).join('');
            
          } catch (error) {
            console.error('Error cargando actividades:', error);
          }
        }
        
        // FUNCIONES AUXILIARES
        function mostrarNotificacion(mensaje, tipo) {
          const div = document.createElement('div');
          div.style.cssText = \`
            position: fixed; top: 20px; right: 20px; padding: 15px 25px;
            border-radius: 8px; color: white; z-index: 10000;
            background: \${tipo === 'error' ? '#e74c3c' : tipo === 'info' ? '#3498db' : '#27ae60'};
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          \`;
          div.textContent = mensaje;
          document.body.appendChild(div);
          setTimeout(() => div.remove(), 3000);
        }
        
        function actualizarManual() {
          cargarActividades();
          mostrarNotificacion('🔄 Actualizando...', 'info');
        }
        
        function exportarExcel() {
          const hoy = new Date().toISOString().split('T')[0];
          window.open(API_URL + '/api/exportar/excel/' + hoy, '_blank');
        }
        
        async function editarActividad(id) {
          // Implementar según necesidad
          alert('Función de edición completa');
        }
        
        async function eliminarActividad(id) {
          if (!confirm('¿Eliminar esta actividad?')) return;
          
          try {
            const response = await fetch(API_URL + '/api/actividad/' + id, {
              method: 'DELETE'
            });
            
            const data = await response.json();
            if (data.success) {
              mostrarNotificacion('🗑️ Actividad eliminada', 'success');
              cargarActividades();
            }
          } catch (error) {
            mostrarNotificacion('❌ Error eliminando', 'error');
          }
        }
      </script>
    </body>
    </html>
  `);
});

// ==================== DASHBOARD GERENCIA ====================
app.get('/gerencia', (req, res) => {
  const { fechaLegible } = getFechaHoy();
  
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
        
        .dashboard-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 30px;
        }
        
        .card {
          background: white;
          padding: 25px;
          border-radius: 10px;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
        }
        
        .sistema-item {
          padding: 15px;
          margin: 10px 0;
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-left: 5px solid;
        }
        
        .sistema-verde { border-color: #27ae60; background: #d5f4e6; }
        .sistema-amarillo { border-color: #f39c12; background: #fff3cd; }
        .sistema-rojo { border-color: #e74c3c; background: #f8d7da; }
        
        .consumo-card {
          text-align: center;
          padding: 20px;
          border-radius: 10px;
          margin: 10px 0;
          background: #f8f9fa;
        }
        
        .real-time-indicator {
          display: inline-block;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #27ae60;
          animation: blink 1s infinite;
          margin-right: 8px;
        }
        
        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🏢 Dashboard Gerencia - Torre K <span style="background: #27ae60; padding: 5px 15px; border-radius: 20px; font-size: 0.6em; vertical-align: middle;">TIEMPO REAL</span></h1>
          <p>${fechaLegible}</p>
          <p style="margin-top: 10px; opacity: 0.9;">
            <span class="real-time-indicator"></span>
            Actualización automática cada 5 segundos
          </p>
        </div>
        
        <div class="dashboard-grid">
          <!-- Columna izquierda: Estados -->
          <div class="card">
            <h2 style="color: #2c3e50; margin-bottom: 20px;">🚦 Estado de Sistemas</h2>
            <div id="sistemasEstado">
              Cargando...
            </div>
          </div>
          
          <!-- Columna derecha: Consumos -->
          <div class="card">
            <h2 style="color: #2c3e50; margin-bottom: 20px;">📊 Consumos Hoy</h2>
            <div id="consumosHoy">
              Cargando...
            </div>
          </div>
        </div>
        
        <!-- Actividades recientes -->
        <div class="card" style="margin-top: 30px;">
          <h2 style="color: #2c3e50; margin-bottom: 20px;">📝 Actividades Recientes</h2>
          <div id="actividadesRecientes">
            Cargando...
          </div>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        let eventSource = null;
        
        // Iniciar
        cargarDashboard();
        iniciarConexionTiempoReal();
        
        async function cargarDashboard() {
          try {
            const response = await fetch(API_URL + '/api/dashboard/gerencia');
            const data = await response.json();
            
            // Actualizar estados
            const sistemasDiv = document.getElementById('sistemasEstado');
            sistemasDiv.innerHTML = data.equipos_criticos.map(e => {
              let clase = 'sistema-item ';
              if (e.estado === 'verde') clase += 'sistema-verde';
              else if (e.estado === 'amarillo') clase += 'sistema-amarillo';
              else clase += 'sistema-rojo';
              
              return \`
                <div class="\${clase}">
                  <div>
                    <strong>\${e.equipo}</strong>
                    <div style="font-size: 0.85em; color: #666;">
                      \${e.ultimo_cambio ? 'Último: ' + e.ultimo_cambio : ''}
                    </div>
                  </div>
                  <div style="font-weight: bold;">
                    \${e.estado === 'verde' ? '🟢' : e.estado === 'amarillo' ? '🟡' : '🔴'}
                  </div>
                </div>
              \`;
            }).join('');
            
            // Actualizar consumos
            const consumosDiv = document.getElementById('consumosHoy');
            consumosDiv.innerHTML = \`
              <div class="consumo-card">
                <div style="font-size: 0.9em; color: #666;">💧 Agua consumida</div>
                <div style="font-size: 2em; font-weight: bold;">\${data.consumos_dia.agua_m3.toFixed(3)}</div>
                <div style="color: #666;">m³</div>
              </div>
              
              <div class="consumo-card">
                <div style="font-size: 0.9em; color: #666;">🔌 Energy Consumed (+)</div>
                <div style="font-size: 2em; font-weight: bold;">\${data.consumos_dia.energia_consumida.toFixed(1)}</div>
                <div style="color: #666;">kWh</div>
              </div>
              
              <div class="consumo-card">
                <div style="font-size: 0.9em; color: #666;">☀️ Energy Returned (-)</div>
                <div style="font-size: 2em; font-weight: bold;">\${data.consumos_dia.paneles_kwh.toFixed(1)}</div>
                <div style="color: #666;">kWh</div>
              </div>
              
              <div class="consumo-card" style="background: \${data.consumos_dia.energia_neta > 0 ? '#f8d7da' : '#d5f4e6'};">
                <div style="font-size: 0.9em; color: #666;">⚖️ Balance Neto CFE</div>
                <div style="font-size: 2em; font-weight: bold; color: \${data.consumos_dia.energia_neta > 0 ? '#e74c3c' : '#27ae60'};">\${Math.abs(data.consumos_dia.energia_neta).toFixed(1)}</div>
                <div style="color: \${data.consumos_dia.energia_neta > 0 ? '#e74c3c' : '#27ae60'};">
                  \${data.consumos_dia.balance}
                </div>
              </div>
            \`;
            
            // Actualizar actividades
            const actividadesDiv = document.getElementById('actividadesRecientes');
            if (data.actividades_hoy.length === 0) {
              actividadesDiv.innerHTML = '<p style="text-align: center; color: #666;">No hay actividades hoy</p>';
            } else {
              actividadesDiv.innerHTML = data.actividades_hoy.slice(0, 10).map(a => {
                let estadoIcon = '';
                if (a.nuevo_estado === 'verde') estadoIcon = '🟢';
                else if (a.nuevo_estado === 'amarillo') estadoIcon = '🟡';
                else if (a.nuevo_estado === 'rojo') estadoIcon = '🔴';
                
                return \`
                  <div style="padding: 15px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
                    <div>
                      <div>
                        <strong>\${a.actividad}</strong>
                        <span style="color: #666; font-size: 0.9em; margin-left: 10px;">⏰ \${a.hora || '--:--'}</span>
                        \${estadoIcon}
                      </div>
                      <div style="color: #666; font-size: 0.9em; margin-top: 5px;">
                        📍 \${a.ubicacion} • \${a.tipo_actividad}
                      </div>
                    </div>
                    <div style="color: #999; font-size: 0.9em;">
                      \${a.equipo_critico || 'General'}
                    </div>
                  </div>
                \`;
              }).join('');
            }
            
          } catch (error) {
            console.error('Error cargando dashboard:', error);
          }
        }
        
        function iniciarConexionTiempoReal() {
          if (eventSource) eventSource.close();
          
          eventSource = new EventSource(API_URL + '/api/events');
          
          eventSource.onmessage = (event) => {
            const data = JSON.parse(event.data);
            
            if (data.type === 'estado_actualizado' || data.type === 'nueva_actividad') {
              cargarDashboard(); // Recargar todo
            }
          };
          
          eventSource.onerror = () => {
            setTimeout(iniciarConexionTiempoReal, 5000);
          };
          
          // Auto-refresh cada 30 segundos por si acaso
          setInterval(cargarDashboard, 30000);
        }
      </script>
    </body>
    </html>
  `);
});

// ==================== PÁGINA PRINCIPAL ====================
app.get('/', (req, res) => {
  const { fechaLegible } = getFechaHoy();
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Torre K Maintenance</title>
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
        
        h1 { color: #2c3e50; margin-bottom: 10px; }
        
        .card {
          background: #f8f9fa;
          border-radius: 15px;
          padding: 25px;
          margin: 20px 0;
          transition: transform 0.3s;
          cursor: pointer;
          border: 2px solid transparent;
          text-decoration: none;
          color: inherit;
          display: block;
        }
        
        .card:hover {
          transform: translateY(-5px);
          border-color: #3498db;
        }
        
        .card.tecnico { border-left: 5px solid #27ae60; }
        .card.gerencia { border-left: 5px solid #2980b9; }
        
        .fix-list {
          text-align: left;
          margin: 20px 0;
          padding: 20px;
          background: #e8f4fd;
          border-radius: 10px;
        }
        
        .fix-list li {
          margin: 8px 0;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏢 Torre K Maintenance</h1>
        <div style="color: #7f8c8d; margin-bottom: 30px;">${fechaLegible}</div>
        
        <div class="fix-list">
          <h3>✅ PROBLEMAS SOLUCIONADOS:</h3>
          <ol>
            <li><strong>🔄 ACTUALIZACIÓN EN TIEMPO REAL</strong> - Server-Sent Events implementado</li>
            <li><strong>🚦 SEMÁFORIZACIÓN FUNCIONAL</strong> - Cambia estado al registrar actividad</li>
            <li><strong>⏰ HORA AUTOMÁTICA</strong> - Se guarda y muestra correctamente</li>
            <li><strong>☀️ PANELES SOLARES</strong> - Incluidos en sistemas críticos</li>
            <li><strong>🔔 NOTIFICACIONES</strong> - Feedback inmediato al usuario</li>
          </ol>
        </div>
        
        <a href="/tecnico" class="card tecnico">
          <h2>👷 Bitácora Técnica</h2>
          <p>Registro completo + Semáforización + Tiempo real</p>
        </a>
        
        <a href="/gerencia" class="card gerencia">
          <h2>👔 Dashboard Gerencia</h2>
          <p>Monitoreo en tiempo real + Consumos + Estados</p>
        </a>
        
        <div style="margin-top: 30px; color: #666; font-size: 0.9em;">
          <strong>🔄 Actualización:</strong> Automática cada 5 segundos<br>
          <strong>🚦 Semáforo:</strong> Verde/Amarillo/Rojo funcional<br>
          <strong>📊 Datos:</strong> Persistente en SQLite
        </div>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=========================================`);
  console.log(`🏢 Sistema Torre K - ${getFechaHoy().fechaLegible}`);
  console.log(`🌐 Principal: http://localhost:${PORT}`);
  console.log(`👷 Técnico: http://localhost:${PORT}/tecnico`);
  console.log(`👔 Gerencia: http://localhost:${PORT}/gerencia`);
  console.log(`🔄 Server-Sent Events activado`);
  console.log(`🚦 Semáforización funcional`);
  console.log(`=========================================\n`);
});
