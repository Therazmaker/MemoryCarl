# NeuroChat: Arquitectura y Extensión de Contexto Diario (Day Context)

## Introducción

**NeuroChat** es el sistema de interfaz conversacional inteligente de MemoryCarl. A diferencia de un chatbot tradicional, NeuroChat está diseñado para operar sobre un grafo dinámico de conocimientos (neuronas) y una base de memorias episódicas. Su objetivo es proporcionar una conversación que no solo sea empática, sino profundamente contextualizada en la historia y evolución del usuario.

## Arquitectura Técnica

El núcleo de NeuroChat reside en el **NeuroCore** (`src/neuro/neurocore.js`), que orquestra un flujo de procesamiento en cada turno de conversación:

1.  **Activación Neuronal:** Identifica conceptos relevantes en el Almacén de Neuronas basándose en similitud semántica y coincidencia de palabras clave.
2.  **Análisis de Cobertura:** Detecta qué partes del input del usuario no están cubiertas por las neuronas actuales para sugerir la creación de nuevo conocimiento.
3.  **Recuperación de Memorias:** Consulta el `memoryStore` para encontrar eventos pasados relacionados.
4.  **Inferencia de Insights:** Ejecuta el motor de insights para detectar patrones o tendencias recurrentes.
5.  **Generación de Respuesta:** Utiliza una combinación de lógica local (motor de respuesta por patrones) e IA externa (Gemini vía NeuroClaw o Cliente Premium) para construir la respuesta final.

---

## Nueva Implementación: Integración de Contexto Diario

La nueva extensión de **Contexto Diario (Day Context)** permite que NeuroChat "lea" y comprenda los resúmenes de días pasados procesados por el *Daily Memory Engine*. Esto transforma la memoria de Carl de una colección de fragmentos aislados en una narrativa continua.

### 1. Motor de Recuperación (`findRelevantDays`)

Implementado en `src/day/dayStore.js`, este motor busca días pasados significativos utilizando un sistema de puntuación:
*   **Afinidad Neuronal (Peso: 0.4):** Coincidencia entre las neuronas activas hoy y las vinculadas a días pasados.
*   **Afinidad Temática (Peso: 0.2):** Solapamiento entre los temas dominantes del día y los conceptos actuales.
*   **Factor Hito (+0.15):** Bonus para días marcados manualmente como hitos.
*   **Prioridad de Refinamiento (+0.1):** Bonus para días que ya han sido **refinados con Gemini**, garantizando que Carl use los resúmenes de mayor calidad.

### 2. Síntesis de Contexto en NeuroCore

El motor central ahora sintetiza un objeto `dayContext` que incluye:
*   Resúmenes detallados de los días relevantes.
*   Emociones dominantes de esos días.
*   Insights específicos detectados en su momento.

Este contexto se inyecta directamente en los prompts enviados a Gemini, permitiendo que la IA haga referencias temporales precisas (ej: *"Esto suena similar a la frustración que sentiste el martes pasado cuando..."*).

### 3. Interfaz de Usuario: "Días Relacionados"

Se ha añadido un nuevo componente visual en el chat (`renderDayRecallCard`):
*   Aparece debajo de las respuestas del asistente cuando se ha utilizado información de días previos.
*   Permite al usuario visualizar rápidamente qué días está "recordando" Carl.
*   **Navegación Directa:** Al hacer clic en una tarjeta de día, la interfaz salta automáticamente a la pestaña de **Días** con el detalle de esa fecha abierto.

---

## Beneficios de la Implementación

1.  **Continuidad Narrativa:** Carl deja de tener "amnesia" entre sesiones de días diferentes. Puede conectar eventos que ocurrieron hace semanas si el tema vuelve a surgir.
2.  **Reconocimiento de Patrones Temporales:** Al tener acceso a los insights y emociones de días específicos, la IA puede detectar si una situación se está repitiendo o si el usuario está progresando en un tema particular.
3.  **Valorización del Refinamiento:** El esfuerzo del usuario (o de la IA) al refinar un día en la pestaña "Días" tiene un impacto directo y visible en la calidad de la conversación posterior.
4.  **Contexto Psicológico Profundo:** Los resúmenes diarios suelen contener observaciones sobre el estado interno y relaciones, lo que permite a NeuroChat ser mucho más que un buscador de datos; se convierte en un observador de la evolución personal.
5.  **Transparencia:** El usuario siempre sabe qué información está usando la IA gracias a las tarjetas de "Días relacionados", aumentando la confianza y la interpretabilidad del sistema.
