import React, { useState, useEffect } from 'react';

interface Task {
  id: string;
  date: string;
  area: string;
  system: string;
  activity: string;
  frequency: string;
  status: 'done' | 'pending';
  photo?: string;
  note?: string;
  user: string;
}

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const API_URL = 'https://open-maintenance.onrender.com';

  useEffect(() => {
    fetch(`${API_URL}/api/tasks/today`)
      .then(res => res.json())
      .then(data => {
        setTasks(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Error:', err);
        setLoading(false);
      });
  }, []);

  const completeTask = async (taskId: string) => {
    const note = prompt('Agrega una nota (opcional):') || '';
    
    try {
      const response = await fetch(`${API_URL}/api/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          photo: 'https://via.placeholder.com/150',
          note 
        })
      });
      
      if (response.ok) {
        alert('✅ Tarea completada');
        setTasks(tasks.map(task => 
          task.id === taskId ? { ...task, status: 'done' } : task
        ));
      }
    } catch (error) {
      alert('Error al completar tarea');
    }
  };

  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center',
        height: '100vh',
        fontSize: '1.2rem'
      }}>
        ⏳ Cargando tareas...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px' }}>
      <header style={{ marginBottom: '30px' }}>
        <h1 style={{ color: '#1976d2' }}>🏢 Torre K Maintenance</h1>
        <p style={{ color: '#666' }}>
          Sistema abierto de mantenimiento • {new Date().toLocaleDateString('es-ES')}
        </p>
      </header>

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: '1fr 1fr 1fr', 
        gap: '15px',
        marginBottom: '30px'
      }}>
        <div style={{ 
          background: '#4caf50', 
          color: 'white', 
          padding: '20px', 
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem' }}>🟢</div>
          <h3>Operativo</h3>
        </div>
        <div style={{ 
          background: '#ff9800', 
          color: 'white', 
          padding: '20px', 
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem' }}>🟡</div>
          <h3>Atención</h3>
        </div>
        <div style={{ 
          background: '#f44336', 
          color: 'white', 
          padding: '20px', 
          borderRadius: '8px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '2rem' }}>🔴</div>
          <h3>Riesgo</h3>
        </div>
      </div>

      <h2 style={{ marginBottom: '20px' }}>📋 Tareas de Hoy</h2>
      
      {tasks.length === 0 ? (
        <div style={{ 
          padding: '40px', 
          textAlign: 'center', 
          background: '#f9f9f9',
          borderRadius: '8px'
        }}>
          <p>No hay tareas programadas para hoy</p>
          <button 
            onClick={() => window.location.reload()}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              background: '#1976d2',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            🔄 Recargar
          </button>
        </div>
      ) : (
        <div>
          {tasks.map(task => (
            <div key={task.id} style={{
              background: task.status === 'done' ? '#f8fff8' : 'white',
              border: `1px solid ${task.status === 'done' ? '#4caf50' : '#ddd'}`,
              borderLeft: `4px solid ${task.status === 'done' ? '#4caf50' : '#2196f3'}`,
              padding: '20px',
              marginBottom: '15px',
              borderRadius: '8px',
              boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <span style={{
                    display: 'inline-block',
                    background: '#e3f2fd',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    fontSize: '0.9rem',
                    marginBottom: '8px'
                  }}>
                    {task.area}
                  </span>
                  <h3 style={{ margin: '8px 0' }}>{task.system}</h3>
                  <p style={{ margin: '8px 0', color: '#555' }}>{task.activity}</p>
                  <div style={{ fontSize: '0.9rem', color: '#777', marginTop: '12px' }}>
                    <span>🔄 {task.frequency === 'daily' ? 'Diario' : task.frequency}</span>
                    <span style={{ marginLeft: '15px' }}>👤 {task.user}</span>
                  </div>
                </div>
                
                <div>
                  {task.status === 'done' ? (
                    <div style={{ color: '#4caf50', fontWeight: 'bold' }}>
                      ✅ COMPLETADO
                    </div>
                  ) : (
                    <button
                      onClick={() => completeTask(task.id)}
                      style={{
                        background: '#2196f3',
                        color: 'white',
                        border: 'none',
                        padding: '10px 20px',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                      }}
                    >
                      📸 MARCAR HECHO
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <footer style={{ 
        marginTop: '40px', 
        paddingTop: '20px', 
        borderTop: '1px solid #eee',
        textAlign: 'center',
        color: '#666',
        fontSize: '0.9rem'
      }}>
        <p>OpenMaintenance Torre K • Sin burocracia, sin excusas</p>
        <p>Backend: {API_URL} | Frontend: {window.location.origin}</p>
      </footer>
    </div>
  );
}

export default App;
