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
      
      -- DATOS DE CONSUMO DETALLADOS
      agua_metros_cubicos REAL,  -- m³ consumidos
      agua_litros REAL,          -- litros (para compatibilidad)
      energia_kwh REAL,          -- kWh consumidos de CFE
      paneles_generacion REAL,   -- kWh generados por paneles
      energia_neto REAL,         -- kWh neto (consumido - generado)
      
      -- Cambio de estado de equipo (si aplica)
      equipo_critico TEXT,
      nuevo_estado TEXT,
      
      observaciones TEXT,
      tecnico TEXT DEFAULT 'Técnico Torre K',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de CONSUMOS ACUMULADOS (para reportes)
  db.run(`
    CREATE TABLE IF NOT EXISTS consumos_diarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT UNIQUE NOT NULL,
      agua_m3 REAL DEFAULT 0,
      energia_cfe_kwh REAL DEFAULT 0,
      paneles_kwh REAL DEFAULT 0,
      energia_neto_kwh REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Tabla de SISTEMAS CRÍTICOS
  db.run(`
    CREATE TABLE IF NOT EXISTS
