# Diagnóstico y monitor de NewPos

Scripts para la PC de caja con **NewPos** (NewHotel POS). Sirven para saber si un error
es de nuestra red, de la PC o de NewHotel, y así reportar solo cuando corresponde.
Solo leen información: no tocan NewPos ni Windows.

| Archivo | Qué hace |
|---|---|
| `Diagnostico-NewPos.bat` | Doble clic **justo cuando sale el error**. Junta logs de NewPos, eventos de Windows y una prueba de conexión, da un veredicto y crea un ZIP en el Escritorio. |
| `Monitor-NewPos.bat` | Se deja abierto todo el turno. Cada 60 s prueba los servidores de NewHotel y anota en `Escritorio\Monitor-NewPos.csv`. |
| `Instalar-Inicio-Automatico.bat` | Deja el monitor corriendo **oculto (sin ventana)** y hace que arranque solo en cada inicio de sesión. No pide administrador. |
| `Detener-Monitor.bat` / `Desinstalar-Inicio-Automatico.bat` | Paran el monitor oculto / quitan el arranque automático. |
| `newpos-config.ejemplo.json` | Renombrarlo a `newpos-config.json` para enviar los datos al panel. |

## Enviar al panel (gestor de proyectos)

1. Copiar la carpeta a la PC de caja (por ejemplo `C:\NewPosMonitor`).
2. Renombrar `newpos-config.ejemplo.json` a `newpos-config.json` y llenar `EnviarA`, `Token` y `Local`.
3. Para que arranque solo y oculto: doble clic en `Instalar-Inicio-Automatico.bat`.
   (Alternativa con tarea programada, en un CMD como administrador:)

```
schtasks /Create /TN "NewPos Monitor" /SC ONLOGON /RL LIMITED /TR "powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File C:\NewPosMonitor\Diagnostico-NewPos.ps1 -Monitor"
```

Si se va el internet, los envíos se guardan en `%LOCALAPPDATA%\NewPosMonitor\cola.jsonl`
y se reenvían cuando vuelve la conexión (así también queda registrado el corte).

### Qué recibe el endpoint (`POST`, `Authorization: Bearer <Token>`)

```json
{
  "tipo": "medicion",            // "medicion" cada minuto | "diagnostico" al ejecutar el .bat
  "local": "Restaurante Centro",
  "equipo": "CAJA-01",
  "enviado": "2026-11-27T19:20:00.000Z",
  "datos": {
    "pruebas": [
      { "Hora": "2026-11-27 14:20:00", "Url": "https://api-am.newhotelcloud.com/",
        "DNS": "104.18.x.x", "Estado": 404, "ms": 180,
        "CfRay": "a61378128e90d649-IAD", "AzureRef": "20261127T...",
        "Mensaje": "...", "Veredicto": "Responde (404 = ...)" }
    ],
    "newpos_abierto": true,
    "newpos_ram_mb": 412
    // en "diagnostico" además: eventos[], lineas_error[], total_eventos, total_lineas_error
  }
}
```

El gráfico debe mostrar el tiempo de respuesta (`ms`) por servidor a lo largo del tiempo,
pintando en rojo las caídas (veredictos con CAIDO / ERROR / NO CONECTA / TIMEOUT / SIN DNS)
y mostrando la lista de diagnósticos con su `CfRay` y `AzureRef` para adjuntar al reporte.
