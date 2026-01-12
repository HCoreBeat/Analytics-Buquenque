# 📦 Panel de Administración de Pedidos - Documentación Técnica

## 🎯 Descripción General

Panel de administración de pedidos integrado en el dashboard de Buquenque que permite gestionar pedidos pendientes desde Google Sheets en tiempo real. El sistema se sincroniza automáticamente cada 3-5 segundos y permite marcar pedidos como entregados con una sola acción.

---

## 📂 Estructura de Archivos

```
Analytics-Buquenque-main/
├── index.html                 # Página principal con las tres vistas (Dashboard, Server, Pedidos)
├── Css/
│   ├── pedidos.css           # Estilos específicos del panel de pedidos
│   └── ... (otros CSS)
├── Js/
│   ├── pedidos.js            # Lógica principal del panel
│   ├── script-new.js         # Dashboard
│   ├── server-panel.js       # Panel de servidor
│   └── ... (otros JS)
└── Json/
    └── my_data.json          # Datos locales
```

---

## 🔌 Endpoints Backend Utilizados

### 1. **GET /api/pedidos-sheets**
Obtiene todos los pedidos pendientes desde Google Sheets.

**Respuesta exitosa:**
```json
{
  "success": true,
  "pedidos": [
    {
      "rowNumber": 2,
      "nombreProducto": "Camiseta XL",
      "cantidad": 2,
      "nombre_comprador": "Juan Pérez",
      "telefono_comprador": "+53 5123 4567",
      "direccion_envio": "Calle Principal 123, Apto 4",
      "precio_compra_total": 500,
      "compras": [...]
    },
    ...
  ]
}
```

### 2. **POST /delete-row**
Marca un pedido como entregado eliminando la fila de Google Sheets.

**Request:**
```json
{
  "row": 2
}
```

**Respuesta exitosa:**
```json
{
  "success": true,
  "message": "Fila eliminada",
  "deletedRow": 2
}
```

---

## 🛠️ Funciones Principales de `pedidos.js`

### `initPedidos()`
- **Descripción:** Inicializa el módulo cuando el DOM está listo
- **Acciones:**
  - Carga pedidos iniciales
  - Configura event listeners
  - Inicia auto-refresh (3 segundos por defecto)

### `cargarPedidos(esAutoRefresh = false)`
- **Descripción:** Obtiene pedidos del backend
- **Parámetros:**
  - `esAutoRefresh` (boolean): Indica si es actualización automática
- **Retorna:** Void
- **Lógica:**
  - Fetch a `/api/pedidos-sheets`
  - Valida respuesta
  - Llama a `renderPedidos()`
  - Actualiza timestamp

### `renderPedidos(pedidos)`
- **Descripción:** Renderiza pedidos en la tabla
- **Parámetros:**
  - `pedidos` (Array): Array de pedidos
- **Lógica:**
  - Limpia tabla anterior
  - Crea filas dinámicamente
  - Actualiza contador
  - Muestra mensaje si no hay pedidos

### `crearFilaPedido(pedido)`
- **Descripción:** Crea una fila HTML para un pedido
- **Parámetros:**
  - `pedido` (Object): Objeto con datos del pedido
- **Retorna:** HTMLTableRowElement
- **Campos renderizados:**
  - Producto (nombre)
  - Cantidad
  - Cliente (nombre)
  - Teléfono
  - Dirección de envío
  - Precio total formateado
  - Estado (Pendiente con ícono animado)
  - Botón Entregado

### `marcarEntregado(rowNumber)`
- **Descripción:** Marca un pedido como entregado
- **Parámetros:**
  - `rowNumber` (number): Número de fila en Google Sheets
- **Lógica:**
  1. Muestra estado "Procesando"
  2. POST a `/delete-row`
  3. Anima eliminación de fila
  4. Actualiza contador
  5. Recarga pedidos automáticamente
  6. Muestra notificación de éxito/error

### `configurarAutoRefresh(tiempo)`
- **Descripción:** Configura el intervalo de actualización automática
- **Parámetros:**
  - `tiempo` (number): Milisegundos (0 = desactivado)
- **Lógica:**
  - Limpia intervalo anterior
  - Establece nuevo intervalo si tiempo > 0
  - Logs de configuración

### `actualizarTimestamp()`
- **Descripción:** Actualiza la hora de última actualización
- **Formato:** HH:mm:ss

### `mostrarError(mensaje)` / `mostrarExito(mensaje)`
- **Descripción:** Muestra notificaciones temporales
- **Parámetros:**
  - `mensaje` (string): Texto a mostrar
- **Duración:**
  - Error: 4 segundos
  - Éxito: 3 segundos

### `sanitizarHTML(texto)`
- **Descripción:** Previene inyecciones XSS
- **Parámetros:**
  - `texto` (string): Texto a sanitizar
- **Retorna:** String sanitizado

---

## 🎨 Estructura CSS

### Clases Principales

#### Contenedor
- `.pedidos-header` - Encabezado con título y controles
- `.pedidos-controls` - Controles de actualización
- `.pedidos-container` - Contenedor principal
- `.pedidos-card` - Tarjeta de la tabla

#### Tabla
- `.pedidos-table` - Tabla principal
- `.table-responsive` - Contenedor responsivo
- `.pedido-row` - Fila de pedido
- `.no-data-row` - Fila de "sin datos"

#### Celdas
- `.producto-cell` - Nombre del producto
- `.cantidad-badge` - Cantidad con badge
- `.cliente-cell` - Nombre del cliente
- `.telefono-cell` - Número de teléfono
- `.direccion-cell` - Dirección de envío
- `.precio-monto` - Precio con color verde
- `.estado-badge` - Estado con animación
- `.accion-cell` - Botón de acción

#### Botones
- `.btn-entregado` - Botón de marcar como entregado
- `.btn` - Botón genérico
- `.btn-primary` - Botón primario

#### Notificaciones
- `.notificacion` - Notificación temporal
- `.notificacion.error` - Estilo de error
- `.notificacion.exito` - Estilo de éxito

---

## 🚀 Características Implementadas

### ✅ Funcionalidad Base
- [x] Cargar pedidos desde `/api/pedidos-sheets`
- [x] Renderizar tabla con información completa
- [x] Botón "Entregado" funcional
- [x] Eliminar filas al marcar como entregado
- [x] Auto-refresh discreto cada 3-5 segundos
- [x] Sincronización en tiempo real

### ✅ UX/UI
- [x] Tabla limpia y moderna
- [x] Colores: Pendiente (amarillo), Entregado (verde)
- [x] Animaciones suaves
- [x] Mensaje amigable sin datos
- [x] Notificaciones de éxito/error
- [x] Contador de pedidos
- [x] Timestamp de actualización

### ✅ Responsividad
- [x] Diseño responsive (mobile, tablet, desktop)
- [x] Tabla scrolleable en móvil
- [x] Controles adaptables

### ✅ Seguridad
- [x] Sanitización de HTML (prevención XSS)
- [x] Validación de respuestas
- [x] Manejo de errores robusto
- [x] CORS habilitado en backend

### ✅ Rendimiento
- [x] Auto-refresh configurable
- [x] Actualizaciones discretas sin recarga de página
- [x] Lazy rendering de filas
- [x] Optimización de DOM

---

## 🎛️ Configuración del Auto-Refresh

El panel incluye un selector para configurar el intervalo de actualización:

- **Desactivado:** Sin actualización automática
- **Cada 3s:** Recomendado (por defecto)
- **Cada 5s:** Para mejor rendimiento
- **Cada 10s:** Mínima carga en servidor

El selector está en la esquina superior derecha del panel.

---

## 📋 Estructura de Datos del Pedido

### Campo Mínimo (rowNumber)
Requerido para eliminar la fila en Google Sheets.

### Campos Opcionales
```javascript
{
  rowNumber: number,           // Requerido
  nombreProducto: string,      // Nombre del producto
  cantidad: number,            // Cantidad
  nombre_comprador: string,    // Nombre del cliente
  telefono_comprador: string,  // Teléfono
  direccion_envio: string,     // Dirección
  precio_compra_total: number, // Precio total
  compras: Array,              // Array de compras (alternativa)
  navegador: string,           // Navegador (opcional)
  sistema_operativo: string,   // SO (opcional)
  // ... otros campos
}
```

---

## 🐛 Manejo de Errores

### Errores Comunes

#### Error 1: Tabla no cargada
**Causa:** El endpoint `/api/pedidos-sheets` no responde
**Solución:** Verificar backend y CORS

#### Error 2: No se marcan como entregados
**Causa:** El endpoint `/delete-row` falla
**Solución:** Verificar que `rowNumber` es un número válido

#### Error 3: Auto-refresh no funciona
**Causa:** El intervalo se detuvo
**Solución:** Cambiar opción en el selector y volver a cambiar

---

## 🧪 Pruebas

### Test Manual 1: Cargar Pedidos
```
1. Ir a la sección "Pedidos"
2. Verificar que se carga tabla con pedidos
3. Contar elementos = "Pedidos Pendientes" badge
```

### Test Manual 2: Marcar como Entregado
```
1. Click en botón "Entregado" de cualquier fila
2. Verificar que fila desaparece (animación suave)
3. Verificar notificación de éxito
4. Verificar que contador disminuye
```

### Test Manual 3: Auto-Refresh
```
1. Cambiar en Google Sheets (agregar/eliminar pedido)
2. Esperar 3-5 segundos
3. Verificar que tabla se actualiza automáticamente
4. Verificar que "Actualizado a las HH:mm:ss" cambia
```

### Test Manual 4: Sin Datos
```
1. Eliminar todos los pedidos manualmente
2. Esperar actualización automática
3. Verificar mensaje "No hay pedidos pendientes"
4. Verificar que contador = 0
```

---

## 🔧 Integración con el Dashboard

El panel se integra como una vista más en el menú lateral:

1. **Menú:** Opción "Pedidos" entre "Server" e "Inventario"
2. **Vista:** Usa el mismo sistema de vistas que Dashboard y Server
3. **Scripts:** Se carga automáticamente al cargar `index.html`
4. **Estilos:** Hereda variables CSS del sistema

---

## 📝 Logs de Consola

El módulo genera logs útiles para debugging:

```javascript
console.log('📦 Inicializando módulo de pedidos...');
console.log('📥 Cargando pedidos del servidor...');
console.log('✅ N pedidos cargados');
console.log('🔄 Actualización manual de pedidos');
console.log('✅ Marcando pedido fila X como entregado...');
console.log('❌ Error al cargar pedidos: [error]');
```

---

## 🚨 Requisitos del Backend

El backend debe cumplir:

1. ✅ Endpoint `/api/pedidos-sheets` con método GET
2. ✅ Endpoint `/delete-row` con método POST
3. ✅ CORS habilitado para el dominio
4. ✅ Validación de `rowNumber` en delete-row
5. ✅ Google Sheets sincronizado correctamente

---

## 📱 Compatibilidad

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ✅ Navegadores móviles modernos

---

## 🎓 Notas Técnicas

### Por qué auto-refresh es discreto
- No recarga la página
- Solo actualiza el contenido de la tabla
- Usa `setInterval()` sin mostrar indicadores obvios
- El timestamp muestra cuándo fue la última actualización

### Animaciones
- Las filas se desvanecen suavemente al eliminar (300ms)
- Los iconos de estado rotan continuamente
- Los botones tienen transiciones suaves

### Responsividad
- Usa `@media queries` para adaptar a cualquier pantalla
- La tabla es scrolleable horizontalmente en móvil
- Los datos se truncan con `text-overflow: ellipsis`

---

## 👨‍💻 Ejemplo de Uso

```html
<!-- HTML -->
<div id="tabla-pedidos"></div>

<!-- JavaScript -->
<script>
  // Cargar pedidos manualmente
  cargarPedidos();
  
  // Marcar pedido como entregado
  marcarEntregado(2); // rowNumber = 2
  
  // Cambiar auto-refresh
  configurarAutoRefresh(5000); // Cada 5 segundos
  configurarAutoRefresh(0);    // Desactivar
</script>
```

---

## 📞 Soporte

Para problemas o mejoras:
1. Verificar logs de consola (F12 → Console)
2. Verificar respuesta del backend (F12 → Network)
3. Verificar que Google Sheets tiene datos válidos
4. Verificar que CORS permite el origen

---

**Última actualización:** Enero 2026  
**Versión:** 1.0.0  
**Autor:** HLab - Buquenque Analytics
