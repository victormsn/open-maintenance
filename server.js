// FIX: Fecha correcta México UTC-6
const now = new Date();
const today = new Date(now.getTime() - (6 * 60 * 60000)).toISOString().split('T')[0];
console.log('🕐 Fecha HOY (México):', today);
console.log('📅 Día de la semana:', now.getDay(), '(0=Dom, 1=Lun...)');
console.log('📅 Día del mes:', now.getDate());

// 1. Primero limpiar tareas de días anteriores
const yesterday = new Date(now.getTime() - (30 * 60 * 60000)).toISOString().split('T')[0]; // 30 horas atrás
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
