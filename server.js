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
  // Tabla principal de actividades
  db.run(`
    CREATE TABLE IF NOT EXISTS actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      ubicacion TEXT NOT NULL,
      actividad TEXT NOT NULL,
      tipo_actividad TEXT,
      
      -- DATOS ELÉCTRICOS ESPECÍFICOS (Shelly)
      energia_consumida REAL,    -- Total Energy (+)
      energia_devuelta REAL,     -- Total Returned (-)
      paneles_generacion REAL,   -- kWh generados
      
      -- DATOS DE AGUA
      agua_m3 REAL,
      
      -- Sistemas críticos
      equipo_critico TEXT,
      nuevo_estado TEXT,
      
      observaciones TEXT,
      tecnico TEXT DEFAULT 'Técnico Torre K',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de estados actuales
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

// ==================== FUNCIÓN FECHA CORREGIDA ====================
function getFechaHoy() {
  const hoy = new Date();
  // FIJAR LA FECHA A 31 DE DICIEMBRE 2025 (para pruebas)
  // REMOVER ESTO EN PRODUCCIÓN:
  // hoy.setFullYear(2025, 11, 31); // Mes 11 = Diciembre (0-indexed)
  
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

// ==================== ENDPOINTS MEJORADOS ====================

// 1. REGISTRAR ACTIVIDAD (con datos eléctricos Shelly)
app.post('/api/actividad', (req, res) => {
  const { fechaLegible } = getFechaHoy();
  const horaActual = getHoraActual();
  
  const {
    fecha = getFechaHoy().fecha,
    hora = horaActual,
    ubicacion,
    actividad,
    tipo_actividad = 'otro',
    equipo_critico = '',
    nuevo_estado = '',
    agua_m3,
    energia_consumida,    // Total Energy (+) del Shelly
    energia_devuelta,     // Total Returned (-) del Shelly
    paneles_generacion,
    observaciones = ''
  } = req.body;

  if (!ubicacion || !actividad) {
    return res.status(400).json({ error: 'Ubicación y actividad son requeridas' });
  }

  db.run(`
    INSERT INTO actividades 
    (fecha, hora, ubicacion, actividad, tipo_actividad, equipo_critico, nuevo_estado, 
     agua_m3, energia_consumida, energia_devuelta, paneles_generacion, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fecha, hora, ubicacion, actividad, tipo_actividad, equipo_critico, nuevo_estado,
     agua_m3 || null, energia_consumida || null, energia_devuelta || null, 
     paneles_generacion || null, observaciones],
    function(err) {
      if (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
      }

      // Actualizar estado del equipo si se especificó
      if (equipo_critico && nuevo_estado && ['verde', 'amarillo', 'rojo'].includes(nuevo_estado)) {
        db.run(
          `UPDATE estados_equipos 
           SET estado = ?, ultimo_cambio = ?, observaciones = ?
           WHERE equipo = ?`,
          [nuevo_estado, `${fecha} ${hora}`, observaciones || 'Estado cambiado', equipo_critico]
        );
      }

      res.json({
        success: true,
        id: this.lastID,
        message: '✅ Actividad registrada' + 
                (equipo_critico ? ` y estado de ${equipo_critico} actualizado` : '')
      });
    }
  );
});

// 2. EDITAR ACTIVIDAD
app.put('/api/actividad/:id', (req, res) => {
  const { id } = req.params;
  const {
    ubicacion,
    actividad,
    tipo_actividad,
    agua_m3,
    energia_consumida,
    energia_devuelta,
    paneles_generacion,
    observaciones
  } = req.body;

  db.run(`
    UPDATE actividades 
    SET ubicacion = ?, actividad = ?, tipo_actividad = ?,
        agua_m3 = ?, energia_consumida = ?, energia_devuelta = ?,
        paneles_generacion = ?, observaciones = ?
    WHERE id = ?`,
    [ubicacion, actividad, tipo_actividad,
     agua_m3 || null, energia_consumida || null, energia_devuelta || null,
     paneles_generacion || null, observaciones || '', id],
    function(err) {
      if (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
      }

      res.json({
        success: true,
        changes: this.changes,
        message: this.changes > 0 ? '✅ Actividad actualizada' : '⚠️ No se encontró la actividad'
      });
    }
  );
});

// 3. BORRAR ACTIVIDAD
app.delete('/api/actividad/:id', (req, res) => {
  const { id } = req.params;

  db.run(
    `DELETE FROM actividades WHERE id = ?`,
    [id],
    function(err) {
      if (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
      }

      res.json({
        success: true,
        changes: this.changes,
        message: this.changes > 0 ? '🗑️ Actividad eliminada' : '⚠️ No se encontró la actividad'
      });
    }
  );
});

// 4. OBTENER ACTIVIDADES DEL DÍA
app.get('/api/actividades/hoy', (req, res) => {
  const { fecha } = getFechaHoy();
  
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha = ? 
     ORDER BY hora DESC`,
    [fecha],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// 5. OBTENER UNA ACTIVIDAD ESPECÍFICA
app.get('/api/actividad/:id', (req, res) => {
  db.get(
    `SELECT * FROM actividades WHERE id = ?`,
    [req.params.id],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: 'Actividad no encontrada' });
      res.json(row);
    }
  );
});

// 6. DASHBOARD GERENCIA (SOLO LECTURA)
app.get('/api/dashboard/gerencia', (req, res) => {
  const { fecha, fechaLegible } = getFechaHoy();
  
  // 1. Estados de equipos
  db.all(
    `SELECT * FROM estados_equipos ORDER BY equipo`,
    [],
    (err, equipos) => {
      if (err) return res.status(500).json({ error: err.message });

      // 2. Consumos del día
      db.get(
        `SELECT 
           SUM(COALESCE(agua_m3, 0)) as agua_total,
           SUM(COALESCE(energia_consumida, 0)) as consumo_total,
           SUM(COALESCE(energia_devuelta, 0)) as devuelto_total,
           SUM(COALESCE(paneles_generacion, 0)) as paneles_total
         FROM actividades 
         WHERE fecha = ?`,
        [fecha],
        (err, consumos) => {
          if (err) return res.status(500).json({ error: err.message });

          // 3. Actividades de hoy
          db.all(
            `SELECT * FROM actividades 
             WHERE fecha = ? 
             ORDER BY hora DESC 
             LIMIT 20`,
            [fecha],
            (err, actividades) => {
              if (err) return res.status(500).json({ error: err.message });

              // Calcular balance
              const energia_neto = (consumos.consumo_total || 0) - (consumos.devuelto_total || 0);
              
              res.json({
                fecha: fecha,
                fecha_legible: fechaLegible,
                equipos_criticos: equipos,
                consumos_dia: {
                  agua_m3: consumos.agua_total || 0,
                  energia_consumida: consumos.consumo_total || 0,
                  energia_devuelta: consumos.devuelto_total || 0,
                  paneles_kwh: consumos.paneles_total || 0,
                  energia_neto: energia_neto,
                  balance: energia_neto > 0 ? 'CONSUMO' : 'DEVOLUCIÓN'
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
    }
  );
});

// 7. EXPORTAR EXCEL
app.get('/api/exportar/excel/:fecha?', (req, res) => {
  const fechaExportar = req.params.fecha || getFechaHoy().fecha;
  
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha = ? 
     ORDER BY hora`,
    [fechaExportar],
    (err, actividades) => {
      if (err) return res.status(500).json({ error: err.message });

      // Crear CSV
      let csv = 'Fecha,Hora,Ubicación,Actividad,Tipo,Equipo Crítico,Nuevo Estado,';
      csv += 'Agua (m³),Energy Consumed (+),Energy Returned (-),Paneles (kWh),Observaciones,Técnico\n';
      
      actividades.forEach(a => {
        csv += `"${a.fecha}","${a.hora}","${a.ubicacion}","${a.actividad}","${a.tipo_actividad}",`;
        csv += `"${a.equipo_critico || ''}","${a.nuevo_estado || ''}",`;
        csv += `"${a.agua_m3 || ''}","${a.energia_consumida || ''}","${a.energia_devuelta || ''}",`;
        csv += `"${a.paneles_generacion || ''}","${(a.observaciones || '').replace(/"/g, '""')}","${a.tecnico}"\n`;
      });
      
      // Resumen
      const aguaTotal = actividades.reduce((sum, a) => sum + (a.agua_m3 || 0), 0);
      const consumoTotal = actividades.reduce((sum, a) => sum + (a.energia_consumida || 0), 0);
      const devueltoTotal = actividades.reduce((sum, a) => sum + (a.energia_devuelta || 0), 0);
      const panelesTotal = actividades.reduce((sum, a) => sum + (a.paneles_generacion || 0), 0);
      const energiaNeto = consumoTotal - devueltoTotal;
      
      csv += '\nRESUMEN DEL DÍA,,,,\n';
      csv += `Total Agua: ${aguaTotal.toFixed(3)} m³\n`;
      csv += `Total Energy Consumed (+): ${consumoTotal.toFixed(2)} kWh\n`;
      csv += `Total Energy Returned (-): ${devueltoTotal.toFixed(2)} kWh\n`;
      csv += `Neto CFE: ${energiaNeto.toFixed(2)} kWh\n`;
      csv += `Paneles Solares: ${panelesTotal.toFixed(2)} kWh\n`;
      csv += `Total Actividades: ${actividades.length}\n`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="torre_k_${fechaExportar}.csv"`);
      res.send(csv);
    }
  );
});

// ==================== INTERFACES HTML ====================

// INTERFAZ TÉCNICO (CON EDITAR/BORRAR)
app.get('/tecnico', (req, res) => {
  const { fechaLegible } = getFechaHoy();
  const horaActual = getHoraActual();
  
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
        .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
        
        .header { 
          background: linear-gradient(135deg, #2c3e50 0%, #1a252f 100%);
          color: white; 
          padding: 25px; 
          border-radius: 10px; 
          margin-bottom: 25px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        
        .modal {
          display: none;
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          background: rgba(0,0,0,0.5);
          z-index: 1000;
          align-items: center;
          justify-content: center;
        }
        
        .modal-content {
          background: white;
          padding: 30px;
          border-radius: 10px;
          width: 90%;
          max-width: 500px;
          max-height: 90vh;
          overflow-y: auto;
        }
        
        .form-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 15px 0;
        }
        
        .electricidad-grid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 10px;
          margin: 15px 0;
          padding: 15px;
          background: #e8f4fd;
          border-radius: 8px;
        }
        
        .btn {
          padding: 12px 24px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-weight: 600;
          margin: 5px;
        }
        
        .btn-guardar { background: #27ae60; color: white; }
        .btn-editar { background: #f39c12; color: white; padding: 6px 12px; font-size: 0.9em; }
        .btn-eliminar { background: #e74c3c; color: white; padding: 6px 12px; font-size: 0.9em; }
        .btn-cancelar { background: #95a5a6; color: white; }
        .btn-descargar { background: #2980b9; color: white; }
        
        .actividad-item {
          background: white;
          padding: 15px;
          margin-bottom: 10px;
          border-radius: 8px;
          border-left: 4px solid #27ae60;
          box-shadow: 0 2px 5px rgba(0,0,0,0.05);
        }
        
        .actividad-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }
        
        .acciones {
          display: flex;
          gap: 8px;
        }
        
        .consumo-badge {
          display: inline-block;
          background: #e3f2fd;
          color: #1565c0;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 0.85em;
          margin-right: 8px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🔧 Bitácora Técnico - Torre K</h1>
          <p>${fechaLegible}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            <strong>Exclusivo para técnicos:</strong> Registrar, editar y eliminar actividades
          </p>
        </div>
        
        <!-- BOTÓN NUEVA ACTIVIDAD -->
        <div style="text-align: center; margin: 30px 0;">
          <button onclick="mostrarModalNuevo()" class="btn btn-guardar" style="padding: 15px 40px; font-size: 16px;">
            ➕ Nueva Actividad
          </button>
          <button onclick="exportarExcel()" class="btn btn-descargar" style="padding: 15px 40px; font-size: 16px;">
            📥 Exportar Hoy a Excel
          </button>
        </div>
        
        <!-- LISTA DE ACTIVIDADES -->
        <div id="listaActividades">
          <p style="text-align: center; color: #7f8c8d; padding: 40px;">
            Cargando actividades...
          </p>
        </div>
      </div>
      
      <!-- MODAL NUEVA ACTIVIDAD -->
      <div id="modalNuevo" class="modal">
        <div class="modal-content">
          <h2 style="color: #2c3e50; margin-bottom: 20px;">➕ Nueva Actividad</h2>
          
          <form id="formNuevo">
            <div class="form-grid">
              <div>
                <label>📍 Ubicación *</label>
                <input type="text" id="nuevo_ubicacion" required>
              </div>
              <div>
                <label>🕒 Hora *</label>
                <input type="time" id="nuevo_hora" value="${horaActual}" required>
              </div>
            </div>
            
            <div style="margin: 15px 0;">
              <label>🔧 Actividad *</label>
              <textarea id="nuevo_actividad" rows="3" required></textarea>
            </div>
            
            <div class="form-grid">
              <div>
                <label>📋 Tipo</label>
                <select id="nuevo_tipo">
                  <option value="lectura">📖 Lectura Medidores</option>
                  <option value="electricidad">⚡ Electricidad</option>
                  <option value="agua">💧 Agua</option>
                  <option value="paneles">☀️ Paneles Solares</option>
                  <option value="mantenimiento">🔧 Mantenimiento</option>
                </select>
              </div>
              <div>
                <label>⚡ Sistema crítico</label>
                <select id="nuevo_equipo">
                  <option value="">-- Ninguno --</option>
                  <option value="Cisterna de Agua">💧 Cisterna</option>
                  <option value="Sistema Eléctrico Principal">⚡ Eléctrico Principal</option>
                  <option value="Paneles Solares">☀️ Paneles Solares</option>
                  <option value="Elevador Mitsubishi">🚪 Elevador</option>
                  <option value="Software de Tickets">💰 Software Tickets</option>
                </select>
              </div>
            </div>
            
            <!-- SELECTOR DE ESTADO -->
            <div id="selectorEstado" style="margin: 15px 0; padding: 15px; background: #fff8e1; border-radius: 8px; display: none;">
              <label style="color: #f57c00;">🚦 Cambiar estado</label>
              <div style="display: flex; gap: 10px; margin-top: 10px;">
                <label style="flex: 1; text-align: center;">
                  <input type="radio" name="nuevo_estado" value="verde">
                  🟢 OPERATIVO
                </label>
                <label style="flex: 1; text-align: center;">
                  <input type="radio" name="nuevo_estado" value="amarillo">
                  🟡 ATENCIÓN
                </label>
                <label style="flex: 1; text-align: center;">
                  <input type="radio" name="nuevo_estado" value="rojo">
                  🔴 CRÍTICO
                </label>
              </div>
            </div>
            
            <!-- DATOS ELÉCTRICOS SHELLY -->
            <div class="electricidad-grid">
              <div>
                <label>💧 Agua (m³)</label>
                <input type="number" id="nuevo_agua" step="0.001" placeholder="0.000">
              </div>
              <div>
                <label>⚡ Energy Consumed (+)</label>
                <input type="number" id="nuevo_consumo" step="0.01" placeholder="kWh">
              </div>
              <div>
                <label>⚡ Energy Returned (-)</label>
                <input type="number" id="nuevo_devuelto" step="0.01" placeholder="kWh">
              </div>
              <div>
                <label>☀️ Paneles (kWh)</label>
                <input type="number" id="nuevo_paneles" step="0.01" placeholder="kWh">
              </div>
            </div>
            
            <div style="margin: 15px 0;">
              <label>📝 Observaciones</label>
              <textarea id="nuevo_observaciones" rows="2"></textarea>
            </div>
            
            <div style="text-align: right; margin-top: 20px;">
              <button type="button" onclick="ocultarModal('modalNuevo')" class="btn btn-cancelar">Cancelar</button>
              <button type="submit" class="btn btn-guardar">✅ Guardar</button>
            </div>
          </form>
        </div>
      </div>
      
      <!-- MODAL EDITAR ACTIVIDAD -->
      <div id="modalEditar" class="modal">
        <div class="modal-content">
          <h2 style="color: #2c3e50; margin-bottom: 20px;">✏️ Editar Actividad</h2>
          
          <form id="formEditar">
            <input type="hidden" id="editar_id">
            
            <div class="form-grid">
              <div>
                <label>📍 Ubicación *</label>
                <input type="text" id="editar_ubicacion" required>
              </div>
              <div>
                <label>🕒 Hora *</label>
                <input type="time" id="editar_hora" required>
              </div>
            </div>
            
            <div style="margin: 15px 0;">
              <label>🔧 Actividad *</label>
              <textarea id="editar_actividad" rows="3" required></textarea>
            </div>
            
            <div class="form-grid">
              <div>
                <label>📋 Tipo</label>
                <select id="editar_tipo">
                  <option value="lectura">📖 Lectura Medidores</option>
                  <option value="electricidad">⚡ Electricidad</option>
                  <option value="agua">💧 Agua</option>
                  <option value="paneles">☀️ Paneles Solares</option>
                  <option value="mantenimiento">🔧 Mantenimiento</option>
                </select>
              </div>
            </div>
            
            <!-- DATOS ELÉCTRICOS SHELLY -->
            <div class="electricidad-grid">
              <div>
                <label>💧 Agua (m³)</label>
                <input type="number" id="editar_agua" step="0.001">
              </div>
              <div>
                <label>⚡ Energy Consumed (+)</label>
                <input type="number" id="editar_consumo" step="0.01">
              </div>
              <div>
                <label>⚡ Energy Returned (-)</label>
                <input type="number" id="editar_devuelto" step="0.01">
              </div>
              <div>
                <label>☀️ Paneles (kWh)</label>
                <input type="number" id="editar_paneles" step="0.01">
              </div>
            </div>
            
            <div style="margin: 15px 0;">
              <label>📝 Observaciones</label>
              <textarea id="editar_observaciones" rows="2"></textarea>
            </div>
            
            <div style="text-align: right; margin-top: 20px;">
              <button type="button" onclick="ocultarModal('modalEditar')" class="btn btn-cancelar">Cancelar</button>
              <button type="submit" class="btn btn-guardar">💾 Guardar Cambios</button>
            </div>
          </form>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        const hoy = "${getFechaHoy().fecha}";
        
        // Mostrar/ocultar modal
        function mostrarModalNuevo() {
          document.getElementById('modalNuevo').style.display = 'flex';
          document.getElementById('nuevo_hora').value = "${horaActual}";
        }
        
        function mostrarModalEditar(id) {
          cargarActividadParaEditar(id);
          document.getElementById('modalEditar').style.display = 'flex';
        }
        
        function ocultarModal(modalId) {
          document.getElementById(modalId).style.display = 'none';
        }
        
        // Mostrar selector de estado cuando se selecciona equipo
        document.getElementById('nuevo_equipo').addEventListener('change', function() {
          const selector = document.getElementById('selectorEstado');
          selector.style.display = this.value ? 'block' : 'none';
        });
        
        // Cargar actividades al iniciar
        cargarActividades();
        
        // FORMULARIO NUEVO
        document.getElementById('formNuevo').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const actividad = {
            ubicacion: document.getElementById('nuevo_ubicacion').value,
            hora: document.getElementById('nuevo_hora').value,
            actividad: document.getElementById('nuevo_actividad').value,
            tipo_actividad: document.getElementById('nuevo_tipo').value,
            equipo_critico: document.getElementById('nuevo_equipo').value,
            nuevo_estado: document.querySelector('input[name="nuevo_estado"]:checked')?.value || '',
            agua_m3: document.getElementById('nuevo_agua').value || null,
            energia_consumida: document.getElementById('nuevo_consumo').value || null,
            energia_devuelta: document.getElementById('nuevo_devuelto').value || null,
            paneles_generacion: document.getElementById('nuevo_paneles').value || null,
            observaciones: document.getElementById('nuevo_observaciones').value
          };
          
          try {
            const response = await fetch(API_URL + '/api/actividad', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(actividad)
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert(data.message);
              document.getElementById('formNuevo').reset();
              ocultarModal('modalNuevo');
              cargarActividades();
            }
          } catch (error) {
            alert('❌ Error de conexión');
            console.error(error);
          }
        });
        
        // CARGAR ACTIVIDAD PARA EDITAR
        async function cargarActividadParaEditar(id) {
          try {
            const response = await fetch(API_URL + '/api/actividad/' + id);
            const actividad = await response.json();
            
            document.getElementById('editar_id').value = actividad.id;
            document.getElementById('editar_ubicacion').value = actividad.ubicacion;
            document.getElementById('editar_hora').value = actividad.hora;
            document.getElementById('editar_actividad').value = actividad.actividad;
            document.getElementById('editar_tipo').value = actividad.tipo_actividad;
            document.getElementById('editar_agua').value = actividad.agua_m3 || '';
            document.getElementById('editar_consumo').value = actividad.energia_consumida || '';
            document.getElementById('editar_devuelto').value = actividad.energia_devuelta || '';
            document.getElementById('editar_paneles').value = actividad.paneles_generacion || '';
            document.getElementById('editar_observaciones').value = actividad.observaciones || '';
            
          } catch (error) {
            alert('Error cargando actividad');
          }
        }
        
        // FORMULARIO EDITAR
        document.getElementById('formEditar').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const id = document.getElementById('editar_id').value;
          const actividad = {
            ubicacion: document.getElementById('editar_ubicacion').value,
            actividad: document.getElementById('editar_actividad').value,
            tipo_actividad: document.getElementById('editar_tipo').value,
            agua_m3: document.getElementById('editar_agua').value || null,
            energia_consumida: document.getElementById('editar_consumo').value || null,
            energia_devuelta: document.getElementById('editar_devuelto').value || null,
            paneles_generacion: document.getElementById('editar_paneles').value || null,
            observaciones: document.getElementById('editar_observaciones').value
          };
          
          try {
            const response = await fetch(API_URL + '/api/actividad/' + id, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(actividad)
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert(data.message);
              ocultarModal('modalEditar');
              cargarActividades();
            }
          } catch (error) {
            alert('Error actualizando actividad');
          }
        });
        
        // ELIMINAR ACTIVIDAD
        async function eliminarActividad(id) {
          if (!confirm('¿Seguro que quieres eliminar esta actividad?')) return;
          
          try {
            const response = await fetch(API_URL + '/api/actividad/' + id, {
              method: 'DELETE'
            });
            
            const data = await response.json();
            
            if (data.success) {
              alert(data.message);
              cargarActividades();
            }
          } catch (error) {
            alert('Error eliminando actividad');
          }
        }
        
        // CARGAR ACTIVIDADES
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
              // Badges de consumo
              let badges = '';
              if (a.agua_m3) badges += \`<span class="consumo-badge">💧 \${parseFloat(a.agua_m3).toFixed(3)} m³</span>\`;
              if (a.energia_consumida) badges += \`<span class="consumo-badge">🔌 +\${parseFloat(a.energia_consumida).toFixed(2)} kWh</span>\`;
              if (a.energia_devuelta) badges += \`<span class="consumo-badge">↩️ -\${parseFloat(a.energia_devuelta).toFixed(2)} kWh</span>\`;
              if (a.paneles_generacion) badges += \`<span class="consumo-badge">☀️ \${parseFloat(a.paneles_generacion).toFixed(2)} kWh</span>\`;
              
              // Badge de estado
              let estadoBadge = '';
              if (a.nuevo_estado === 'verde') {
                estadoBadge = '<span style="background: #d5f4e6; color: #27ae60; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 8px;">🟢 OPERATIVO</span>';
              } else if (a.nuevo_estado === 'amarillo') {
                estadoBadge = '<span style="background: #fff3cd; color: #856404; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 8px;">🟡 ATENCIÓN</span>';
              } else if (a.nuevo_estado === 'rojo') {
                estadoBadge = '<span style="background: #f8d7da; color: #721c24; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 8px;">🔴 CRÍTICO</span>';
              }
              
              return \`
                <div class="actividad-item">
                  <div class="actividad-header">
                    <div>
                      <span style="background: #e9ecef; padding: 3px 8px; border-radius: 12px; font-size: 0.9em; color: #7f8c8d;">
                        \${a.hora}
                      </span>
                      <strong>\${a.actividad}</strong>
                      \${a.equipo_critico ? '<span style="background: #fff3cd; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 8px;">' + a.equipo_critico + '</span>' : ''}
                      \${estadoBadge}
                    </div>
                    <div class="acciones">
                      <button onclick="mostrarModalEditar(\${a.id})" class="btn btn-editar">✏️ Editar</button>
                      <button onclick="eliminarActividad(\${a.id})" class="btn btn-eliminar">🗑️ Eliminar</button>
                    </div>
                  </div>
                  <div style="margin-top: 8px; color: #5a6268;">
                    📍 \${a.ubicacion} • \${a.tipo_actividad}
                    \${badges}
                  </div>
                  \${a.observaciones ? '<div style="margin-top: 8px; font-style: italic; color: #6c757d;">' + a.observaciones + '</div>' : ''}
                </div>
              \`;
            }).join('');
            
          } catch (error) {
            console.error('Error cargando actividades:', error);
            lista.innerHTML = '<p style="color: #e74c3c; text-align: center;">Error cargando actividades</p>';
          }
        }
        
        // EXPORTAR EXCEL
        function exportarExcel() {
          window.open(API_URL + '/api/exportar/excel/' + hoy, '_blank');
        }
        
        // Auto-refresh
        setInterval(cargarActividades, 60000);
      </script>
    </body>
    </html>
  `);
});

// DASHBOARD GERENCIA (SOLO LECTURA - SIN ACCESO A BITÁCORA)
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
        
        .alert {
          background: #fff3cd;
          border-left: 4px solid #f39c12;
          padding: 15px;
          margin: 20px 0;
          border-radius: 8px;
          font-size: 0.9em;
        }
        
        .consumo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .consumo-card {
          background: white;
          padding: 25px;
          border-radius: 10px;
          text-align: center;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
        }
        
        .consumo-icon { font-size: 2.5em; margin-bottom: 15px; }
        .consumo-valor { font-size: 2.2em; font-weight: bold; margin: 10px 0; }
        .consumo-detalle { color: #666; font-size: 0.9em; margin-top: 5px; }
        
        .semaforo-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 20px;
          margin: 30px 0;
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
        
        .actividad-item {
          padding: 15px;
          border-bottom: 1px solid #eee;
        }
        
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
        
        .positivo { color: #e74c3c; }
        .negativo { color: #27ae60; }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🏢 Dashboard Gerencia - Torre K</h1>
          <p>${fechaLegible}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            Monitoreo en tiempo real • Acceso de solo lectura
          </p>
          <div style="margin-top: 20px;">
            <button onclick="cargarDashboard()" class="btn">🔄 Actualizar</button>
            <button onclick="exportarExcel()" class="btn btn-descargar">📥 Exportar Reporte</button>
            <button onclick="window.location.href='/'" class="btn">🏠 Inicio</button>
          </div>
        </div>
        
        <!-- ALERTA DE ACCESO -->
        <div class="alert">
          ⚠️ <strong>Acceso restringido:</strong> Este dashboard es de solo lectura. 
          Para registrar actividades o cambiar estados, contacte al técnico autorizado.
        </div>
        
        <!-- CONSUMOS -->
        <h2 style="color: #2c3e50; margin-bottom: 15px;">📊 Consumos del Día</h2>
        <div class="consumo-grid">
          <div class="consumo-card">
            <div class="consumo-icon">💧</div>
            <div class="consumo-valor" id="totalAgua">0.000</div>
            <div>metros cúbicos</div>
            <div class="consumo-detalle">Consumo total de agua</div>
          </div>
          
          <div class="consumo-card">
            <div class="consumo-icon">🔌</div>
            <div class="consumo-valor" id="totalConsumo">0.00</div>
            <div>kilowatt-hora</div>
            <div class="consumo-detalle">Energy Consumed (+)</div>
          </div>
          
          <div class="consumo-card">
            <div class="consumo-icon">↩️</div>
            <div class="consumo-valor" id="totalDevuelto">0.00</div>
            <div>kilowatt-hora</div>
            <div class="consumo-detalle">Energy Returned (-)</div>
          </div>
          
          <div class="consumo-card">
            <div class="consumo-icon">⚖️</div>
            <div class="consumo-valor" id="totalNeto">0.00</div>
            <div>kilowatt-hora</div>
            <div class="consumo-detalle" id="balanceTexto">Neto CFE</div>
          </div>
        </div>
        
        <!-- SEMÁFORO -->
        <h2 style="color: #2c3e50; margin: 30px 0 15px 0;">🚦 Estado de Sistemas</h2>
        <div class="semaforo-grid" id="semaforoGrid">
          <p>Cargando sistemas...</p>
        </div>
        
        <!-- ACTIVIDADES -->
        <div style="background: white; padding: 25px; border-radius: 10px; margin-top: 30px;">
          <h2 style="color: #2c3e50; margin-bottom: 20px;">📝 Actividades Recientes</h2>
          <div id="actividadesRecientes">
            <p>Cargando actividades...</p>
          </div>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        
        cargarDashboard();
        
        async function cargarDashboard() {
          try {
            const response = await fetch(API_URL + '/api/dashboard/gerencia');
            const data = await response.json();
            
            // Actualizar consumos
            document.getElementById('totalAgua').textContent = data.consumos_dia.agua_m3.toFixed(3);
            document.getElementById('totalConsumo').textContent = data.consumos_dia.energia_consumida.toFixed(2);
            document.getElementById('totalDevuelto').textContent = data.consumos_dia.energia_devuelta.toFixed(2);
            
            const neto = data.consumos_dia.energia_neto;
            const netoElem = document.getElementById('totalNeto');
            const balanceTexto = document.getElementById('balanceTexto');
            
            netoElem.textContent = Math.abs(neto).toFixed(2);
            if (neto > 0) {
              netoElem.className = 'consumo-valor positivo';
              balanceTexto.innerHTML = '<span style="color: #e74c3c;">CONSUMO NETO CFE</span>';
            } else {
              netoElem.className = 'consumo-valor negativo';
              balanceTexto.innerHTML = '<span style="color: #27ae60;">DEVOLUCIÓN NETO CFE</span>';
            }
            
            // Actualizar semáforo
            const semaforoGrid = document.getElementById('semaforoGrid');
            semaforoGrid.innerHTML = data.equipos_criticos.map(e => {
              let icono = '🟢';
              if (e.estado === 'amarillo') icono = '🟡';
              if (e.estado === 'rojo') icono = '🔴';
              
              return \`
                <div class="sistema-card \${e.estado}">
                  <div style="font-size: 2em; margin-bottom: 10px;">\${icono}</div>
                  <h3 style="margin: 0 0 5px 0;">\${e.equipo}</h3>
                  <div style="color: #666; font-size: 0.9em; margin-bottom: 10px;">
                    \${e.ultimo_cambio ? 'Cambio: ' + e.ultimo_cambio.split(' ')[0] : ''}
                  </div>
                </div>
              \`;
            }).join('');
            
            // Mostrar actividades
            const actividadesDiv = document.getElementById('actividadesRecientes');
            if (data.actividades_hoy.length === 0) {
              actividadesDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No hay actividades hoy</p>';
            } else {
              actividadesDiv.innerHTML = data.actividades_hoy.map(a => {
                let consumos = '';
                if (a.agua_m3) consumos += \`💧 \${parseFloat(a.agua_m3).toFixed(3)} m³ \`;
                if (a.energia_consumida) consumos += \`🔌 +\${parseFloat(a.energia_consumida).toFixed(2)} kWh \`;
                if (a.energia_devuelta) consumos += \`↩️ -\${parseFloat(a.energia_devuelta).toFixed(2)} kWh \`;
                if (a.paneles_generacion) consumos += \`☀️ \${parseFloat(a.paneles_generacion).toFixed(2)} kWh\`;
                
                return \`
                  <div class="actividad-item">
                    <div>
                      <span style="color: #7f8c8d; font-size: 0.9em;">\${a.hora}</span>
                      <strong>\${a.actividad}</strong>
                    </div>
                    <div style="color: #666; font-size: 0.9em; margin-top: 5px;">
                      📍 \${a.ubicacion}
                      \${a.equipo_critico ? ' • ' + a.equipo_critico : ''}
                    </div>
                    \${consumos ? '<div style="color: #1565c0; font-size: 0.85em; margin-top: 5px;">' + consumos + '</div>' : ''}
                  </div>
                \`;
              }).join('');
            }
            
          } catch (error) {
            console.error('Error:', error);
            alert('Error cargando dashboard');
          }
        }
        
        function exportarExcel() {
          const hoy = "${getFechaHoy().fecha}";
          window.open(API_URL + '/api/exportar/excel/' + hoy, '_blank');
        }
        
        // Auto-refresh
        setInterval(cargarDashboard, 120000);
      </script>
    </body>
    </html>
  `);
});

// PÁGINA PRINCIPAL (sin enlace a bitácora desde gerencia)
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
        
        h1 { 
          color: #2c3e50; 
          margin-bottom: 10px;
          font-size: 2.5em;
        }
        
        .fecha {
          color: #7f8c8d;
          margin-bottom: 30px;
          font-size: 1.1em;
        }
        
        .card {
          background: #f8f9fa;
          border-radius: 15px;
          padding: 30px;
          margin: 20px 0;
          transition: transform 0.3s;
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
        
        .note {
          background: #fff3cd;
          border-left: 4px solid #f39c12;
          padding: 15px;
          margin: 20px 0;
          border-radius: 8px;
          text-align: left;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏢 Torre K Maintenance</h1>
        <div class="fecha">${fechaLegible}</div>
        
        <div class="note">
          <strong>🔐 Accesos separados:</strong><br>
          • <strong>Técnico:</strong> Registra, edita y elimina actividades<br>
          • <strong>Gerencia:</strong> Solo visualización y reportes
        </div>
        
        <a href="/tecnico" class="card tecnico">
          <h2>👷 Área Técnica</h2>
          <p>Acceso completo para registro y gestión</p>
          <ul style="text-align: left; margin-top: 10px; padding-left: 20px; font-size: 0.9em;">
            <li>✏️ Editar y eliminar actividades</li>
            <li>🚦 Cambiar estado de sistemas</li>
            <li>💾 Datos eléctricos Shelly</li>
            <li>📥 Exportar a Excel</li>
          </ul>
        </a>
        
        <a href="/gerencia" class="card gerencia">
          <h2>👔 Dashboard Gerencia</h2>
          <p>Monitoreo en tiempo real (solo lectura)</p>
          <ul style="text-align: left; margin-top: 10px; padding-left: 20px; font-size: 0.9em;">
            <li>📊 Consumos de agua y energía</li>
            <li>🚦 Semáforo de sistemas</li>
            <li>📝 Ver actividades (sin editar)</li>
            <li>📥 Exportar reportes</li>
          </ul>
        </a>
        
        <p style="margin-top: 30px; color: #7f8c8d; font-size: 0.85em;">
          Sistema optimizado para Torre K • Fecha correcta: ${fechaLegible}
        </p>
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
  console.log(`👷 Técnico (EDITAR/BORRAR): http://localhost:${PORT}/tecnico`);
  console.log(`👔 Gerencia (SOLO LECTURA): http://localhost:${PORT}/gerencia`);
  console.log(`=========================================\n`);
});
