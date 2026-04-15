# MemoryCarl

MemoryCarl es una Aplicación Web Progresiva (PWA) de asistente personal diseñada bajo una filosofía **local-first** y **phone-first**. Permite gestionar múltiples aspectos de la vida diaria, desde finanzas y rutinas hasta planificación de comidas y análisis deportivo, todo con un enfoque en la privacidad y la agilidad de uso en dispositivos móviles.

## 🚀 Módulos Principales

### 🏠 Home
El centro neurálgico que ofrece una visión rápida del día:
- Clima lunar y tránsitos astrológicos (vía Cosmic Lite o Swiss Astro).
- Resumen del presupuesto mensual.
- Widgets de música, sueño y estado de ánimo (Mood).
- Notificaciones vía Firebase Cloud Messaging.

### 🍽️ Semana (Planner Familiar)
Gestión completa de la alimentación familiar:
- Planificador semanal de comidas (Desayuno, Almuerzo, Cena, Snack).
- Biblioteca de recetas con ingredientes y aptitud para niños.
- Inventario de despensa con alertas de vencimiento.
- Generación automática de lista de compras basada en el plan.
- **Semana IA**: Integración con Google Gemini para generar planes de contingencia basados en lo que tienes en casa.

### 🧹 Casa (Gestión de Limpieza)
Sistema dinámico para el mantenimiento del hogar:
- División por zonas (Sala, Cocina, Baños, Cuartos).
- Tareas configurables por frecuencia y nivel de profundidad (Light vs Deep).
- Historial de sesiones de limpieza para seguimiento de constancia.

### 💰 Finanzas
Un potente motor financiero que va más allá del simple registro:
- **Cuentas y Movimientos**: Seguimiento detallado de ingresos y gastos.
- **Compromisos**: Gestión de pagos fijos mensuales con seguimiento de resolución.
- **Deudas**: Estrategias de pago (Snowball/Avalanche) y simulación de plazos.
- **Hoja de Ruta (Roadmap)**: Visualización de cascada de pagos y flujo de caja semanal.
- **Mission Control**: Análisis de riesgo y margen disponible en tiempo real.

### ⚽ Football Lab
Laboratorio avanzado de análisis deportivo:
- Seguimiento de equipos, jugadores y ligas.
- Motores de predicción: Poisson, Neuronal y Híbrido.
- **Match Tracker**: Registro detallado de eventos durante los partidos.
- **Video Scout**: Herramienta para trazar trayectorias de jugadas y analizar perfiles tácticos.
- **Bitácora de Performance**: Análisis de ROI, CLV y valor esperado (EV).

### 📊 Insights
Análisis visual de tu actividad:
- **Heatmap**: Calendario de pulso diario basado en sueño, tareas, limpieza y gastos.
- **Radar Charts**: Comparativa de múltiples dimensiones del día a día.

### 💬 NeuroChat
Interfaz de conversación con una "memoria viva" del sistema, permitiendo interactuar con tus datos de forma natural.

## 🛠️ Stack Tecnológico

- **Frontend**: Vanilla JavaScript (ES Modules), CSS3 moderno.
- **Persistencia**: LocalStorage e IndexedDB (Local-first).
- **Gráficos**: [Chart.js](https://www.chartjs.org/) para visualización de datos.
- **Física**: [Matter.js](https://brm.io/matter-js/) para el mini-juego Merge.
- **Animaciones**: [Anime.js](https://animejs.com/).
- **Redes**: [Vis-network](https://visjs.github.io/vis-network/) para mapas neuronales.
- **Notificaciones**: [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging).
- **IA**: Integración con Google [Gemini API](https://ai.google.dev/).

## ⚙️ Configuración y Uso

### Ejecución Local
Al ser un proyecto estático, puedes servirlo con cualquier servidor web:
```bash
npx serve .
```
O simplemente abrir `index.html` en un navegador moderno.

### Sincronización (Opcional)
MemoryCarl soporta sincronización remota mediante un script de **Google Apps Script**. Puedes configurar la URL de tu Web App y una API Key en el módulo de Ajustes para mantener respaldos en la nube (Google Sheets).

### Configuración de IA
Para las funciones avanzadas de NeuroClaw y Semana IA, deberás proporcionar tus propias API Keys (Gemini/Cloud Run) en el panel de Ajustes.

## 📱 PWA (Instalación)
Desde Chrome o Safari en tu móvil, usa la opción "Añadir a la pantalla de inicio" para instalar MemoryCarl como una aplicación nativa, lo que habilitará el uso offline y el acceso rápido.

---
*Desarrollado con enfoque en la soberanía de los datos personales.*
