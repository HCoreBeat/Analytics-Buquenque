/**
 * Sistema de Administración de Pedidos
 * Maneja la carga, visualización y actualización de pedidos desde Google Sheets
 * 
 * Estructura de datos:
 * - Backend agrupa por cliente/fecha
 * - Cada pedido puede tener múltiples productos
 * - Cada producto tiene un rowNumber único
 * - Al entregar, se eliminan TODOS los rowNumbers del pedido
 */

// Variable para almacenar el intervalo de auto-actualización
let autoRefreshInterval = null;
let autoRefreshTime = 10000; // 10 segundos por defecto
let pedidosActuales = []; // Almacenar pedidos para referencia
let paisesMap = {}; // Mapa de países (abreviatura → nombre)

const BACKEND_URL = 'https://backend-buquenque.onrender.com';
const STORAGE_KEY = 'pedidos_autorefresh_time'; // Clave para localStorage

/**
 * Carga el JSON de países y crea un mapa para búsqueda rápida
 */
async function cargarPaises() {
    try {
        const response = await fetch('/Json/paises.json');
        const paises = await response.json();
        
        // Crear mapa de abreviaturas a nombres
        paises.forEach(item => {
            paisesMap[item.abreviatura] = item.pais;
        });
        
        console.log('✅ JSON de países cargado correctamente');
    } catch (error) {
        console.error('❌ Error al cargar países:', error);
    }
}

/**
 * Obtiene el nombre del país a partir de su abreviatura
 * @param {string} abreviatura - Código de país (ej: US, ES)
 * @returns {string} Nombre del país o la abreviatura si no se encuentra
 */
function obtenerNombrePais(abreviatura) {
    if (!abreviatura) return 'N/A';
    return paisesMap[abreviatura.toUpperCase()] || abreviatura;
}

/**
 * Inicializa el módulo de pedidos
 * Se ejecuta cuando el DOM está listo
 */
function initPedidos() {
    console.log('📦 Inicializando módulo de pedidos...');
    
    // Cargar JSON de países
    cargarPaises();
    
    // Cargar tiempo de auto-refresh del localStorage
    const tiempoGuardado = localStorage.getItem(STORAGE_KEY);
    if (tiempoGuardado) {
        autoRefreshTime = parseInt(tiempoGuardado);
        console.log(`⏱️ Tiempo de auto-refresh cargado desde localStorage: ${autoRefreshTime}ms`);
    }
    
    // Cargar pedidos inicialmente
    cargarPedidos();
    
    // Configurar botón de actualización manual
    const refreshBtn = document.getElementById('refresh-pedidos-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            console.log('🔄 Actualización manual de pedidos');
            cargarPedidos();
        });
    }
    
    // Configurar selector de auto-refresh
    const autoRefreshSelect = document.getElementById('auto-refresh-pedidos-select');
    if (autoRefreshSelect) {
        // Establecer el valor guardado en el select
        if (tiempoGuardado) {
            autoRefreshSelect.value = tiempoGuardado;
        }
        
        autoRefreshSelect.addEventListener('change', (e) => {
            const newTime = parseInt(e.target.value);
            // Guardar en localStorage
            if (newTime > 0) {
                localStorage.setItem(STORAGE_KEY, newTime.toString());
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
            configurarAutoRefresh(newTime);
        });
    }
    
    // Iniciar auto-refresh con el tiempo guardado o por defecto
    configurarAutoRefresh(autoRefreshTime);
}

/**
 * Configura el intervalo de auto-actualización
 * @param {number} tiempo - Tiempo en milisegundos (0 para desactivar)
 */
function configurarAutoRefresh(tiempo) {
    // Limpiar intervalo anterior si existe
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
    
    if (tiempo > 0) {
        autoRefreshTime = tiempo;
        autoRefreshInterval = setInterval(() => {
            cargarPedidos(true); // true = es auto-refresh, para evitar logs innecesarios
        }, tiempo);
        console.log(`⏱️ Auto-refresh configurado cada ${tiempo}ms`);
    } else {
        console.log('⏱️ Auto-refresh desactivado');
    }
}

/**
 * Obtiene los pedidos pendientes desde el backend
 */
async function cargarPedidos(esAutoRefresh = false) {
    try {
        if (!esAutoRefresh) {
            console.log('📥 Cargando pedidos del servidor...');
        }
        
        const response = await fetch(`${BACKEND_URL}/api/pedidos-sheets`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (!data.success) {
            console.error('❌ Error en respuesta del servidor:', data.message);
            mostrarError('Error al cargar los pedidos');
            return;
        }
        
        const pedidos = data.pedidos || [];
        pedidosActuales = pedidos; // Guardar para referencia
        
        if (!esAutoRefresh) {
            console.log(`✅ ${pedidos.length} pedido(s) cargado(s)`);
        }
        
        // Actualizar la tabla con los pedidos
        renderPedidos(pedidos);
        
        // Actualizar timestamp de última actualización
        actualizarTimestamp();
        
    } catch (error) {
        console.error('❌ Error al cargar pedidos:', error);
        mostrarError('No se pudo conectar con el servidor');
    }
}

/**
 * Renderiza los pedidos como cards
 * @param {Array} pedidos - Array de pedidos agrupados del backend
 */
function renderPedidos(pedidos) {
    const pedidosLista = document.getElementById('pedidos-lista');
    const countBadge = document.getElementById('pedidos-count');
    const totalBadge = document.getElementById('pedidos-total');
    const productosBadge = document.getElementById('pedidos-productos');
    
    if (!pedidosLista) {
        console.error('❌ Elemento pedidos-lista no encontrado');
        return;
    }
    
    // Actualizar contador y estadísticas
    if (countBadge) {
        countBadge.textContent = pedidos.length;
    }
    
    // Calcular total y número de productos
    let totalVentas = 0;
    let totalProductos = 0;
    
    pedidos.forEach(pedido => {
        totalVentas += parseFloat(pedido.precio_compra_total) || 0;
        totalProductos += (pedido.compras ? pedido.compras.length : 0);
    });
    
    if (totalBadge) {
        totalBadge.textContent = new Intl.NumberFormat('es-CU', {
            style: 'currency',
            currency: 'CUP',
            minimumFractionDigits: 2
        }).format(totalVentas);
    }
    
    if (productosBadge) {
        productosBadge.textContent = totalProductos;
    }
    
    // Si no hay pedidos, mostrar mensaje
    if (!pedidos || pedidos.length === 0) {
        pedidosLista.innerHTML = `
            <div class="no-pedidos">
                <i class="fas fa-inbox"></i>
                <p>No hay pedidos pendientes</p>
            </div>
        `;
        return;
    }
    
    // Limpiar contenedor
    pedidosLista.innerHTML = '';
    
    // Renderizar cada pedido como una card
    pedidos.forEach(pedido => {
        const card = crearCardPedido(pedido);
        pedidosLista.appendChild(card);
    });
    
    // Actualizar badge de pedidos en el menú
    actualizarBadgePedidos(pedidos.length);
}

/**
 * Crea una card visual para un pedido completo
 * @param {Object} pedido - Objeto pedido del backend
 * @returns {HTMLElement} Card del pedido
 */
function crearCardPedido(pedido) {
    const card = document.createElement('div');
    card.className = 'pedido-card';
    card.dataset.pedidoId = `${pedido.ip}_${pedido.fecha_hora_entrada}`;
    card.dataset.rowNumbers = JSON.stringify(pedido.compras.map(p => p.rowNumber));
    
    // Información del cliente
    const nombreCliente = sanitizarHTML(pedido.nombre_comprador || 'N/A');
    const telefono = sanitizarHTML(pedido.telefono_comprador || 'N/A');
    const correo = sanitizarHTML(pedido.correo_comprador || 'N/A');
    const direccion = sanitizarHTML(pedido.direccion_envio || 'N/A');
    const paisNombre = obtenerNombrePais(pedido.pais); // Usar función para obtener nombre
    
    // Información del pedido
    const fecha = new Date(pedido.fecha_hora_entrada);
    const fechaFormato = fecha.toLocaleDateString('es-CU');
    const horaFormato = fecha.toLocaleTimeString('es-CU', { hour: '2-digit', minute: '2-digit' });
    const totalPrecio = parseFloat(pedido.precio_compra_total) || 0;
    const precioFormato = new Intl.NumberFormat('es-CU', {
        style: 'currency',
        currency: 'CUP'
    }).format(totalPrecio);
    
    // Información adicional
    const tipoUsuario = sanitizarHTML(pedido.tipo_usuario || 'N/A');
    const afiliado = sanitizarHTML(pedido.afiliado || 'N/A');
    const navegador = sanitizarHTML(pedido.navegador || 'N/A');
    const sistemOp = sanitizarHTML(pedido.sistema_operativo || 'N/A');
    
    // Crear HTML de productos
    let productosHTML = '';
    if (pedido.compras && pedido.compras.length > 0) {
        pedido.compras.forEach((producto, idx) => {
            const precioProducto = (producto.unitPrice * producto.quantity) - (producto.discount || 0);
            const precioProductoFormato = new Intl.NumberFormat('es-CU', {
                style: 'currency',
                currency: 'CUP'
            }).format(precioProducto);
            
            productosHTML += `
                <div class="producto-item ${idx === 0 ? 'primer-producto' : ''}">
                    <div class="producto-info">
                        <span class="producto-nombre">${sanitizarHTML(producto.name)}</span>
                        <span class="producto-detalles">${producto.quantity} x $${producto.unitPrice.toFixed(2)}</span>
                    </div>
                    <span class="producto-precio">${precioProductoFormato}</span>
                </div>
            `;
        });
    }
    
    card.innerHTML = `
        <div class="card-content">
            <!-- Header con estado y fecha -->
            <div class="card-header-info">
                <div class="pedido-meta">
                    <span class="estado-badge estado-pendiente">
                        <i class="fas fa-clock"></i> Pendiente
                    </span>
                    <span class="pedido-fecha">${fechaFormato} ${horaFormato}</span>
                </div>
                <div class="pedido-precio-total">
                    <span class="label">Total:</span>
                    <span class="monto">${precioFormato}</span>
                </div>
            </div>

            <!-- Información del Cliente -->
            <div class="seccion-cliente">
                <h4 class="seccion-titulo"><i class="fas fa-user"></i> Cliente</h4>
                <div class="cliente-info">
                    <div class="info-fila">
                        <span class="info-label">Nombre:</span>
                        <span class="info-valor">${nombreCliente}</span>
                    </div>
                    <div class="info-fila">
                        <span class="info-label">Teléfono:</span>
                        <span class="info-valor"><a href="tel:${pedido.telefono_comprador}">${telefono}</a></span>
                    </div>
                    <div class="info-fila">
                        <span class="info-label">Correo:</span>
                        <span class="info-valor"><a href="mailto:${pedido.correo_comprador}">${correo}</a></span>
                    </div>
                    <div class="info-fila">
                        <span class="info-label">País:</span>
                        <span class="info-valor">${paisNombre}</span>
                    </div>
                </div>
            </div>

            <!-- Dirección de Envío -->
            <div class="seccion-direccion">
                <h4 class="seccion-titulo"><i class="fas fa-map-marker-alt"></i> Dirección de Envío</h4>
                <div class="direccion-texto">${direccion}</div>
            </div>

            <!-- Productos -->
            <div class="seccion-productos">
                <h4 class="seccion-titulo"><i class="fas fa-boxes"></i> Productos (${pedido.compras?.length || 0})</h4>
                <div class="productos-lista">
                    ${productosHTML}
                </div>
            </div>

            <!-- Información Adicional -->
            <div class="seccion-adicional">
                <div class="info-grid">
                    <div class="info-item">
                        <span class="info-label">Tipo de Usuario:</span>
                        <span class="info-valor">${tipoUsuario}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Afiliado:</span>
                        <span class="info-valor">${afiliado}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Navegador:</span>
                        <span class="info-valor">${navegador}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Sistema:</span>
                        <span class="info-valor">${sistemOp}</span>
                    </div>
                </div>
            </div>

            <!-- Botón de Acción -->
            <div class="card-footer">
                <button class="btn-entregado" onclick="marcarPedidoEntregado('${pedido.ip}_${pedido.fecha_hora_entrada}')" title="Marcar este pedido como entregado">
                    <i class="fas fa-check-circle"></i> Marcar como Entregado
                </button>
            </div>
        </div>
    `;
    
    return card;
}

/**
 * Marca un pedido COMPLETO como entregado
 * Elimina TODOS los productos del pedido de Google Sheets
 * @param {string} pedidoId - ID único del pedido (ip_fecha)
 */
async function marcarPedidoEntregado(pedidoId) {
    try {
        console.log(`✅ Marcando pedido ${pedidoId} como entregado...`);
        
        // Encontrar la card del pedido
        const cardPedido = document.querySelector(`div[data-pedido-id="${pedidoId}"]`);
        
        if (!cardPedido) {
            mostrarError('Pedido no encontrado');
            return;
        }
        
        // Obtener los rowNumbers
        const rowNumbersJson = cardPedido.dataset.rowNumbers;
        const rowNumbers = JSON.parse(rowNumbersJson);
        
        console.log(`📦 Eliminando productos: ${rowNumbers.join(', ')}`);
        
        // Obtener botón y marcarlo como procesando
        const boton = cardPedido.querySelector('.btn-entregado');
        if (boton) {
            boton.disabled = true;
            boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...';
        }
        
        // Marcar card como procesando
        cardPedido.classList.add('procesando');
        
        // Llamar al endpoint DELETE-ORDER con TODOS los rowNumbers
        const response = await fetch(`${BACKEND_URL}/delete-order`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ rows: rowNumbers }) // Array de todos los rowNumbers
        });
        
        if (!response.ok) {
            throw new Error(`Error HTTP: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            console.log(`✅ Pedido ${pedidoId} entregado correctamente`);
            
            // Animar eliminación de la card
            cardPedido.classList.add('eliminando');
            
            // Remover después de animación
            setTimeout(() => {
                cardPedido.remove();
                
                // Verificar si quedan pedidos
                const pedidosLista = document.getElementById('pedidos-lista');
                const cards = pedidosLista.querySelectorAll('.pedido-card');
                
                if (cards.length === 0) {
                    pedidosLista.innerHTML = `
                        <div class="no-pedidos">
                            <i class="fas fa-inbox"></i>
                            <p>No hay pedidos pendientes</p>
                        </div>
                    `;
                }
                
                // Actualizar estadísticas
                actualizarEstadisticas();
                
                // Mostrar notificación de éxito
                mostrarExito('Pedido entregado correctamente');
            }, 400);
            
            // Recargar pedidos para sincronizar
            setTimeout(() => cargarPedidos(), 600);
        } else {
            throw new Error(data.message || 'Error desconocido');
        }
        
    } catch (error) {
        console.error('❌ Error al entregar pedido:', error);
        
        // Restaurar el estado de la card
        const cardPedido = document.querySelector(`div[data-pedido-id="${pedidoId}"]`);
        if (cardPedido) {
            cardPedido.classList.remove('procesando');
            const boton = cardPedido.querySelector('.btn-entregado');
            if (boton) {
                boton.disabled = false;
                boton.innerHTML = '<i class="fas fa-check-circle"></i> Marcar como Entregado';
            }
        }
        
        mostrarError(`Error al entregar pedido: ${error.message}`);
    }
}

/**
 * Actualiza las estadísticas de pedidos
 */
function actualizarEstadisticas() {
    const pedidosLista = document.getElementById('pedidos-lista');
    const cards = pedidosLista.querySelectorAll('.pedido-card');
    
    const countBadge = document.getElementById('pedidos-count');
    const totalBadge = document.getElementById('pedidos-total');
    const productosBadge = document.getElementById('pedidos-productos');
    
    let totalVentas = 0;
    let totalProductos = 0;
    
    cards.forEach(card => {
        // Extraer el total de cada card
        const montoText = card.querySelector('.pedido-precio-total .monto')?.textContent || '$0.00';
        const monto = parseFloat(montoText.replace(/[^\d.]/g, ''));
        totalVentas += monto;
        
        // Contar productos
        const productosCount = card.querySelectorAll('.producto-item').length;
        totalProductos += productosCount;
    });
    
    if (countBadge) {
        countBadge.textContent = cards.length;
    }
    
    if (totalBadge) {
        totalBadge.textContent = new Intl.NumberFormat('es-CU', {
            style: 'currency',
            currency: 'CUP',
            minimumFractionDigits: 2
        }).format(totalVentas);
    }
    
    if (productosBadge) {
        productosBadge.textContent = totalProductos;
    }
}

// Mantener función legacy para compatibilidad (redirige a la nueva)
async function marcarEntregado(rowNumber) {
    console.warn('⚠️ marcarEntregado() está deprecated. Usa marcarPedidoEntregado() en su lugar.');
}

/**
 * Actualiza el timestamp de última actualización
 */
function actualizarTimestamp() {
    const lastUpdateEl = document.getElementById('last-update-pedidos');
    if (lastUpdateEl) {
        const ahora = new Date();
        const horas = String(ahora.getHours()).padStart(2, '0');
        const minutos = String(ahora.getMinutes()).padStart(2, '0');
        const segundos = String(ahora.getSeconds()).padStart(2, '0');
        
        lastUpdateEl.textContent = `Actualizado a las ${horas}:${minutos}:${segundos}`;
    }
}

/**
 * Muestra un mensaje de error
 * @param {string} mensaje - Mensaje a mostrar
 */
function mostrarError(mensaje) {
    console.error(`❌ ${mensaje}`);
    
    // Crear notificación temporal
    const notificacion = document.createElement('div');
    notificacion.className = 'notificacion error';
    notificacion.innerHTML = `
        <i class="fas fa-exclamation-circle"></i>
        <span>${mensaje}</span>
    `;
    
    document.body.appendChild(notificacion);
    
    // Remover después de 4 segundos
    setTimeout(() => {
        notificacion.classList.add('desapareciendo');
        setTimeout(() => notificacion.remove(), 300);
    }, 4000);
}

/**
 * Muestra un mensaje de éxito
 * @param {string} mensaje - Mensaje a mostrar
 */
function mostrarExito(mensaje) {
    console.log(`✅ ${mensaje}`);
    
    // Crear notificación temporal
    const notificacion = document.createElement('div');
    notificacion.className = 'notificacion exito';
    notificacion.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>${mensaje}</span>
    `;
    
    document.body.appendChild(notificacion);
    
    // Remover después de 3 segundos
    setTimeout(() => {
        notificacion.classList.add('desapareciendo');
        setTimeout(() => notificacion.remove(), 300);
    }, 3000);
}

/**
 * Sanitiza texto para evitar inyecciones HTML
 * @param {string} texto - Texto a sanitizar
 * @returns {string} Texto sanitizado
 */
function sanitizarHTML(texto) {
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
}

/**
 * Actualiza el badge de pedidos en el menú
 * @param {number} cantidad - Cantidad de pedidos pendientes
 */
function actualizarBadgePedidos(cantidad) {
    const badge = document.getElementById('pedidos-menu-badge');
    
    if (!badge) {
        console.warn('⚠️ Badge de pedidos no encontrado en el DOM');
        return;
    }
    
    if (cantidad > 0) {
        badge.textContent = cantidad;
        badge.style.display = 'inline-flex';
    } else {
        badge.style.display = 'none';
    }
}

/**
 * Inicializar cuando el DOM esté listo
 */
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPedidos);
} else {
    initPedidos();
}

// Exportar funciones para acceso global
window.marcarPedidoEntregado = marcarPedidoEntregado;
window.marcarEntregado = marcarEntregado; // Legacy
window.cargarPedidos = cargarPedidos;
