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
  // Tabla principal con campos para optimización solar
  db.run(`
    CREATE TABLE IF NOT EXISTS actividades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL,
      hora TEXT NOT NULL,
      ubicacion TEXT NOT NULL,
      actividad TEXT NOT NULL,
      tipo_actividad TEXT,
      
      -- DATOS ELÉCTRICOS CRÍTICOS (Shelly)
      energia_total REAL,         -- Total Energy de paneles (kWh)
      energia_retornada REAL,     -- Total Returned a CFE (kWh)
      
      -- CÁLCULOS AUTOMÁTICOS (se pueden calcular o guardar)
      energia_autoconsumo REAL,   -- Energía Total - Retornada
      porcentaje_autoconsumo REAL, -- ((Total - Retornada) / Total) * 100
      porcentaje_retorno REAL,    -- (Retornada / Total) * 100
      optimizacion_solar REAL,    -- 1 - (Retornada / Total)
      estado_optimizacion TEXT,   -- 'verde', 'amarillo', 'rojo'
      
      -- OTROS CONSUMOS
      agua_m3 REAL,
      
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

  console.log('✅ Base de datos con optimización solar lista');
});

// ==================== FUNCIÓN DE FECHA CORREGIDA ====================
function getFechaHoy() {
  const hoy = new Date();
  // CORRECCIÓN: Si estamos en 1 enero, mostrar 31 diciembre del año anterior
  if (hoy.getMonth() === 0 && hoy.getDate() === 1) {
    hoy.setFullYear(hoy.getFullYear() - 1);
    hoy.setMonth(11);
    hoy.setDate(31);
  }
  
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

// ==================== FUNCIÓN PARA CALCULAR OPTIMIZACIÓN SOLAR ====================
function calcularOptimizacionSolar(total, retornada) {
  if (!total || total <= 0) return null;
  
  const autoconsumo = total - (retornada || 0);
  const porcentajeAutoconsumo = ((autoconsumo / total) * 100);
  const porcentajeRetorno = ((retornada || 0) / total) * 100;
  const optimizacion = 1 - ((retornada || 0) / total);
  
  // Determinar estado basado en porcentaje de autoconsumo
  let estado = 'rojo'; // Por defecto
  
  if (porcentajeAutoconsumo >= 75) {
    estado = 'verde'; // Bien optimizado (>75% autoconsumo)
  } else if (porcentajeAutoconsumo >= 60) {
    estado = 'amarillo'; // Aceptable (60-74%)
  } else if (porcentajeAutoconsumo >= 50) {
    estado = 'naranja'; // Regular (50-59%)
  }
  // <50% = rojo (ya está por defecto)
  
  return {
    autoconsumo_kwh: autoconsumo,
    porcentaje_autoconsumo: porcentajeAutoconsumo,
    porcentaje_retorno: porcentajeRetorno,
    optimizacion: optimizacion,
    estado: estado,
    interpretacion: obtenerInterpretacion(porcentajeAutoconsumo)
  };
}

function obtenerInterpretacion(porcentaje) {
  if (porcentaje >= 90) return 'EXCELENTE - Con baterías/cargas inteligentes';
  if (porcentaje >= 75) return 'BIEN - Sistema bien diseñado';
  if (porcentaje >= 60) return 'ACEPTABLE - Normal';
  if (porcentaje >= 50) return 'REGULAR - Se puede mejorar';
  return 'BAJO - Mal aprovechado';
}

// ==================== ENDPOINTS ====================

// 1. REGISTRAR ACTIVIDAD CON OPTIMIZACIÓN SOLAR
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
    energia_total,      // Total Energy de paneles
    energia_retornada,  // Total Returned a CFE
    observaciones = ''
  } = req.body;

  if (!ubicacion || !actividad) {
    return res.status(400).json({ error: 'Ubicación y actividad son requeridas' });
  }

  // Calcular optimización solar automáticamente
  const optimizacion = calcularOptimizacionSolar(
    parseFloat(energia_total) || 0,
    parseFloat(energia_retornada) || 0
  );

  db.run(`
    INSERT INTO actividades 
    (fecha, hora, ubicacion, actividad, tipo_actividad, equipo_critico, nuevo_estado, 
     agua_m3, energia_total, energia_retornada,
     energia_autoconsumo, porcentaje_autoconsumo, porcentaje_retorno, 
     optimizacion_solar, estado_optimizacion, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      fecha, hora, ubicacion, actividad, tipo_actividad, equipo_critico, nuevo_estado,
      agua_m3 || null, 
      energia_total || null, energia_retornada || null,
      optimizacion ? optimizacion.autoconsumo_kwh : null,
      optimizacion ? optimizacion.porcentaje_autoconsumo : null,
      optimizacion ? optimizacion.porcentaje_retorno : null,
      optimizacion ? optimizacion.optimizacion : null,
      optimizacion ? optimizacion.estado : null,
      observaciones
    ],
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

      const mensaje = '✅ Actividad registrada' + 
        (equipo_critico ? ` y estado de ${equipo_critico} actualizado` : '') +
        (optimizacion ? `\n⚡ Optimización Solar: ${optimizacion.porcentaje_autoconsumo.toFixed(1)}% (${optimizacion.estado.toUpperCase()})` : '');

      res.json({
        success: true,
        id: this.lastID,
        message: mensaje,
        fecha_guardada: fecha,
        optimizacion: optimizacion
      });
    }
  );
});

// 2. OBTENER ACTIVIDADES DEL DÍA
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

// 3. DASHBOARD GERENCIA CON OPTIMIZACIÓN SOLAR
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
           SUM(COALESCE(energia_total, 0)) as energia_total,
           SUM(COALESCE(energia_retornada, 0)) as retornada_total
         FROM actividades 
         WHERE fecha = ?`,
        [fecha],
        (err, consumos) => {
          if (err) return res.status(500).json({ error: err.message });

          // 3. Calcular optimización solar del día
          const optimizacionDia = calcularOptimizacionSolar(
            consumos.energia_total || 0,
            consumos.retornada_total || 0
          );

          // 4. Obtener actividades de hoy
          db.all(
            `SELECT * FROM actividades 
             WHERE fecha = ? 
             ORDER BY hora DESC 
             LIMIT 15`,
            [fecha],
            (err, actividades) => {
              if (err) return res.status(500).json({ error: err.message });

              res.json({
                fecha: fecha,
                fecha_legible: fechaLegible,
                equipos_criticos: equipos,
                consumos_dia: {
                  agua_m3: consumos.agua_total || 0,
                  energia_total: consumos.energia_total || 0,
                  energia_retornada: consumos.retornada_total || 0,
                  energia_autoconsumo: optimizacionDia ? optimizacionDia.autoconsumo_kwh : 0
                },
                optimizacion_solar: optimizacionDia,
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

// 4. REPORTE DIARIO DE OPTIMIZACIÓN SOLAR
app.get('/api/reporte/solar/:fecha?', (req, res) => {
  const fechaReporte = req.params.fecha || getFechaHoy().fecha;
  
  db.all(
    `SELECT 
       fecha,
       SUM(COALESCE(energia_total, 0)) as total,
       SUM(COALESCE(energia_retornada, 0)) as retornada,
       AVG(COALESCE(porcentaje_autoconsumo, 0)) as autoconsumo_promedio,
       AVG(COALESCE(optimizacion_solar, 0)) as optimizacion_promedio
     FROM actividades 
     WHERE fecha = ? AND energia_total > 0
     GROUP BY fecha`,
    [fechaReporte],
    (err, reporte) => {
      if (err) return res.status(500).json({ error: err.message });
      
      if (reporte.length > 0 && reporte[0].total > 0) {
        const optimizacion = calcularOptimizacionSolar(
          reporte[0].total,
          reporte[0].retornada
        );
        
        res.json({
          fecha: fechaReporte,
          ...reporte[0],
          ...optimizacion
        });
      } else {
        res.json({
          fecha: fechaReporte,
          total: 0,
          retornada: 0,
          autoconsumo_promedio: 0,
          optimizacion_promedio: 0,
          mensaje: 'No hay datos de energía solar para esta fecha'
        });
      }
    }
  );
});

// 5. EXPORTAR EXCEL CON OPTIMIZACIÓN SOLAR
app.get('/api/exportar/excel/:fecha?', (req, res) => {
  const fechaExportar = req.params.fecha || getFechaHoy().fecha;
  
  db.all(
    `SELECT * FROM actividades 
     WHERE fecha = ? 
     ORDER BY hora`,
    [fechaExportar],
    (err, actividades) => {
      if (err) return res.status(500).json({ error: err.message });

      // Calcular totales y optimización del día
      const aguaTotal = actividades.reduce((sum, a) => sum + (a.agua_m3 || 0), 0);
      const energiaTotal = actividades.reduce((sum, a) => sum + (a.energia_total || 0), 0);
      const retornadaTotal = actividades.reduce((sum, a) => sum + (a.energia_retornada || 0), 0);
      const optimizacionDia = calcularOptimizacionSolar(energiaTotal, retornadaTotal);

      let csv = 'Fecha,Hora,Ubicación,Actividad,Tipo,Equipo Crítico,Nuevo Estado,';
      csv += 'Agua (m³),Total Energy (kWh),Returned to CFE (kWh),Autoconsumo (kWh),Autoconsumo %,Return %,Optimización,Estado Solar,Observaciones,Técnico\n';
      
      actividades.forEach(a => {
        csv += `"${a.fecha}","${a.hora}","${a.ubicacion}","${a.actividad}","${a.tipo_actividad}",`;
        csv += `"${a.equipo_critico || ''}","${a.nuevo_estado || ''}",`;
        csv += `"${a.agua_m3 || ''}","${a.energia_total || ''}","${a.energia_retornada || ''}",`;
        csv += `"${a.energia_autoconsumo || ''}","${a.porcentaje_autoconsumo ? a.porcentaje_autoconsumo.toFixed(1) : ''}",`;
        csv += `"${a.porcentaje_retorno ? a.porcentaje_retorno.toFixed(1) : ''}",`;
        csv += `"${a.optimizacion_solar ? a.optimizacion_solar.toFixed(3) : ''}",`;
        csv += `"${a.estado_optimizacion || ''}","${(a.observaciones || '').replace(/"/g, '""')}","${a.tecnico}"\n`;
      });
      
      // RESUMEN DEL DÍA CON OPTIMIZACIÓN
      csv += '\n=== RESUMEN DEL DÍA ===\n';
      csv += `Total Agua: ${aguaTotal.toFixed(3)} m³\n`;
      csv += `Total Energy Generated: ${energiaTotal.toFixed(2)} kWh\n`;
      csv += `Total Returned to CFE: ${retornadaTotal.toFixed(2)} kWh\n`;
      csv += `Autoconsumo: ${optimizacionDia ? optimizacionDia.autoconsumo_kwh.toFixed(2) : 0} kWh\n`;
      csv += `Autoconsumo: ${optimizacionDia ? optimizacionDia.porcentaje_autoconsumo.toFixed(1) : 0}%\n`;
      csv += `Return to CFE: ${optimizacionDia ? optimizacionDia.porcentaje_retorno.toFixed(1) : 0}%\n`;
      csv += `Solar Optimization Index: ${optimizacionDia ? optimizacionDia.optimizacion.toFixed(3) : 0}\n`;
      csv += `Estado: ${optimizacionDia ? optimizacionDia.estado.toUpperCase() : 'SIN DATOS'}\n`;
      csv += `Interpretación: ${optimizacionDia ? optimizacionDia.interpretacion : 'Sin datos'}\n`;
      csv += `Total Actividades: ${actividades.length}\n`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="torre_k_solar_${fechaExportar}.csv"`);
      res.send(csv);
    }
  );
});

// ==================== INTERFAZ TÉCNICO CON OPTIMIZACIÓN SOLAR ====================

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
        
        .form-section {
          background: white;
          padding: 25px;
          border-radius: 10px;
          margin-bottom: 25px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.05);
        }
        
        .solar-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 15px;
          margin: 20px 0;
          padding: 20px;
          background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
          border-radius: 10px;
          border: 2px solid #4caf50;
        }
        
        .solar-input-group {
          text-align: center;
        }
        
        .solar-label {
          display: block;
          font-weight: 600;
          color: #2e7d32;
          margin-bottom: 8px;
          font-size: 0.95em;
        }
        
        .solar-input {
          width: 100%;
          padding: 12px;
          border: 2px solid #81c784;
          border-radius: 8px;
          font-size: 16px;
          text-align: center;
          background: white;
        }
        
        .solar-result {
          grid-column: span 2;
          padding: 15px;
          background: white;
          border-radius: 8px;
          margin-top: 10px;
          text-align: center;
          border: 2px solid #4caf50;
        }
        
        .optimizacion-badge {
          display: inline-block;
          padding: 8px 16px;
          border-radius: 20px;
          font-weight: bold;
          margin-top: 10px;
          font-size: 1.1em;
        }
        
        .optimizacion-verde { background: #d5f4e6; color: #27ae60; border: 2px solid #27ae60; }
        .optimizacion-amarillo { background: #fff3cd; color: #856404; border: 2px solid #f39c12; }
        .optimizacion-naranja { background: #ffeaa7; color: #e67e22; border: 2px solid #e67e22; }
        .optimizacion-rojo { background: #f8d7da; color: #721c24; border: 2px solid #e74c3c; }
        
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
        
        .solar-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 0.85em;
          font-weight: 600;
          margin-left: 8px;
        }
        
        .solar-badge.verde { background: #d5f4e6; color: #27ae60; }
        .solar-badge.amarillo { background: #fff3cd; color: #856404; }
        .solar-badge.naranja { background: #ffeaa7; color: #e67e22; }
        .solar-badge.rojo { background: #f8d7da; color: #721c24; }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🔧 Bitácora Técnico - Torre K</h1>
          <p>${fechaLegible}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            <strong>⚡ Sistema con Optimización Solar Automática</strong>
          </p>
        </div>
        
        <!-- FORMULARIO PRINCIPAL -->
        <div class="form-section">
          <h2 style="margin-bottom: 20px; color: #2c3e50;">➕ Nueva Actividad</h2>
          
          <form id="formActividad">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
              <div>
                <label>📍 Ubicación:</label>
                <input type="text" id="ubicacion" placeholder="Ej: Azotea, Cuarto Eléctrico..." required>
              </div>
              <div>
                <label>🕒 Hora:</label>
                <input type="time" id="hora" value="${horaActual}" required>
              </div>
            </div>
            
            <div style="margin-bottom: 20px;">
              <label>🔧 Actividad realizada:</label>
              <textarea id="actividad" rows="3" placeholder="Ej: Lectura de medidores Shelly, revisión de paneles..." required></textarea>
            </div>
            
            <!-- SECCIÓN DE OPTIMIZACIÓN SOLAR -->
            <div class="solar-grid">
              <div class="solar-input-group">
                <div class="solar-label">☀️ Total Energy (kWh)</div>
                <input type="number" id="energia_total" step="0.01" class="solar-input" placeholder="63.5" 
                       oninput="calcularOptimizacion()">
                <small style="color: #666;">Generación total de paneles</small>
              </div>
              
              <div class="solar-input-group">
                <div class="solar-label">↩️ Returned to CFE (kWh)</div>
                <input type="number" id="energia_retornada" step="0.01" class="solar-input" placeholder="21.5" 
                       oninput="calcularOptimizacion()">
                <small style="color: #666;">Energía retornada a CFE</small>
              </div>
              
              <div class="solar-result" id="resultadoOptimizacion" style="display: none;">
                <div style="font-size: 1.1em; font-weight: 600; margin-bottom: 8px;">
                  ⚡ OPTIMIZACIÓN SOLAR
                </div>
                <div id="optimizacionTexto">Cargando cálculo...</div>
                <div id="optimizacionBadge" class="optimizacion-badge"></div>
                <div id="optimizacionInterpretacion" style="font-size: 0.9em; color: #666; margin-top: 8px;"></div>
              </div>
            </div>
            
            <!-- OTROS CAMPOS -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0;">
              <div>
                <label>📋 Tipo de actividad:</label>
                <select id="tipo_actividad">
                  <option value="lectura">📖 Lectura Medidores</option>
                  <option value="paneles">☀️ Paneles Solares</option>
                  <option value="electricidad">⚡ Electricidad</option>
                  <option value="agua">💧 Agua</option>
                </select>
              </div>
              
              <div>
                <label>⚡ Sistema crítico:</label>
                <select id="equipo_critico">
                  <option value="">-- Ninguno --</option>
                  <option value="Paneles Solares">☀️ Paneles Solares</option>
                  <option value="Sistema Eléctrico Principal">⚡ Sistema Eléctrico</option>
                  <option value="Cisterna de Agua">💧 Cisterna</option>
                </select>
              </div>
            </div>
            
            <div style="margin-bottom: 20px;">
              <label>💧 Agua consumida (m³):</label>
              <input type="number" id="agua_m3" step="0.001" placeholder="Opcional">
            </div>
            
            <div style="margin-bottom: 20px;">
              <label>📝 Observaciones:</label>
              <textarea id="observaciones" rows="2" placeholder="Detalles de la lectura, condiciones climáticas..."></textarea>
            </div>
            
            <button type="submit" class="btn">✅ Guardar Actividad</button>
            <button type="button" onclick="exportarExcel()" class="btn btn-descargar">📥 Exportar Reporte Solar</button>
          </form>
        </div>
        
        <!-- ACTIVIDADES DE HOY -->
        <div class="form-section">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h2 style="color: #2c3e50;">📋 Actividades de hoy</h2>
            <div style="font-size: 0.9em; color: #666;">
              <span id="contadorActividades">0 actividades</span>
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
        
        // FUNCIÓN PARA CALCULAR OPTIMIZACIÓN EN TIEMPO REAL
        function calcularOptimizacion() {
          const totalInput = document.getElementById('energia_total');
          const retornadaInput = document.getElementById('energia_retornada');
          const resultadoDiv = document.getElementById('resultadoOptimizacion');
          const textoDiv = document.getElementById('optimizacionTexto');
          const badgeDiv = document.getElementById('optimizacionBadge');
          const interpretacionDiv = document.getElementById('optimizacionInterpretacion');
          
          const total = parseFloat(totalInput.value) || 0;
          const retornada = parseFloat(retornadaInput.value) || 0;
          
          if (total <= 0) {
            resultadoDiv.style.display = 'none';
            return;
          }
          
          resultadoDiv.style.display = 'block';
          
          // Calcular
          const autoconsumo = total - retornada;
          const porcentajeAutoconsumo = ((autoconsumo / total) * 100);
          const porcentajeRetorno = ((retornada / total) * 100);
          const optimizacion = 1 - (retornada / total);
          
          // Determinar estado
          let estado = 'rojo';
          let estadoClase = 'optimizacion-rojo';
          let estadoTexto = 'BAJA OPTIMIZACIÓN';
          
          if (porcentajeAutoconsumo >= 75) {
            estado = 'verde';
            estadoClase = 'optimizacion-verde';
            estadoTexto = 'ALTA OPTIMIZACIÓN';
          } else if (porcentajeAutoconsumo >= 60) {
            estado = 'amarillo';
            estadoClase = 'optimizacion-amarillo';
            estadoTexto = 'OPTIMIZACIÓN ACEPTABLE';
          } else if (porcentajeAutoconsumo >= 50) {
            estado = 'naranja';
            estadoClase = 'optimizacion-naranja';
            estadoTexto = 'OPTIMIZACIÓN REGULAR';
          }
          
          // Actualizar texto
          textoDiv.innerHTML = \`
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 10px 0;">
              <div>
                <strong>Autoconsumo:</strong><br>
                <span style="font-size: 1.2em;">\${porcentajeAutoconsumo.toFixed(1)}%</span><br>
                <small>\${autoconsumo.toFixed(2)} kWh</small>
              </div>
              <div>
                <strong>Retorno CFE:</strong><br>
                <span style="font-size: 1.2em;">\${porcentajeRetorno.toFixed(1)}%</span><br>
                <small>\${retornada.toFixed(2)} kWh</small>
              </div>
            </div>
          \`;
          
          // Actualizar badge
          badgeDiv.className = 'optimizacion-badge ' + estadoClase;
          badgeDiv.textContent = estadoTexto + ' (' + porcentajeAutoconsumo.toFixed(1) + '%)';
          
          // Actualizar interpretación
          let interpretacion = '';
          if (porcentajeAutoconsumo >= 90) {
            interpretacion = 'EXCELENTE - Con baterías o cargas inteligentes';
          } else if (porcentajeAutoconsumo >= 75) {
            interpretacion = 'BIEN - Sistema bien diseñado';
          } else if (porcentajeAutoconsumo >= 60) {
            interpretacion = 'ACEPTABLE - Normal, se puede mejorar';
          } else if (porcentajeAutoconsumo >= 50) {
            interpretacion = 'REGULAR - Considerar ajustar cargas';
          } else {
            interpretacion = 'BAJO - Revisar distribución de consumo';
          }
          
          interpretacionDiv.textContent = interpretacion;
        }
        
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
            agua_m3: document.getElementById('agua_m3').value || null,
            energia_total: document.getElementById('energia_total').value || null,
            energia_retornada: document.getElementById('energia_retornada').value || null,
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
              alert(data.message);
              document.getElementById('formActividad').reset();
              document.getElementById('resultadoOptimizacion').style.display = 'none';
              document.getElementById('hora').value = "${horaActual}";
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
              return;
            }
            
            lista.innerHTML = actividades.map(a => {
              // Badges de energía solar
              let solarBadges = '';
              if (a.energia_total) {
                let estadoClase = 'solar-badge ' + (a.estado_optimizacion || 'rojo');
                solarBadges += \`<span class="\${estadoClase}">☀️ \${a.porcentaje_autoconsumo ? a.porcentaje_autoconsumo.toFixed(1) + '%' : '--'}</span>\`;
              }
              
              return \`
                <div class="actividad-item">
                  <div>
                    <span style="background: #e9ecef; padding: 3px 8px; border-radius: 12px; font-size: 0.9em; color: #7f8c8d;">
                      \${a.hora}
                    </span>
                    <strong>\${a.actividad}</strong>
                    \${a.equipo_critico ? '<span style="background: #fff3cd; padding: 3px 8px; border-radius: 12px; font-size: 0.85em; margin-left: 10px;">' + a.equipo_critico + '</span>' : ''}
                    \${solarBadges}
                  </div>
                  <div style="margin-top: 8px; color: #5a6268;">
                    📍 \${a.ubicacion} • \${a.tipo_actividad}
                    \${a.energia_total ? '<span style="color: #2e7d32; margin-left: 10px;">☀️ ' + a.energia_total + ' kWh</span>' : ''}
                    \${a.energia_retornada ? '<span style="color: #1976d2; margin-left: 10px;">↩️ ' + a.energia_retornada + ' kWh</span>' : ''}
                  </div>
                  \${a.observaciones ? '<div style="margin-top: 8px; font-style: italic; color: #6c757d;">' + a.observaciones + '</div>' : ''}
                  \${a.porcentaje_autoconsumo ? '<div style="margin-top: 8px; font-size: 0.9em; color: #666;">⚡ Autoconsumo: ' + a.porcentaje_autoconsumo.toFixed(1) + '% • Retorno: ' + (a.porcentaje_retorno ? a.porcentaje_retorno.toFixed(1) : '0') + '%</div>' : ''}
                </div>
              \`;
            }).join('');
            
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

// ==================== DASHBOARD GERENCIA CON OPTIMIZACIÓN SOLAR ====================

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
        
        .solar-dashboard {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        
        .solar-card {
          background: white;
          padding: 25px;
          border-radius: 10px;
          text-align: center;
          box-shadow: 0 3px 10px rgba(0,0,0,0.08);
          border-top: 5px solid #4caf50;
        }
        
        .solar-card.rojo { border-color: #e74c3c; }
        .solar-card.amarillo { border-color: #f39c12; }
        .solar-card.naranja { border-color: #e67e22; }
        
        .solar-icon {
          font-size: 2.5em;
          margin-bottom: 15px;
        }
        
        .solar-valor {
          font-size: 2.2em;
          font-weight: bold;
          margin: 10px 0;
        }
        
        .solar-detalle {
          color: #666;
          font-size: 0.9em;
          margin-top: 5px;
        }
        
        .optimizacion-status {
          display: inline-block;
          padding: 8px 16px;
          border-radius: 20px;
          font-weight: bold;
          margin-top: 10px;
          font-size: 0.9em;
        }
        
        .status-verde { background: #d5f4e6; color: #27ae60; }
        .status-amarillo { background: #fff3cd; color: #856404; }
        .status-naranja { background: #ffeaa7; color: #e67e22; }
        .status-rojo { background: #f8d7da; color: #721c24; }
        
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
      </style>
    </head>
    <body>
      <div class="container">
        <!-- HEADER -->
        <div class="header">
          <h1>🏢 Dashboard Gerencia - Torre K</h1>
          <p>${fechaLegible}</p>
          <p style="margin-top: 10px; font-size: 0.9em; opacity: 0.9;">
            Monitoreo de sistemas y optimización solar
          </p>
          <div style="margin-top: 20px;">
            <button onclick="cargarDashboard()" class="btn">🔄 Actualizar</button>
            <button onclick="exportarReporteSolar()" class="btn btn-descargar">📥 Reporte Solar</button>
          </div>
        </div>
        
        <!-- PANEL DE OPTIMIZACIÓN SOLAR -->
        <h2 style="color: #2c3e50; margin-bottom: 15px;">☀️ Optimización Solar del Día</h2>
        <div class="solar-dashboard" id="solarDashboard">
          <div class="solar-card" id="cardTotal">
            <div class="solar-icon">⚡</div>
            <div class="solar-valor" id="totalEnergy">0.00</div>
            <div class="solar-detalle">Total Energy (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              Generación total
            </div>
          </div>
          
          <div class="solar-card" id="cardRetornada">
            <div class="solar-icon">↩️</div>
            <div class="solar-valor" id="totalRetornada">0.00</div>
            <div class="solar-detalle">Returned to CFE (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              Energía retornada
            </div>
          </div>
          
          <div class="solar-card" id="cardAutoconsumo">
            <div class="solar-icon">🏠</div>
            <div class="solar-valor" id="totalAutoconsumo">0.00</div>
            <div class="solar-detalle">Autoconsumo (kWh)</div>
            <div style="margin-top: 10px; font-size: 0.9em; color: #666;">
              Energía utilizada
            </div>
          </div>
          
          <div class="solar-card" id="cardOptimizacion">
            <div class="solar-icon">📊</div>
            <div class="solar-valor" id="porcentajeOptimizacion">0.0%</div>
            <div class="solar-detalle">Autoconsumo %</div>
            <div id="optimizacionStatus" class="optimizacion-status status-rojo">
              SIN DATOS
            </div>
          </div>
        </div>
        
        <!-- INTERPRETACIÓN -->
        <div id="interpretacionSolar" style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0; text-align: center;">
          <p style="color: #666; font-style: italic;">Cargando análisis de optimización...</p>
        </div>
        
        <!-- RESTO DEL DASHBOARD (igual que antes) -->
        <h2 style="color: #2c3e50; margin: 30px 0 15px 0;">🚦 Estado de Sistemas Críticos</h2>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 20px;" id="sistemasGrid">
          <p>Cargando sistemas...</p>
        </div>
      </div>
      
      <script>
        const API_URL = window.location.origin;
        
        cargarDashboard();
        
        async function cargarDashboard() {
          try {
            const response = await fetch(API_URL + '/api/dashboard/gerencia');
            const data = await response.json();
            
            // ACTUALIZAR PANEL SOLAR
            document.getElementById('totalEnergy').textContent = data.consumos_dia.energia_total.toFixed(2);
            document.getElementById('totalRetornada').textContent = data.consumos_dia.energia_retornada.toFixed(2);
            document.getElementById('totalAutoconsumo').textContent = data.consumos_dia.energia_autoconsumo.toFixed(2);
            
            if (data.optimizacion_solar) {
              const optimizacion = data.optimizacion_solar;
              
              // Actualizar porcentaje
              document.getElementById('porcentajeOptimizacion').textContent = 
                optimizacion.porcentaje_autoconsumo.toFixed(1) + '%';
              
              // Actualizar estado y colores
              const statusElem = document.getElementById('optimizacionStatus');
              const cardOptimizacion = document.getElementById('cardOptimizacion');
              
              statusElem.textContent = optimizacion.estado.toUpperCase();
              statusElem.className = 'optimizacion-status status-' + optimizacion.estado;
              cardOptimizacion.className = 'solar-card ' + optimizacion.estado;
              
              // Actualizar interpretación
              document.getElementById('interpretacionSolar').innerHTML = \`
                <div style="background: \${getColorFondo(optimizacion.estado)}; padding: 20px; border-radius: 8px;">
                  <h3 style="margin-top: 0; color: \${getColorTexto(optimizacion.estado)};">
                    ⚡ \${optimizacion.interpretacion}
                  </h3>
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 15px;">
                    <div>
                      <strong>Autoconsumo:</strong> \${optimizacion.porcentaje_autoconsumo.toFixed(1)}%<br>
                      <small>\${optimizacion.autoconsumo_kwh.toFixed(2)} kWh</small>
                    </div>
                    <div>
                      <strong>Retorno CFE:</strong> \${optimizacion.porcentaje_retorno.toFixed(1)}%<br>
                      <small>\${data.consumos_dia.energia_retornada.toFixed(2)} kWh</small>
                    </div>
                  </div>
                  <div style="margin-top: 15px; font-size: 0.9em; color: #666;">
                    <strong>Solar Optimization Index:</strong> \${optimizacion.optimizacion.toFixed(3)}
                  </div>
                </div>
              \`;
            }
            
            // Actualizar sistemas (igual que antes)
            const sistemasGrid = document.getElementById('sistemasGrid');
            sistemasGrid.innerHTML = data.equipos_criticos.map(e => {
              let icono = '🟢';
              if (e.estado === 'amarillo') icono = '🟡';
              if (e.estado === 'rojo') icono = '🔴';
              
              return \`
                <div style="background: white; padding: 20px; border-radius: 10px; box-shadow: 0 3px 10px rgba(0,0,0,0.08); border-top: 5px solid \${getColorBorde(e.estado)};">
                  <div style="font-size: 2em; margin-bottom: 10px;">\${icono}</div>
                  <h3 style="margin: 0 0 10px 0;">\${e.equipo}</h3>
                  <div style="color: #666; font-size: 0.9em;">
                    \${e.ultimo_cambio ? 'Último cambio: ' + e.ultimo_cambio.split(' ')[0] : ''}
                  </div>
                </div>
              \`;
            }).join('');
            
          } catch (error) {
            console.error('Error:', error);
            alert('Error cargando dashboard');
          }
        }
        
        function getColorFondo(estado) {
          switch(estado) {
            case 'verde': return '#d5f4e6';
            case 'amarillo': return '#fff3cd';
            case 'naranja': return '#ffeaa7';
            case 'rojo': return '#f8d7da';
            default: return '#f8f9fa';
          }
        }
        
        function getColorTexto(estado) {
          switch(estado) {
            case 'verde': return '#27ae60';
            case 'amarillo': return '#856404';
            case 'naranja': return '#e67e22';
            case 'rojo': return '#721c24';
            default: return '#666';
          }
        }
        
        function getColorBorde(estado) {
          switch(estado) {
            case 'verde': return '#27ae60';
            case 'amarillo': return '#f39c12';
            case 'rojo': return '#e74c3c';
            default: return '#95a5a6';
          }
        }
        
        function exportarReporteSolar() {
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
        
        .solar-banner {
          background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
          border: 2px solid #4caf50;
          border-radius: 10px;
          padding: 20px;
          margin: 20px 0;
        }
        
        .solar-formula {
          font-family: monospace;
          background: white;
          padding: 10px;
          border-radius: 5px;
          margin: 10px 0;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>🏢 Torre K Maintenance</h1>
        <div style="color: #7f8c8d; margin-bottom: 30px; font-size: 1.1em;">
          ${fechaLegible}
        </div>
        
        <div class="solar-banner">
          <h3 style="color: #2e7d32; margin-top: 0;">☀️ Sistema con Optimización Solar</h3>
          <p style="margin: 10px 0; color: #388e3c;">
            <strong>Nueva función:</strong> Cálculo automático de optimización solar
          </p>
          <div class="solar-formula">
            Autoconsumo (%) = ((Total - Retornada) / Total) × 100
          </div>
          <p style="font-size: 0.9em; color: #666;">
            Ingresa <strong>Total Energy</strong> y <strong>Returned to CFE</strong><br>
            del medidor Shelly para ver tu optimización
          </p>
        </div>
        
        <a href="/tecnico" style="display: block; background: #f8f9fa; border-radius: 15px; padding: 30px; margin: 20px 0; 
           transition: transform 0.3s; border: 2px solid transparent; text-decoration: none; color: inherit;">
          <h2 style="color: #2c3e50; margin-top: 0;">👷 Bitácora Técnica</h2>
          <p>Registro con optimización solar automática</p>
        </a>
        
        <a href="/gerencia" style="display: block; background: #f8f9fa; border-radius: 15px; padding: 30px; margin: 20px 0; 
           transition: transform 0.3s; border: 2px solid transparent; text-decoration: none; color: inherit;">
          <h2 style="color: #2c3e50; margin-top: 0;">👔 Dashboard Gerencia</h2>
          <p>Monitoreo con análisis de optimización solar</p>
        </a>
        
        <div style="margin-top: 30px; color: #7f8c8d; font-size: 0.85em;">
          <p>Sistema optimizado para Torre K • ${fechaLegible}</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n=========================================`);
  console.log(`🏢 Sistema Torre K con Optimización Solar`);
  console.log(`📅 ${getFechaHoy().fechaLegible}`);
  console.log(`🌐 Principal: http://localhost:${PORT}`);
  console.log(`👷 Técnico: http://localhost:${PORT}/tecnico`);
  console.log(`👔 Gerencia: http://localhost:${PORT}/gerencia`);
  console.log(`=========================================\n`);
});
