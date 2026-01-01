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
  // Tabla principal (CON HORA EN TABLA PERO NO EN FORMULARIO)
  db.run(`
    CREATE TABLE IF NOT EXISTS actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      hora TEXT,  -- Mantenemos el campo pero será automático
      ubicacion TEXT NOT NULL,
      actividad TEXT NOT NULL,
      tipo_actividad TEXT,
      
      -- CONSUMOS
      agua_m3 REAL,
      energia_consumida REAL,    -- Energy Consumed (+)
      paneles_kwh REAL,          -- Energy Returned (-)
      
      -- Sistemas críticos
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

  // Insertar equipos críticos (CON PANELES SOLARES)
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
    'Paneles Solares',  // ¡AHORA SÍ ESTÁ!
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

// ==================== ENDPOINTS MEJORADOS ====================

// 1. REGISTRAR ACTIVIDAD (CON HORA AUTOMÁTICA)
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

      console.log(`✅ Actividad ${this.lastID} registrada a las ${hora}`);

      // ACTUALIZAR ESTADO DEL EQUIPO si se especificó
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
            }
          }
        );
      }

      res.json({
        success: true,
        id: this.lastID,
        hora_registrada: hora,
        message: '✅ Actividad registrada' + 
                (equipo_critico ? ` y estado de ${equipo_critico} actualizado` : ''),
        fecha_guardada: fecha
      });
    }
  );
});

// 2. OBTENER ACTIVIDADES DE HOY (MEJORADO)
app.get('/api/actividades/hoy', (req, res) => {
  const { fecha } = getFechaHoy();
  
  console.log(`📋 Solicitando actividades para ${fecha}`);
  
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
      console.log(`✅ ${rows.length} actividades encontradas`);
      res.json(rows);
    }
  );
});

// 3. DASHBOARD GERENCIA (MEJORADO)
app.get('/api/dashboard/gerencia', (req, res) => {
  const { fecha, fechaLegible } = getFechaHoy();
  
  console.log(`📊 Dashboard solicitado para ${fecha}`);
  
  // 1. Obtener estados actuales de equipos
  db.all(
    `SELECT * FROM estados_equipos ORDER BY equipo`,
    [],
    (err, equipos) => {
      if (err) {
        console.error('❌ Error equipos:', err.message);
        return res.status(500).json({ error: err.message });
      }

      // 2. Obtener CONSUMOS DEL DÍA
      db.get(
        `SELECT 
           SUM(COALESCE(agua_m3, 0)) as agua_total,
           SUM(COALESCE(energia_consumida, 0)) as consumo_total,
           SUM(COALESCE(paneles_kwh, 0)) as paneles_total
         FROM actividades 
         WHERE fecha = ?`,
        [fecha],
        (err, consumos) => {
          if (err) {
            console.error('❌ Error consumos:', err.message);
            return res.status(500).json({ error: err.message });
          }

          // 3. Obtener actividades de hoy
          db.all(
            `SELECT * FROM actividades 
             WHERE fecha = ? 
             ORDER BY created_at DESC 
             LIMIT 15`,
            [fecha],
            (err, actividades) => {
              if (err) {
                console.error('❌ Error actividades:', err.message);
                return res.status(500).json({ error: err.message });
              }

              console.log(`📊 Dashboard: ${actividades.length} actividades, ${equipos.length} equipos`);

              // 4. Calcular energía neta
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
    }
  );
});

// 4. EDITAR ACTIVIDAD
app.put('/api/actividad/:id', (req, res) => {
  const { id } = req.params;
  const {
    ubicacion,
    actividad,
    tipo_actividad,
    agua_m3,
    energia_consumida,
    paneles_kwh,
    observaciones
  } = req.body;

  console.log(`✏️ Editando actividad ${id}`);

  db.run(`
    UPDATE actividades 
    SET ubicacion = ?, actividad = ?, tipo_actividad = ?,
        agua_m3 = ?, energia_consumida = ?, paneles_kwh = ?,
        observaciones = ?
    WHERE id = ?`,
    [ubicacion, actividad, tipo_actividad,
     agua_m3 || null, energia_consumida || null, paneles_kwh || null,
     observaciones || '', id],
    function(err) {
      if (err) {
        console.error('❌ Error:', err.message);
        return res.status(500).json({ error: err.message });
      }

      console.log(`✅ Actividad ${id} actualizada (${this.changes} cambios)`);

      res.json({
        success: true,
        changes: this.changes,
        message: this.changes > 0 ? '✅ Actividad actualizada' : '⚠️ No se encontró la actividad'
      });
    }
  );
});

// 5. BORRAR ACTIVIDAD
app.delete('/api/actividad/:id', (req, res) => {
  const { id } = req.params;

  console.log(`🗑️ Eliminando actividad ${id}`);

  db.run(
    `DELETE FROM actividades WHERE id = ?`,
    [id],
    function(err) {
      if (err) {
        console.error('❌ Error:', err.message);
        return res.status(500).json({ error: err.message });
      }

      console.log(`✅ Actividad ${id} eliminada (${this.changes} cambios)`);

      res.json({
        success: true,
        changes: this.changes,
        message: this.changes > 0 ? '🗑️ Actividad eliminada' : '⚠️ No se encontró la actividad'
      });
    }
  );
});

// 6. OBTENER UNA ACTIVIDAD
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

// 7. EXPORTAR EXCEL
app.get('/api/exportar/excel/:fecha?', (req, res) => {
  const fechaExportar = req.params.fecha || getFechaHoy().fecha;
  
  console.log(`📥 Exportando Excel para ${fechaExportar}`);
  
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha = ? 
     ORDER BY hora`,
    [fechaExportar],
    (err, actividades) => {
      if (err) return res.status(500).json({ error: err.message });

      let csv = '';
      
      csv += 'Fecha,Hora,Ubicación,Actividad,Tipo,Equipo Crítico,Nuevo Estado,Agua (m³),Energy Consumed (+),Energy Returned (-),Observaciones,Técnico\n';
      
      actividades.forEach(a => {
        csv += `"${a.fecha}","${a.hora || ''}","${a.ubicacion}","${a.actividad}","${a.tipo_actividad}",`;
        csv += `"${a.equipo_critico || ''}","${a.nuevo_estado || ''}",`;
        csv += `"${a.agua_m3 || ''}","${a.energia_consumida || ''}","${a.paneles_kwh || ''}",`;
        csv += `"${(a.observaciones || '').replace(/"/g, '""')}","${a.tecnico}"\n`;
      });
      
      const aguaTotal = actividades.reduce((sum, a) => sum + (a.agua_m3 || 0), 0);
      const consumoTotal = actividades.reduce((sum, a) => sum + (a.energia_consumida || 0), 0);
      const panelesTotal = actividades.reduce((sum, a) => sum + (a.paneles_kwh || 0), 0);
      const energiaNeta = consumoTotal - panelesTotal;
      
      csv += '\n';
      csv += 'RESUMEN DEL DÍA,,,,\n';
      csv += `Total Agua: ${aguaTotal.toFixed(3)} m³\n`;
      csv += `Total Energy Consumed (+): ${consumoTotal.toFixed(2)} kWh\n`;
      csv += `Total Energy Returned (-): ${panelesTotal.toFixed(2)} kWh\n`;
      csv += `Neto CFE: ${energiaNeta.toFixed(2)} kWh (${energiaNeta > 0 ? 'CONSUMO' : 'DEVOLUCIÓN'})\n`;
      csv += `Total Actividades: ${actividades.length}\n`;

      console.log(`✅ Excel exportado: ${actividades.length} actividades`);

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="torre_k_${fechaExportar}.csv"`);
      res.send(csv);
    }
  );
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
        
        .consumo-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 15px;
          margin: 15px 0;
          padding: 15px;
          background: #e8f4fd;
          border-radius: 8px;
        }
        
        .consumo-label {
          font-size: 0.85em;
          color: #1a73e8;
          margin-bottom: 5px;
        }
        
        .consumo-input {
          background: white;
          padding: 10px;
          border: 1px solid #bbdefb;
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
        .btn-descargar { background: #2980b9; }
        .btn-descargar:hover { background: #1c6ea4; }
        
        .btn-editar {
          background: #f39c12;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 5px;
          font-size: 0.85em;
          cursor: pointer;
          margin-left: 5px;
        }
        
        .btn-eliminar {
          background: #e74c3c;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 5px;
          font-size: 0.85em;
          cursor: pointer;
          margin-left: 5px;
        }
        
        .actividad-item {
          padding: 15px;
          border-left: 4px solid #27ae60;
          margin-bottom: 10px;
          background: #f8f9fa;
          border-radius: 6px;
          position: relative;
        }
        
        .actividad-item.con-consumo { border-left-color: #2196f3; }
        .actividad-item.critico { border-left-color: #e74c3c; }
        
        .acciones {
          position: absolute;
          top: 15px;
          right: 15px;
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
        
        .estado-badge {
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
        
        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .close-modal {
          background: #95a5a6;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 5px;
          cursor: pointer;
        }
        
        .auto-refresh-info {
          background: #e8f4fd;
          padding: 10px;
          border-radius: 8px;
          margin: 10px 0;
          font-size: 0.9em;
          color: #1a73e8;
          text-align: center;
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
            <strong>📋 Registro diario • Editar/Borrar actividades • Exportar a Excel</strong>
          </p>
          <div class="auto-refresh-info">
            ⏰ La hora se registra automáticamente • 🔄 Se actualiza cada 30 segundos
          </div>
        </div>
        
        <!-- FORMULARIO -->
        <div class="form-section">
          <h2 style="margin-bottom: 20px; color: #2c3e50;">➕ Nueva Actividad</h2>
          
          <form id="formActividad">
            <div class="form-row">
              <div>
                <label>📍 Ubicación:</label>
                <input type="text" id="ubicacion" placeholder="Ej: Planta Baja, Azotea, Sótano..." required>
              </div>
            </div>
            
            <div style="margin-bottom: 20px;">
              <label>🔧 Actividad realizada:</label>
              <textarea id="actividad" rows="3" placeholder="Ej: Lectura de medidores, revisión eléctrica, reparación..." required></textarea>
            </div>
            
            <div class="form-row">
              <div>
                <label>📋 Tipo de actividad:</label>
                <select id="tipo_actividad">
                  <option value="lectura">📖 Lectura de Medidores</option>
                  <option value="electricidad">⚡ Electricidad CFE</option>
                  <option value="agua">💧 Agua</option>
                  <option value="paneles">☀️ Paneles Solares</option>
                  <option value="mantenimiento">🔧 Mantenimiento</option>
                  <option value="limpieza">🧹 Limpieza</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              
              <div>
                <label>⚡ Sistema crítico afectado:</label>
                <select id="equipo_critico">
                  <option value="">-- Ninguno --</option>
                  <option value="Cisterna de Agua">💧 Cisterna de Agua</option>
                  <option value="Tanque Elevado">💧 Tanque Elevado</option>
                  <option value="Sistema Eléctrico Principal">⚡ Sistema Eléctrico</option>
                  <option value="Tablero General">⚡ Tablero General</option>
                  <option value="Paneles Solares">☀️ Paneles Solares</option> <!-- ¡AHORA SÍ ESTÁ! -->
                  <option value="Software de Tickets Estacionamiento">💰 Software Tickets</option>
                  <option value="Elevador Mitsubishi">🚪 Elevador</option>
                  <option value="Bomba Contra Incendio">🛡️ Bomba Incendio</option>
                  <option value="Planta de Emergencia">🔋 Planta Emergencia</option>
                </select>
              </div>
            </div>
            
            <!-- CAMPOS DE CONSUMO -->
            <div class="consumo-row">
              <div>
                <div class="consumo-label">💧 Agua consumida:</div>
                <input type="number" id="agua_m3" step="0.001" class="consumo-input" placeholder="m³">
                <small style="color: #666;">metros cúbicos</small>
              </div>
              
              <div>
                <div class="consumo-label">🔌 Energy Consumed (+):</div>
                <input type="number" id="energia_consumida" step="0.1" class="consumo-input" placeholder="kWh">
                <small style="color: #666;">Consumo CFE</small>
              </div>
              
              <div>
                <div class="consumo-label">↩️ Energy Returned (-):</div>
                <input type="number" id="paneles_kwh" step="0.1" class="consumo-input" placeholder="kWh">
                <small style="color: #666;">Paneles solares</small>
              </div>
            </div>
            
            <!-- SELECTOR DE ESTADO -->
            <div id="selectorEstado" style="margin: 20px 0; padding: 15px; background: #fff8e1; border-radius: 8px; display: none;">
              <label style="color: #f57c00;">🚦 Cambiar estado del sistema:</label>
              <div style="display: flex; gap: 10px; margin-top: 10px;">
                <label style="flex: 1; text-align: center;">
                  <input type="radio" name="estado" value="verde" onclick="document.getElementById('nuevo_estado').value='verde'">
                  🟢 OPERATIVO
                </label>
                <label style="flex: 1; text-align: center;">
                  <input type="radio" name="estado" value="amarillo" onclick="document.getElementById('nuevo_estado').value='amarillo'">
                  🟡 ATENCIÓN
                </label>
                <label style="flex: 1; text-align: center;">
                  <input type="radio" name="estado" value="rojo" onclick="document.getElementById('nuevo_estado').value='rojo'">
                  🔴 CRÍTICO
                </label>
              </div>
              <input type="hidden" id="nuevo_estado" value="">
              <p style="font-size: 0.85em; color: #666; margin-top: 10px;">
                <strong>Nota:</strong> El estado queda guardado hasta que lo cambies de nuevo
              </p>
            </div>
            
            <div style="margin-bottom: 20px;">
              <label>📝 Observaciones:</label>
              <textarea id="observaciones" rows="2" placeholder="Detalles, lecturas exactas, fallas encontradas..."></textarea>
            </div>
            
            <button type="submit" class="btn">✅ Guardar Actividad</button>
            <button type="button" onclick="exportarExcel()" class="btn btn-descargar">📥 Exportar Hoy a Excel</button>
            <button type="button" onclick="forzarActualizacion()" class="btn" style="background: #7f8c8d;">🔄 Actualizar Ahora</button>
          </form>
        </div>
        
        <!-- ACTIVIDADES DE HOY -->
        <div class="form-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="color: #2c3e50;">📋 Actividades de hoy</h2>
            <div style="font-size: 0.9em; color: #666;">
              <span id="contadorActividades">0 actividades</span>
              <span id="totalConsumos" style="margin-left: 15px;"></span>
              <div id="ultimaActualizacion" style="font-size: 0.8em; color: #999; margin-top: 5px;"></div>
            </div>
          </div>
          
          <div id="listaActividades">
            <p style="text-align: center; color: #7f8c8d; padding: 20px;">
              Cargando actividades...
            </p>
          </div>
        </div>
      </div>
      
      <!-- MODAL PARA EDITAR -->
      <div id="modalEditar" class="modal">
        <div class="modal-content">
          <div class="modal-header">
            <h2 style="color: #2c3e50; margin: 0;">✏️ Editar Actividad</h2>
            <button onclick="cerrarModal()" class="close-modal">✕ Cerrar</button>
          </div>
          
          <form id="formEditar">
            <input type="hidden" id="editar_id">
            
            <div style="margin-bottom: 15px;">
              <label>📍 Ubicación:</label>
              <input type="text" id="editar_ubicacion" required>
            </div>
            
            <div style="margin-bottom: 15px;">
              <label>🔧 Actividad:</label>
              <textarea id="editar_actividad" rows="3" required></textarea>
            </div>
            
            <div class="consumo-row">
              <div>
                <div class="consumo-label">💧 Agua (m³):</div>
                <input type="number" id="editar_agua" step="0.001" class="consumo-input">
              </div>
              
              <div>
                <div class="consumo-label">🔌 Energy Consumed (+):</div>
                <input type="number" id="editar_consumo" step="0.1" class="consumo-input">
              </div>
              
              <div>
                <div class="consumo-label">↩️ Energy Returned (-):</div>
                <input type="number" id="editar_paneles" step="0.1" class="consumo-input">
              </div>
            </div>
            
            <div style="margin-bottom: 15px;">
              <label>📝 Observaciones:</label>
              <textarea id="editar_observaciones" rows="2"></textarea>
            </div>
            
            <div style="text-align: right; margin-top: 20px;">
              <button type="button" onclick="cerrarModal()" class="btn" style="background: #95a5a6;">Cancelar</button>
              <button type="submit" class="btn">💾 Guardar Cambios</button>
            </div>
          </form>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        const hoy = "${getFechaHoy().fecha}";
        let ultimaActualizacion = null;
        
        // Mostrar selector de estado cuando se selecciona equipo
        document.getElementById('equipo_critico').addEventListener('change', function() {
          const selector = document.getElementById('selectorEstado');
          if (this.value) {
            selector.style.display = 'block';
          } else {
            selector.style.display = 'none';
            document.getElementById('nuevo_estado').value = '';
          }
        });
        
        // Cargar actividades al iniciar
        cargarActividades();
        
        // FUNCIÓN PARA FORZAR ACTUALIZACIÓN
        function forzarActualizacion() {
          console.log('🔄 Forzando actualización...');
          cargarActividades();
        }
        
        // FORMULARIO NUEVO
        document.getElementById('formActividad').addEventListener('submit', async (e) => {
          e.preventDefault();
          
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
          
          console.log('📤 Enviando actividad:', actividad);
          
          try {
            const response = await fetch(API_URL + '/api/actividad', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(actividad)
            });
            
            const data = await response.json();
            console.log('📥 Respuesta:', data);
            
            if (data.success) {
              alert('✅ ' + data.message);
              document.getElementById('formActividad').reset();
              document.getElementById('selectorEstado').style.display = 'none';
              document.getElementById('nuevo_estado').value = '';
              
              // Actualizar inmediatamente
              setTimeout(() => {
                cargarActividades();
              }, 500);
            }
          } catch (error) {
            console.error('❌ Error:', error);
            alert('❌ Error de conexión');
          }
        });
        
        // FUNCIONES PARA EDITAR/BORRAR
        
        function mostrarModalEditar(id) {
          cargarActividadParaEditar(id);
          document.getElementById('modalEditar').style.display = 'flex';
        }
        
        function cerrarModal() {
          document.getElementById('modalEditar').style.display = 'none';
        }
        
        async function cargarActividadParaEditar(id) {
          try {
            const response = await fetch(API_URL + '/api/actividad/' + id);
            const actividad = await response.json();
            
            document.getElementById('editar_id').value = actividad.id;
            document.getElementById('editar_ubicacion').value = actividad.ubicacion;
            document.getElementById('editar_actividad').value = actividad.actividad;
            document.getElementById('editar_agua').value = actividad.agua_m3 || '';
            document.getElementById('editar_consumo').value = actividad.energia_consumida || '';
            document.getElementById('editar_paneles').value = actividad.paneles_kwh || '';
            document.getElementById('editar_observaciones').value = actividad.observaciones || '';
            
          } catch (error) {
            alert('Error cargando actividad para editar');
          }
        }
        
        // FORMULARIO EDITAR
        document.getElementById('formEditar').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const id = document.getElementById('editar_id').value;
          const actividad = {
            ubicacion: document.getElementById('editar_ubicacion').value,
            actividad: document.getElementById('editar_actividad').value,
            tipo_actividad: 'editado',
            agua_m3: document.getElementById('editar_agua').value || null,
            energia_consumida: document.getElementById('editar_consumo').value || null,
            paneles_kwh: document.getElementById('editar_paneles').value || null,
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
              cerrarModal();
              cargarActividades();
            }
          } catch (error) {
            alert('Error actualizando actividad');
          }
        });
        
        // ELIMINAR ACTIVIDAD
        async function eliminarActividad(id) {
          if (!confirm('¿Seguro que quieres ELIMINAR esta actividad?\n\nEsta acción no se puede deshacer.')) {
            return;
          }
          
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
        
        // CARGAR ACTIVIDADES (MEJORADO CON ACTUALIZACIÓN EN TIEMPO REAL)
        async function cargarActividades() {
          console.log('🔄 Cargando actividades...');
          
          try {
            const response = await fetch(API_URL + '/api/actividades/hoy');
            
            if (!response.ok) {
              throw new Error(\`HTTP error! status: \${response.status}\`);
            }
            
            const actividades = await response.json();
            console.log(\`📦 \${actividades.length} actividades recibidas\`);
            
            const lista = document.getElementById('listaActividades');
            const contador = document.getElementById('contadorActividades');
            const ultimaActualizacionElem = document.getElementById('ultimaActualizacion');
            
            contador.textContent = \`\${actividades.length} actividades\`;
            
            // Actualizar timestamp
            ultimaActualizacion = new Date();
            ultimaActualizacionElem.textContent = \`Última actualización: \${ultimaActualizacion.toLocaleTimeString()}\`;
            
            if (actividades.length === 0) {
              lista.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px;">No hay actividades registradas hoy</p>';
              document.getElementById('totalConsumos').innerHTML = '';
              return;
            }
            
            // Calcular totales
            let totalAgua = 0, totalConsumo = 0, totalPaneles = 0;
            
            lista.innerHTML = actividades.map(a => {
              // Sumar consumos
              if (a.agua_m3) totalAgua += parseFloat(a.agua_m3);
              if (a.energia_consumida) totalConsumo += parseFloat(a.energia_consumida);
              if (a.paneles_kwh) totalPaneles += parseFloat(a.paneles_kwh);
              
              // Usar hora guardada en la base de datos
              const hora = a.hora || '--:--';
              
              // Determinar clase CSS
              let clase = 'actividad-item';
              if (a.agua_m3 || a.energia_consumida || a.paneles_kwh) {
                clase += ' con-consumo';
              }
              if (a.nuevo_estado === 'rojo') clase += ' critico';
              
              // Crear badges de consumo
              let badges = '';
              if (a.agua_m3) badges += \`<span class="consumo-badge">💧 \${parseFloat(a.agua_m3).toFixed(3)} m³</span>\`;
              if (a.energia_consumida) badges += \`<span class="consumo-badge">🔌 +\${parseFloat(a.energia_consumida).toFixed(1)} kWh</span>\`;
              if (a.paneles_kwh) badges += \`<span class="consumo-badge">↩️ -\${parseFloat(a.paneles_kwh).toFixed(1)} kWh</span>\`;
              
              // Badge de estado
              let estadoBadge = '';
              if (a.nuevo_estado === 'verde') {
                estadoBadge = '<span class="estado-badge badge-verde">🟢 OPERATIVO</span>';
              } else if (a.nuevo_estado === 'amarillo') {
                estadoBadge = '<span class="estado-badge badge-amarillo">🟡 ATENCIÓN</span>';
              } else if (a.nuevo_estado === 'rojo') {
                estadoBadge = '<span class="estado-badge badge-rojo">🔴 CRÍTICO</span>';
              }
              
              return \`
                <div class="\${clase}">
                  <div class="acciones">
                    <button onclick="mostrarModalEditar(\${a.id})" class="btn-editar">✏️ Editar</button>
                    <button onclick="eliminarActividad(\${a.id})" class="btn-eliminar">🗑️ Eliminar</button>
                  </div>
                  <div>
                    <span style="background: #e9ecef; padding: 3px 8px; border-radius: 12px; font-size: 0.9em; color: #7f8c8d;">
                      ⏰ \${hora}
                    </span>
                    <strong>\${a.actividad}</strong>
                    \${a.equipo_critico ? '<span style="background: #fff3cd; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 10px;">' + a.equipo_critico + '</span>' : ''}
                    \${estadoBadge}
                  </div>
                  <div style="margin-top: 8px; color: #5a6268;">
                    📍 \${a.ubicacion} • \${a.tipo_actividad}
                    \${badges}
                  </div>
                  \${a.observaciones ? '<div style="margin-top: 8px; font-style: italic; color: #6c757d;">' + a.observaciones + '</div>' : ''}
                </div>
              \`;
            }).join('');
            
            // Mostrar resumen de consumos
            const resumenHTML = [];
            if (totalAgua > 0) resumenHTML.push(\`💧 \${totalAgua.toFixed(3)} m³\`);
            if (totalConsumo > 0) resumenHTML.push(\`🔌 +\${totalConsumo.toFixed(1)} kWh\`);
            if (totalPaneles > 0) resumenHTML.push(\`↩️ -\${totalPaneles.toFixed(1)} kWh\`);
            
            if (resumenHTML.length > 0) {
              document.getElementById('totalConsumos').innerHTML = resumenHTML.join(' • ');
            }
            
          } catch (error) {
            console.error('❌ Error cargando actividades:', error);
            document.getElementById('listaActividades').innerHTML = 
              '<p style="color: #e74c3c; text-align: center; padding: 20px;">' +
              '❌ Error cargando actividades<br>' +
              '<small>Ver consola para detalles</small>' +
              '</p>';
          }
        }
        
        // Exportar a Excel
        function exportarExcel() {
          window.open(API_URL + '/api/exportar/excel/' + hoy, '_blank');
        }
        
        // Auto-refresh cada 30 segundos (TIEMPO REAL)
        setInterval(cargarActividades, 30000);
        
        // Forzar carga inicial después de 1 segundo
        setTimeout(cargarActividades, 1000);
      </script>
    </body>
    </html>
  `);
});

// ==================== DASHBOARD GERENCIA CORREGIDO ====================

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
        
        .consumo-dashboard {
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
        
        .consumo-icon {
          font-size: 2.5em;
          margin-bottom: 15px;
        }
        
        .consumo-valor {
          font-size: 2.2em;
          font-weight: bold;
          margin: 10px 0;
        }
        
        .consumo-unidad {
          color: #666;
          font-size: 0.9em;
        }
        
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
          text-decoration: none;
        }
        
        .btn:hover { background: #1c6ea4; }
        .btn-descargar { background: #27ae60; }
        .btn-descargar:hover { background: #219653; }
        
        .actividad-item {
          padding: 15px;
          border-bottom: 1px solid #eee;
          display: flex;
          justify-content: space-between;
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
        
        .balance-positivo { color: #e74c3c; }
        .balance-negativo { color: #27ae60; }
        
        .hora-actividad {
          font-size: 0.85em;
          color: #7f8c8d;
          margin-left: 10px;
        }
        
        .auto-refresh-info {
          background: #e8f4fd;
          padding: 10px;
          border-radius: 8px;
          margin: 10px 0;
          font-size: 0.9em;
          color: #1a73e8;
          text-align: center;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🏢 Dashboard Gerencia - Torre K</h1>
          <p>${fechaLegible}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            Monitoreo de sistemas críticos y consumos diarios
          </p>
          <div class="auto-refresh-info">
            🔄 Se actualiza automáticamente cada 30 segundos • Última actualización: <span id="ultimaActualizacion">--:--:--</span>
          </div>
          <div style="margin-top: 20px;">
            <button onclick="cargarDashboard()" class="btn">🔄 Actualizar Ahora</button>
            <button onclick="exportarExcel()" class="btn btn-descargar">📥 Exportar Hoy a Excel</button>
          </div>
        </div>
        
        <!-- PANEL DE CONSUMOS -->
        <h2 style="color: #2c3e50; margin-bottom: 15px;">📊 Consumos del Día</h2>
        <div class="consumo-dashboard">
          <div class="consumo-card">
            <div class="consumo-icon">💧</div>
            <div class="consumo-valor" id="totalAgua">0.000</div>
            <div class="consumo-unidad">metros cúbicos (m³)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              Consumo de agua
            </div>
          </div>
          
          <div class="consumo-card">
            <div class="consumo-icon">🔌</div>
            <div class="consumo-valor" id="totalConsumo">0.0</div>
            <div class="consumo-unidad">kilowatt-hora (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              Energy Consumed (+)
            </div>
          </div>
          
          <div class="consumo-card">
            <div class="consumo-icon">↩️</div>
            <div class="consumo-valor" id="totalPaneles">0.0</div>
            <div class="consumo-unidad">kilowatt-hora (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              Energy Returned (-)
            </div>
          </div>
          
          <div class="consumo-card">
            <div class="consumo-icon">⚖️</div>
            <div class="consumo-valor" id="balanceEnergia">0.0</div>
            <div class="consumo-unidad">kilowatt-hora (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              <span id="balanceTexto">Neto CFE</span>
            </div>
          </div>
        </div>
        
        <!-- SEMÁFORO DE SISTEMAS (CON PANELES SOLARES) -->
        <h2 style="color: #2c3e50; margin: 30px 0 15px 0;">🚦 Estado de Sistemas Críticos</h2>
        <div class="semaforo-grid" id="semaforoGrid">
          <p>Cargando sistemas...</p>
        </div>
        
        <!-- ACTIVIDADES RECIENTES -->
        <div style="background: white; padding: 25px; border-radius: 10px; margin-top: 30px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="color: #2c3e50;">📝 Actividades Recientes</h2>
            <div id="contadorSistemas" style="color: #666; font-size: 0.9em;">
              <span id="contadorVerdes">0</span>🟢 • 
              <span id="contadorAmarillos">0</span>🟡 • 
              <span id="contadorRojos">0</span>🔴
            </div>
          </div>
          
          <div id="actividadesRecientes">
            <p>Cargando actividades...</p>
          </div>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        
        cargarDashboard();
        
        async function cargarDashboard() {
          console.log('🔄 Cargando dashboard...');
          
          try {
            const response = await fetch(API_URL + '/api/dashboard/gerencia');
            
            if (!response.ok) {
              throw new Error(\`HTTP error! status: \${response.status}\`);
            }
            
            const data = await response.json();
            console.log(\`📊 Dashboard cargado: \${data.actividades_hoy.length} actividades\`);
            
            // Actualizar timestamp
            document.getElementById('ultimaActualizacion').textContent = new Date().toLocaleTimeString();
            
            // Actualizar consumos
            document.getElementById('totalAgua').textContent = data.consumos_dia.agua_m3.toFixed(3);
            document.getElementById('totalConsumo').textContent = data.consumos_dia.energia_consumida.toFixed(1);
            document.getElementById('totalPaneles').textContent = data.consumos_dia.paneles_kwh.toFixed(1);
            
            const balance = data.consumos_dia.energia_neta;
            const balanceElem = document.getElementById('balanceEnergia');
            const balanceTexto = document.getElementById('balanceTexto');
            
            balanceElem.textContent = Math.abs(balance).toFixed(1);
            if (balance > 0) {
              balanceElem.className = 'consumo-valor balance-positivo';
              balanceTexto.innerHTML = '<span style="color: #e74c3c;">CONSUMO NETO</span>';
            } else {
              balanceElem.className = 'consumo-valor balance-negativo';
              balanceTexto.innerHTML = '<span style="color: #27ae60;">DEVOLUCIÓN NETO</span>';
            }
            
            // Actualizar semáforo (CON PANELES SOLARES)
            const semaforoGrid = document.getElementById('semaforoGrid');
            semaforoGrid.innerHTML = data.equipos_criticos.map(e => {
              let icono = '🟢';
              if (e.estado === 'amarillo') icono = '🟡';
              if (e.estado === 'rojo') icono = '🔴';
              
              return \`
                <div class="sistema-card \${e.estado}">
                  <div style="font-size: 2em; margin-bottom: 10px;">
                    \${icono}
                  </div>
                  <h3 style="margin: 0 0 10px 0;">\${e.equipo}</h3>
                  <div style="color: #666; font-size: 0.9em; margin-bottom: 10px;">
                    \${e.ultimo_cambio ? 'Último cambio: ' + e.ultimo_cambio : 'Sin cambios'}
                  </div>
                  <span class="badge badge-\${e.estado}">
                    \${e.estado === 'verde' ? 'OPERATIVO' : e.estado === 'amarillo' ? 'ATENCIÓN' : 'CRÍTICO'}
                  </span>
                </div>
              \`;
            }).join('');
            
            // Actualizar contadores
            document.getElementById('contadorVerdes').textContent = data.semaforo.verdes;
            document.getElementById('contadorAmarillos').textContent = data.semaforo.amarillos;
            document.getElementById('contadorRojos').textContent = data.semaforo.rojos;
            
            // Mostrar actividades (CON HORA)
            const actividadesDiv = document.getElementById('actividadesRecientes');
            if (data.actividades_hoy.length === 0) {
              actividadesDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No hay actividades hoy</p>';
            } else {
              actividadesDiv.innerHTML = data.actividades_hoy.map(a => {
                let consumos = '';
                if (a.agua_m3) consumos += \`💧 \${a.agua_m3} m³ \`;
                if (a.energia_consumida) consumos += \`🔌 +\${a.energia_consumida} kWh \`;
                if (a.paneles_kwh) consumos += \`↩️ -\${a.paneles_kwh} kWh \`;
                
                let estadoBadge = '';
                if (a.nuevo_estado === 'verde') {
                  estadoBadge = '<span class="badge badge-verde">🟢</span>';
                } else if (a.nuevo_estado === 'amarillo') {
                  estadoBadge = '<span class="badge badge-amarillo">🟡</span>';
                } else if (a.nuevo_estado === 'rojo') {
                  estadoBadge = '<span class="badge badge-rojo">🔴</span>';
                }
                
                return \`
                  <div class="actividad-item">
                    <div style="flex: 1;">
                      <div>
                        <strong>\${a.actividad}</strong>
                        <span class="hora-actividad">⏰ \${a.hora || '--:--'}</span>
                        \${estadoBadge}
                      </div>
                      <div style="color: #666; font-size: 0.9em; margin-top: 5px;">
                        📍 \${a.ubicacion} • \${a.tipo_actividad}
                        \${consumos ? '• ' + consumos : ''}
                      </div>
                      \${a.observaciones ? '<div style="color: #666; font-size: 0.9em; margin-top: 5px; font-style: italic;">' + a.observaciones + '</div>' : ''}
                    </div>
                    <div style="color: #999; font-size: 0.9em; min-width: 120px; text-align: right;">
                      \${a.equipo_critico || 'General'}
                    </div>
                  </div>
                \`;
              }).join('');
            }
            
          } catch (error) {
            console.error('❌ Error cargando dashboard:', error);
            document.getElementById('actividadesRecientes').innerHTML = 
              '<p style="color: #e74c3c; text-align: center; padding: 20px;">' +
              '❌ Error cargando dashboard<br>' +
              '<small>Ver consola para detalles</small>' +
              '</p>';
          }
        }
        
        function exportarExcel() {
          const hoy = "${getFechaHoy().fecha}";
          window.open(API_URL + '/api/exportar/excel/' + hoy, '_blank');
        }
        
        // Auto-refresh cada 30 segundos (TIEMPO REAL)
        setInterval(cargarDashboard, 30000);
        
        // Forzar carga inicial
        setTimeout(cargarDashboard, 1000);
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
        
        .info-box {
          margin: 30px 0;
          padding: 20px;
          background: #e8f4fd;
          border-radius: 10px;
          text-align: left;
        }
        
        .info-box ul {
          margin: 10px 0;
          padding-left: 20px;
        }
        
        .rule {
          margin: 20px 0;
          padding: 15px;
          background: #d5f4e6;
          border-radius: 10px;
          border-left: 4px solid #27ae60;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏢 Torre K Maintenance</h1>
        <div class="fecha">${fechaLegible}</div>
        
        <div class="rule">
          <strong>✅ SISTEMA CORREGIDO:</strong><br>
          1. ⏰ Hora automática (se guarda en BD)<br>
          2. ☀️ Paneles solares en sistemas críticos<br>
          3. 🔄 Actualización en tiempo real (30s)<br>
          4. ✏️ Editar/🗑️ eliminar actividades
        </div>
        
        <a href="/tecnico" class="card tecnico">
          <h2>👷 Bitácora Técnica</h2>
          <p>Acceso completo (editar/eliminar)</p>
          <ul>
            <li>✏️ Editar y 🗑️ eliminar actividades</li>
            <li>💧 Agua + 🔌 CFE (Consumed/Returned)</li>
            <li>☀️ Paneles solares incluidos</li>
            <li>🔄 Actualización automática</li>
          </ul>
        </a>
        
        <a href="/gerencia" class="card gerencia">
          <h2>👔 Dashboard Gerencia</h2>
          <p>Monitoreo en tiempo real (solo lectura)</p>
          <ul>
            <li>💧 Agua + 🔌 CFE (Consumed/Returned)</li>
            <li>☀️ Paneles solares incluidos</li>
            <li>🚦 Semáforo de sistemas</li>
            <li>🔄 Actualización automática</li>
          </ul>
        </a>
        
        <div class="info-box">
          <strong>🔧 Problemas solucionados:</strong>
          <ol>
            <li><strong>Corregido:</strong> Paneles solares ahora aparecen en sistemas críticos</li>
            <li><strong>Corregido:</strong> Hora se guarda y muestra correctamente</li>
            <li><strong>Agregado:</strong> Actualización automática cada 30 segundos</li>
            <li><strong>Agregado:</strong> Timestamp de última actualización</li>
            <li><strong>Mantenido:</strong> Tu interfaz favorita ✨</li>
          </ol>
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
  console.log(`👷 Técnico (EDITAR/BORRAR): http://localhost:${PORT}/tecnico`);
  console.log(`👔 Gerencia (SOLO LECTURA): http://localhost:${PORT}/gerencia`);
  console.log(`🔄 Actualización automática cada 30 segundos`);
  console.log(`☀️ Paneles solares incluidos en sistemas críticos`);
  console.log(`=========================================\n`);
});
