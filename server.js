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
  // Tabla principal de actividades (HISTORIAL PERMANENTE)
  db.run(`
    CREATE TABLE IF NOT EXISTS actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,        -- YYYY-MM-DD
      hora TEXT NOT NULL,         -- HH:MM
      ubicacion TEXT NOT NULL,
      actividad TEXT NOT NULL,
      tipo_actividad TEXT,
      
      -- CONSUMOS (para reportes)
      agua_m3 REAL,               -- metros cúbicos de agua
      energia_kwh REAL,           -- kWh consumidos de CFE
      paneles_kwh REAL,           -- kWh generados por paneles
      
      -- Sistemas críticos
      equipo_critico TEXT,
      nuevo_estado TEXT,          -- verde/amarillo/rojo
      
      observaciones TEXT,
      tecnico TEXT DEFAULT 'Técnico Torre K',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de ESTADOS ACTUALES de equipos
  db.run(`
    CREATE TABLE IF NOT EXISTS estados_equipos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipo TEXT UNIQUE NOT NULL,
      estado TEXT DEFAULT 'verde',
      ultimo_cambio TEXT,         -- fecha del último cambio
      observaciones TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insertar equipos críticos iniciales
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

// ==================== FUNCIONES DE FECHA ====================
function getFechaHoy() {
  const hoy = new Date();
  // AJUSTAR: Restar 1 día si estamos probando en año nuevo
  // const offset = -1; // Para prueba
  const offset = 0; // Para producción
  
  hoy.setDate(hoy.getDate() + offset);
  
  const fecha = hoy.toISOString().split('T')[0]; // YYYY-MM-DD
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

// ==================== ENDPOINTS ====================

// 1. REGISTRAR ACTIVIDAD
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
    energia_kwh,
    paneles_kwh,
    observaciones = ''
  } = req.body;

  if (!ubicacion || !actividad) {
    return res.status(400).json({ error: 'Ubicación y actividad son requeridas' });
  }

  db.run(`
    INSERT INTO actividades 
    (fecha, hora, ubicacion, actividad, tipo_actividad, equipo_critico, nuevo_estado, agua_m3, energia_kwh, paneles_kwh, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [fecha, hora, ubicacion, actividad, tipo_actividad, equipo_critico, nuevo_estado, 
     agua_m3 || null, energia_kwh || null, paneles_kwh || null, observaciones],
    function(err) {
      if (err) {
        console.error('Error:', err);
        return res.status(500).json({ error: err.message });
      }

      // ACTUALIZAR ESTADO DEL EQUIPO si se especificó
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
                (equipo_critico ? ` y estado de ${equipo_critico} actualizado` : ''),
        fecha_guardada: fecha
      });
    }
  );
});

// 2. OBTENER ACTIVIDADES DEL DÍA (con consumos)
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

// 3. OBTENER ACTIVIDADES POR FECHA ESPECÍFICA
app.get('/api/actividades/fecha/:fecha', (req, res) => {
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

// 4. DASHBOARD GERENCIA CON CONSUMOS
app.get('/api/dashboard/gerencia', (req, res) => {
  const { fecha, fechaLegible } = getFechaHoy();
  
  // 1. Obtener estados actuales de equipos
  db.all(
    `SELECT * FROM estados_equipos ORDER BY equipo`,
    [],
    (err, equipos) => {
      if (err) return res.status(500).json({ error: err.message });

      // 2. Obtener CONSUMOS DEL DÍA
      db.get(
        `SELECT 
           SUM(COALESCE(agua_m3, 0)) as agua_total,
           SUM(COALESCE(energia_kwh, 0)) as cfe_total,
           SUM(COALESCE(paneles_kwh, 0)) as paneles_total
         FROM actividades 
         WHERE fecha = ?`,
        [fecha],
        (err, consumos) => {
          if (err) return res.status(500).json({ error: err.message });

          // 3. Obtener actividades de hoy (con consumos)
          db.all(
            `SELECT * FROM actividades 
             WHERE fecha = ? 
             ORDER BY hora DESC 
             LIMIT 15`,
            [fecha],
            (err, actividades) => {
              if (err) return res.status(500).json({ error: err.message });

              // 4. Calcular energía neta
              const energia_neta = (consumos.cfe_total || 0) - (consumos.paneles_total || 0);
              
              res.json({
                fecha: fecha,
                fecha_legible: fechaLegible,
                equipos_criticos: equipos,
                consumos_dia: {
                  agua_m3: consumos.agua_total || 0,
                  cfe_kwh: consumos.cfe_total || 0,
                  paneles_kwh: consumos.paneles_total || 0,
                  energia_neta: energia_neta,
                  balance: energia_neta > 0 ? 'CONSUMO' : 'GENERACIÓN'
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

// 5. EXPORTAR EXCEL POR DÍA (formato para pegar manualmente)
app.get('/api/exportar/excel/:fecha?', (req, res) => {
  const fechaExportar = req.params.fecha || getFechaHoy().fecha;
  
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha = ? 
     ORDER BY hora`,
    [fechaExportar],
    (err, actividades) => {
      if (err) return res.status(500).json({ error: err.message });

      // Crear CSV optimizado para Excel
      let csv = '';
      
      // ENCABEZADOS (primera fila)
      csv += 'Fecha,Hora,Ubicación,Actividad,Tipo,Equipo Crítico,Nuevo Estado,Agua (m³),CFE (kWh),Paneles (kWh),Observaciones,Técnico\n';
      
      // DATOS
      actividades.forEach(a => {
        csv += `"${a.fecha}","${a.hora}","${a.ubicacion}","${a.actividad}","${a.tipo_actividad}",`;
        csv += `"${a.equipo_critico || ''}","${a.nuevo_estado || ''}",`;
        csv += `"${a.agua_m3 || ''}","${a.energia_kwh || ''}","${a.paneles_kwh || ''}",`;
        csv += `"${(a.observaciones || '').replace(/"/g, '""')}","${a.tecnico}"\n`;
      });
      
      // RESUMEN DEL DÍA (filas adicionales)
      csv += '\n';
      csv += 'RESUMEN DEL DÍA,,,,\n';
      
      // Calcular totales
      const aguaTotal = actividades.reduce((sum, a) => sum + (a.agua_m3 || 0), 0);
      const cfeTotal = actividades.reduce((sum, a) => sum + (a.energia_kwh || 0), 0);
      const panelesTotal = actividades.reduce((sum, a) => sum + (a.paneles_kwh || 0), 0);
      const energiaNeta = cfeTotal - panelesTotal;
      
      csv += `Total Agua: ${aguaTotal.toFixed(2)} m³\n`;
      csv += `Total CFE: ${cfeTotal.toFixed(2)} kWh\n`;
      csv += `Total Paneles: ${panelesTotal.toFixed(2)} kWh\n`;
      csv += `Energía Neta: ${energiaNeta.toFixed(2)} kWh (${energiaNeta > 0 ? 'CONSUMO' : 'GENERACIÓN'})\n`;
      csv += `Total Actividades: ${actividades.length}\n`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="torre_k_${fechaExportar}.csv"`);
      res.send(csv);
    }
  );
});

// 6. VER HISTORIAL POR EQUIPO
app.get('/api/historial/equipo/:equipo', (req, res) => {
  db.all(
    `SELECT fecha, hora, actividad, nuevo_estado, observaciones, tecnico
     FROM actividades 
     WHERE equipo_critico = ?
     ORDER BY fecha DESC, hora DESC
     LIMIT 30`,
    [req.params.equipo],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// ==================== INTERFACES HTML ====================

// INTERFAZ TÉCNICO (con campos de consumo)
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
        
        .actividad-item {
          padding: 15px;
          border-left: 4px solid #27ae60;
          margin-bottom: 10px;
          background: #f8f9fa;
          border-radius: 6px;
        }
        
        .actividad-item.con-consumo { border-left-color: #2196f3; }
        .actividad-item.critico { border-left-color: #e74c3c; }
        
        .consumo-badge {
          display: inline-block;
          background: #e3f2fd;
          color: #1565c0;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 0.85em;
          margin-left: 8px;
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
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🔧 Bitácora Técnico - Torre K</h1>
          <p>${fechaLegible}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            <strong>📋 Registro diario • Historial permanente • Exportar a Excel</strong>
          </p>
        </div>
        
        <!-- FORMULARIO PRINCIPAL -->
        <div class="form-section">
          <h2 style="margin-bottom: 20px; color: #2c3e50;">➕ Nueva Actividad</h2>
          
          <form id="formActividad">
            <div class="form-row">
              <div>
                <label>📍 Ubicación:</label>
                <input type="text" id="ubicacion" placeholder="Ej: Planta Baja, Azotea, Sótano..." required>
              </div>
              <div>
                <label>🕒 Hora:</label>
                <input type="time" id="hora" value="${horaActual}" required>
              </div>
            </div>
            
            <div style="margin-bottom: 20px;">
              <label>🔧 Actividad realizada:</label>
              <textarea id="actividad" rows="3" placeholder="Ej: Lectura de medidores, revisión de paneles, reparación..." required></textarea>
            </div>
            
            <div class="form-row">
              <div>
                <label>📋 Tipo de actividad:</label>
                <select id="tipo_actividad">
                  <option value="lectura">📖 Lectura de Medidores</option>
                  <option value="electricidad">⚡ Electricidad</option>
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
                  <option value="Paneles Solares">☀️ Paneles Solares</option>
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
                <div class="consumo-label">⚡ CFE consumida:</div>
                <input type="number" id="energia_kwh" step="0.1" class="consumo-input" placeholder="kWh">
                <small style="color: #666;">kilowatt-hora</small>
              </div>
              
              <div>
                <div class="consumo-label">☀️ Paneles generados:</div>
                <input type="number" id="paneles_kwh" step="0.1" class="consumo-input" placeholder="kWh">
                <small style="color: #666;">kilowatt-hora</small>
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
          </form>
        </div>
        
        <!-- ACTIVIDADES DE HOY -->
        <div class="form-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="color: #2c3e50;">📋 Actividades de hoy</h2>
            <div style="font-size: 0.9em; color: #666;">
              <span id="contadorActividades">0 actividades</span>
              <span id="totalConsumos" style="margin-left: 15px;"></span>
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
        const hoy = "${getFechaHoy().fecha}";
        
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
        
        // Formulario
        document.getElementById('formActividad').addEventListener('submit', async (e) => {
          e.preventDefault();
          
          const actividad = {
            ubicacion: document.getElementById('ubicacion').value,
            hora: document.getElementById('hora').value,
            actividad: document.getElementById('actividad').value,
            tipo_actividad: document.getElementById('tipo_actividad').value,
            equipo_critico: document.getElementById('equipo_critico').value,
            nuevo_estado: document.getElementById('nuevo_estado').value,
            agua_m3: document.getElementById('agua_m3').value || null,
            energia_kwh: document.getElementById('energia_kwh').value || null,
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
              alert('✅ ' + data.message);
              document.getElementById('formActividad').reset();
              document.getElementById('selectorEstado').style.display = 'none';
              document.getElementById('hora').value = "${horaActual}";
              document.getElementById('nuevo_estado').value = '';
              cargarActividades();
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
            const contador = document.getElementById('contadorActividades');
            
            contador.textContent = \`\${actividades.length} actividades\`;
            
            if (actividades.length === 0) {
              lista.innerHTML = '<p style="text-align: center; color: #7f8c8d; padding: 40px;">No hay actividades registradas hoy</p>';
              document.getElementById('totalConsumos').innerHTML = '';
              return;
            }
            
            // Calcular totales
            let totalAgua = 0, totalCFE = 0, totalPaneles = 0;
            
            lista.innerHTML = actividades.map(a => {
              // Sumar consumos
              if (a.agua_m3) totalAgua += a.agua_m3;
              if (a.energia_kwh) totalCFE += a.energia_kwh;
              if (a.paneles_kwh) totalPaneles += a.paneles_kwh;
              
              // Determinar clase CSS
              let clase = 'actividad-item';
              if (a.agua_m3 || a.energia_kwh || a.paneles_kwh) clase += ' con-consumo';
              if (a.nuevo_estado === 'rojo') clase += ' critico';
              
              // Crear badges de consumo
              let badges = '';
              if (a.agua_m3) badges += \`<span class="consumo-badge">💧 \${a.agua_m3} m³</span>\`;
              if (a.energia_kwh) badges += \`<span class="consumo-badge">⚡ \${a.energia_kwh} kWh</span>\`;
              if (a.paneles_kwh) badges += \`<span class="consumo-badge">☀️ \${a.paneles_kwh} kWh</span>\`;
              
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
                    \${badges}
                  </div>
                  \${a.observaciones ? '<div style="margin-top: 8px; font-style: italic; color: #6c757d;">' + a.observaciones + '</div>' : ''}
                </div>
              \`;
            }).join('');
            
            // Mostrar resumen de consumos
            const resumenHTML = [];
            if (totalAgua > 0) resumenHTML.push(\`💧 \${totalAgua.toFixed(3)} m³\`);
            if (totalCFE > 0) resumenHTML.push(\`⚡ \${totalCFE.toFixed(1)} kWh\`);
            if (totalPaneles > 0) resumenHTML.push(\`☀️ \${totalPaneles.toFixed(1)} kWh\`);
            
            if (resumenHTML.length > 0) {
              document.getElementById('totalConsumos').innerHTML = resumenHTML.join(' • ');
            }
            
          } catch (error) {
            console.error('Error cargando actividades:', error);
            document.getElementById('listaActividades').innerHTML = 
              '<p style="color: #e74c3c; text-align: center;">Error cargando actividades</p>';
          }
        }
        
        // Exportar a Excel
        function exportarExcel() {
          window.open(API_URL + '/api/exportar/excel/' + hoy, '_blank');
        }
        
        // Auto-refresh
        setInterval(cargarActividades, 120000);
      </script>
    </body>
    </html>
  `);
});

// DASHBOARD GERENCIA CON CONSUMOS
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
          <div style="margin-top: 20px;">
            <button onclick="cargarDashboard()" class="btn">🔄 Actualizar</button>
            <button onclick="exportarExcel()" class="btn btn-descargar">📥 Exportar Hoy a Excel</button>
            <a href="/tecnico" target="_blank" class="btn">👷 Ver Bitácora Técnica</a>
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
            <div class="consumo-icon">⚡</div>
            <div class="consumo-valor" id="totalCFE">0.0</div>
            <div class="consumo-unidad">kilowatt-hora (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              Consumo de CFE
            </div>
          </div>
          
          <div class="consumo-card">
            <div class="consumo-icon">☀️</div>
            <div class="consumo-valor" id="totalPaneles">0.0</div>
            <div class="consumo-unidad">kilowatt-hora (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              Generación paneles
            </div>
          </div>
          
          <div class="consumo-card">
            <div class="consumo-icon">⚖️</div>
            <div class="consumo-valor" id="balanceEnergia">0.0</div>
            <div class="consumo-unidad">kilowatt-hora (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              <span id="balanceTexto">Balance energético</span>
            </div>
          </div>
        </div>
        
        <!-- SEMÁFORO DE SISTEMAS -->
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
          try {
            const response = await fetch(API_URL + '/api/dashboard/gerencia');
            const data = await response.json();
            
            // Actualizar consumos
            document.getElementById('totalAgua').textContent = data.consumos_dia.agua_m3.toFixed(3);
            document.getElementById('totalCFE').textContent = data.consumos_dia.cfe_kwh.toFixed(1);
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
              balanceTexto.innerHTML = '<span style="color: #27ae60;">GENERACIÓN NETO</span>';
            }
            
            // Actualizar semáforo
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
                    \${e.ultimo_cambio ? 'Último cambio: ' + e.ultimo_cambio.split(' ')[0] : 'Sin cambios'}
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
            
            // Mostrar actividades
            const actividadesDiv = document.getElementById('actividadesRecientes');
            if (data.actividades_hoy.length === 0) {
              actividadesDiv.innerHTML = '<p style="text-align: center; color: #666; padding: 20px;">No hay actividades hoy</p>';
            } else {
              actividadesDiv.innerHTML = data.actividades_hoy.map(a => {
                let consumos = '';
                if (a.agua_m3) consumos += \`💧 \${a.agua_m3} m³ \`;
                if (a.energia_kwh) consumos += \`⚡ \${a.energia_kwh} kWh \`;
                if (a.paneles_kwh) consumos += \`☀️ \${a.paneles_kwh} kWh\`;
                
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
                        \${estadoBadge}
                      </div>
                      <div style="color: #666; font-size: 0.9em; margin-top: 5px;">
                        📍 \${a.ubicacion} • \${a.hora}
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
            console.error('Error:', error);
            alert('Error cargando dashboard');
          }
        }
        
        function exportarExcel() {
          const hoy = "${getFechaHoy().fecha}";
          window.open(API_URL + '/api/exportar/excel/' + hoy, '_blank');
        }
        
        // Auto-refresh
        setInterval(cargarDashboard, 180000);
      </script>
    </body>
    </html>
  `);
});

// PÁGINA PRINCIPAL
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
          <strong>📋 Sistema simple y práctico:</strong><br>
          1. Técnico registra actividades y consumos<br>
          2. Estados se guardan hasta que los cambies<br>
          3. Exporta a Excel diario para tu historial
        </div>
        
        <a href="/tecnico" class="card tecnico">
          <h2>👷 Bitácora Técnica</h2>
          <p>Registro diario completo</p>
          <ul>
            <li>📝 Actividades con ubicación y hora</li>
            <li>💧⚡ Registro de consumos (agua, CFE, paneles)</li>
            <li>🚦 Cambio de estado de sistemas</li>
            <li>📥 Exportar a Excel con un clic</li>
          </ul>
        </a>
        
        <a href="/gerencia" class="card gerencia">
          <h2>👔 Dashboard Gerencia</h2>
          <p>Monitoreo en tiempo real</p>
          <ul>
            <li>📊 Consumos diarios de agua y energía</li>
            <li>🚦 Semáforo de todos los sistemas</li>
            <li>📝 Historial de actividades</li>
            <li>📥 Reportes listos para Excel</li>
          </ul>
        </a>
        
        <div class="info-box">
          <strong>💡 Flujo de trabajo recomendado:</strong>
          <ol>
            <li>Técnico registra actividades durante el día</li>
            <li>Al final del día, exporta a Excel</li>
            <li>Pega el Excel en tu hoja mensual</li>
            <li>Gerencia revisa dashboard en tiempo real</li>
          </ol>
          <p style="margin-top: 10px; font-size: 0.9em; color: #666;">
            <strong>Nota:</strong> Los datos se guardan permanentemente en la base de datos.
          </p>
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
  console.log(`=========================================\n`);
});
