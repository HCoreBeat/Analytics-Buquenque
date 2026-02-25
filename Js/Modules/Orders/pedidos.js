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

import { inventoryApiClient } from '../Inventory/inventoryApiClient.js';
import { confirm as modalConfirm } from '../../UI/modalUtils.js';
import { CONFIG } from '../../Core/config.js';

// Variable para almacenar el intervalo de auto-actualización
let autoRefreshInterval = null;
let autoRefreshTime = 10000; // 10 segundos por defecto
let pedidosActuales = []; // Almacenar pedidos para referencia
let paisesMap = {}; // Mapa de países (abreviatura → nombre)

const BACKEND_URL = CONFIG.BACKEND_URL;
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

// ------------------- UTILIDADES: Normalización y API de Inventario -------------------
/**
 * Normaliza un nombre (quita tildes, pasa a minúsculas y trim)
 */
function normalizeName(s) {
    return ('' + (s || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Obtiene TODO el inventario desde el backend y devuelve un array de productos.
 * Maneja diferentes formatos de respuesta que pueda devolver Apps Script.
 */
async function fetchInventoryAll() {
    const res = await fetch(`${BACKEND_URL}/inventario`);
    if (!res.ok) throw new Error(`Error obteniendo inventario: ${res.status}`);
    const data = await res.json();

    let items = [];
    if (Array.isArray(data)) items = data;
    else if (Array.isArray(data.data)) items = data.data;
    else if (Array.isArray(data.inventory)) items = data.inventory;
    else if (Array.isArray(data.products)) items = data.products;
    else items = [];

    return items;
}

/**
 * Limpia un nombre de pedido: quita unidades y cantidades para mejorar matching
 * Ej: "Paquete de cuartos de pollo 10 lbs" -> "Paquete de cuartos de pollo"
 */
function normalizeOrderName(name) {
    let s = ('' + (name || '')).trim();
    // eliminar patrones comunes: " x lb", "10 lbs", "1 lb", "x 2", "- 10lbs" etc.
    s = s.replace(/\b[xX]\s*\d+\b/g, ''); // x 2
    s = s.replace(/\b\d+\s*(kg|g|gr|lbs|lb|l|ml|oz|ozs|kilos|libras)\b/gi, '');
    s = s.replace(/\b\d+\s*lbs?\b/gi, '');
    s = s.replace(/\b\d+\b/g, '');
    // remover múltiples espacios sobrantes
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s;
}

/**
 * Busca un producto en el catálogo de productos (Json/products.json)
 * Devuelve el objeto producto (con .id) o null
 */
async function fetchProductsCatalog() {
    // Intentar cargar desde la URL raw de GitHub (misma que ProductManager usa)
    const url = 'https://raw.githubusercontent.com/HCoreBeat/Buquenque/main/Json/products.json';
    try {
        const r = await fetch(`${url}?t=${Date.now()}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (data && Array.isArray(data.products)) return data.products;
        // si viene simplemente un array
        if (Array.isArray(data)) return data;
        return [];
    } catch (err) {
        console.warn('No se pudo descargar products.json:', err && err.message ? err.message : err);
        return [];
    }
}

/**
 * Busca una coincidencia en el catálogo por nombre
 */
function findProductInCatalogByName(name, catalog) {
    const orderNorm = normalizeName(normalizeOrderName(name));
    if (!orderNorm) return null;
    const getName = p => normalizeName(p.nombre || p.name || p.nombre_producto || p.producto || p.title || '');

    // exact match
    let exact = catalog.find(p => getName(p) === orderNorm);
    if (exact) return exact;

    // startsWith / includes
    let partial = catalog.find(p => {
        const pn = getName(p);
        return pn.startsWith(orderNorm) || pn.includes(orderNorm) || orderNorm.includes(pn);
    });
    return partial || null;
}

/**
 * Consulta inventario por product_id (backend) y devuelve objeto con quantity/stock numérico
 */
async function getInventoryByProductId(productId) {
    try {
        // Usar el InventoryApiClient para obtener y normalizar datos
        const inv = await inventoryApiClient.getInventory(productId).catch(() => null);
        if (!inv) return null;
        return { product_id: productId, quantity: Number(inv.stock ?? 0), raw: inv };
    } catch (err) {
        console.warn('Error fetching inventory by id', productId, err && err.message ? err.message : err);
        return null;
    }
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
        totalBadge.textContent = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
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
        // Asegurar que el badge del menú se oculte cuando no hay pedidos
        actualizarBadgePedidos(0);
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
    // Guardar productos mínimos en data-products para uso al marcar como entregado
    card.dataset.products = JSON.stringify((pedido.compras || []).map(p => ({
        name: p.name || p.producto_name || '',
        quantity: Number(p.quantity || p.producto_quantity || 0),
        id: p.id || p.product_id || null
    })));
    
    // Información del cliente
    const nombreCliente = sanitizarHTML(pedido.nombre_comprador || 'N/A');
    const telefono = sanitizarHTML(pedido.telefono_comprador || 'N/A');
    const correo = sanitizarHTML(pedido.correo_comprador || 'N/A');
    const direccion = sanitizarHTML(pedido.direccion_envio || 'N/A');
    const paisNombre = obtenerNombrePais(pedido.pais); // Usar función para obtener nombre
    
    // Información del pedido
    const fecha = new Date(pedido.fecha_hora_entrada);
    const fechaFormato = fecha.toLocaleDateString('en-US');
    const horaFormato = fecha.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const totalPrecio = parseFloat(pedido.precio_compra_total) || 0;
    const precioFormato = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
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
            const precioProducto = (producto.unitPrice * producto.quantity);
            const precioProductoFormato = new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: 'USD',
                minimumFractionDigits: 2
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
 * - Busca cada producto por nombre en el inventario (resolviendo su product_id)
 * - Resta la cantidad pedida del stock (actualiza por product_id)
 * - Si todas las actualizaciones son exitosas, elimina las filas del pedido en Sheets
 * - Si hay fallos en actualizaciones o eliminación, intenta rollback para mantener consistencia
 * @param {string} pedidoId - ID único del pedido (ip_fecha)
 */
async function marcarPedidoEntregado(pedidoId) {
    let appliedUpdates = [];
    try {
        console.log(`✅ Marcando pedido ${pedidoId} como entregado y ajustando stock...`);

        // Encontrar la card del pedido
        const cardPedido = document.querySelector(`div[data-pedido-id="${pedidoId}"]`);
        if (!cardPedido) {
            mostrarError('Pedido no encontrado');
            return;
        }

        // Obtener productos desde dataset y agregarlos por nombre
        let products = [];
        try {
            products = JSON.parse(cardPedido.dataset.products || '[]');
        } catch (e) {
            products = [];
        }

        const aggregated = products.reduce((acc, p) => {
            const name = (p.name || '').trim();
            const q = Number(p.quantity) || 0;
            if (!name || q === 0) return acc;
            const ex = acc.find(a => a.name === name);
            if (ex) ex.quantity += q; else acc.push({ name, quantity: q });
            return acc;
        }, []);

        // Si no hay productos (caso extraño), proceder con eliminación directa como antes
        if (aggregated.length === 0) {
            console.warn('⚠️ No se encontraron productos en el pedido; procediendo con eliminación directa.');
            return await (async function directDelete() {
                const rowNumbers = JSON.parse(cardPedido.dataset.rowNumbers || '[]');
                const boton = cardPedido.querySelector('.btn-entregado');
                if (boton) { boton.disabled = true; boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...'; }
                cardPedido.classList.add('procesando');
                const response = await fetch(`${BACKEND_URL}/delete-order`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: rowNumbers })
                });
                if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
                const data = await response.json();
                if (!data.success) throw new Error(data.message || 'Error desconocido');
                cardPedido.classList.add('eliminando'); setTimeout(() => { cardPedido.remove(); actualizarEstadisticas(); mostrarExito('Pedido entregado correctamente'); cargarPedidos(); }, 350);
            })();
        }

        // Confirmación rápida usando modal personalizado para evitar diálogo nativo
        const userConfirmed = await (typeof modalConfirm === 'function' ? modalConfirm('¿Confirmar marcar este pedido como entregado y actualizar el stock?') : Promise.resolve(window.confirm('¿Confirmar marcar este pedido como entregado y actualizar el stock?')));
        if (!userConfirmed) {
            // Restaurar botón si el usuario cancela
            const cancelCard = document.querySelector(`div[data-pedido-id="${pedidoId}"]`);
            if (cancelCard) {
                cancelCard.classList.remove('procesando');
                const cancelBtn = cancelCard.querySelector('.btn-entregado');
                if (cancelBtn) { cancelBtn.disabled = false; cancelBtn.innerHTML = '<i class="fas fa-check-circle"></i> Marcar como Entregado'; }
            }
            return;
        }

        // Preparar UI
        const boton = cardPedido.querySelector('.btn-entregado');
        if (boton) { boton.disabled = true; boton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Procesando...'; }
        cardPedido.classList.add('procesando');
            // Mostrar estado y notificación interna
            setCardEstado(cardPedido, 'procesando', 'Procesando...');
            showCardNotification(cardPedido, 'procesando', 'Actualizando stock y eliminando pedido...');

            // Obtener inventario completo y catálogo de productos
            const inventory = await fetchInventoryAll();
            const productsCatalog = await fetchProductsCatalog();

            // Resolver coincidencias por nombre (catalogo primero, fallback a inventario)
            const missing = [];
            const updates = []; // { productId, currentQty, newQty, match }

            for (const item of aggregated) {
                const orderClean = normalizeName(normalizeOrderName(item.name || ''));
                if (!orderClean) {
                    missing.push(item.name || '');
                    continue;
                }

                // 1) intentar encontrar en catálogo de productos
                let catalogMatch = findProductInCatalogByName(item.name, productsCatalog);
                if (catalogMatch && (catalogMatch.id || catalogMatch.id === 0)) {
                    const productId = String(catalogMatch.id);
                    // buscar en inventory previamente cargado primero para evitar llamadas adicionales
                    let inv = inventory.find(p => String(p.product_id) === productId || String(p.id) === productId);
                    if (!inv) {
                        inv = await getInventoryByProductId(productId).catch(() => null);
                    }
                    if (!inv) {
                        missing.push(item.name);
                        continue;
                    }
                    const currentQty = Number(inv.quantity || inv.stock || 0);
                    const newQty = currentQty - Number(item.quantity);
                    updates.push({ productId, currentQty, newQty, match: catalogMatch, orderedQty: item.quantity });
                    continue;
                }

                // 2) fallback: buscar directamente en inventario (por nombre)
                const invMatch = inventory.find(p => {
                    const pn = normalizeName(p.name || p.product_name || p.producto_name || p.producto || p.nombre || '');
                    return pn === orderClean || pn.startsWith(orderClean) || pn.includes(orderClean) || orderClean.includes(pn);
                });

                if (invMatch) {
                    const productId = invMatch.product_id || invMatch.id || invMatch.rowNumber || invMatch.productId || null;
                    const currentQty = Number(invMatch.quantity ?? invMatch.stock ?? invMatch.producto_quantity ?? invMatch.cantidad ?? 0);
                    const newQty = currentQty - Number(item.quantity);
                    updates.push({ productId, currentQty, newQty, match: invMatch, orderedQty: item.quantity });
                    continue;
                }

                // Si llegamos aquí: no se encontró
                missing.push(item.name);
            }

            if (missing.length) {
                throw new Error(`Productos no encontrados en inventario: ${missing.join(', ')}`);
            }

            // Aplicar actualizaciones en paralelo para reducir latencia, pero manejando rollback
            const savePromises = updates.map(u => {
                const payload = {
                    stock: Number.isFinite(u.newQty) ? Math.round(u.newQty) : u.newQty,
                    precio_compra: u.match.price ?? u.match.producto_price ?? u.match.unitPrice ?? u.match.product_price ?? null,
                    proveedor: u.match.supplier ?? u.match.proveedor ?? null,
                    notas: u.match.note ?? u.match.nota ?? ''
                };
                return inventoryApiClient.saveInventory(u.productId, payload)
                    .then(savedInv => ({ ok: true, productId: u.productId, savedInv, originalQty: u.currentQty, meta: { price: u.match.price, supplier: u.match.supplier, note: u.match.note } }))
                    .catch(err => ({ ok: false, productId: u.productId, error: err }));
            });

            const settled = await Promise.all(savePromises);

            const failed = settled.filter(r => !r.ok);
            const succeeded = settled.filter(r => r.ok);

            // registrar aplicados para rollback si fuera necesario
            appliedUpdates = succeeded.map(s => ({ productId: s.productId, originalQty: s.originalQty, meta: s.meta }));

            // Dispatch para los éxitos
            for (const s of succeeded) {
                try {
                    const payloads = {};
                    payloads[s.productId] = s.savedInv;
                    document.dispatchEvent(new CustomEvent('inventories:updated', { detail: { ids: [s.productId], payloads } }));
                    console.log('📣 Evento inventories:updated dispatch para', s.productId);
                } catch (evtErr) {
                    console.warn('No se pudo despachar evento inventories:updated', evtErr);
                }
            }

            if (failed.length) {
                // rollback de los aplicados
                for (const a of succeeded) {
                    try {
                        await inventoryApiClient.saveInventory(a.productId, { stock: a.originalQty, precio_compra: a.meta.price ?? null, proveedor: a.meta.supplier ?? null, notas: a.meta.note ?? '' });
                    } catch (rbErr) {
                        console.error('❌ Error durante rollback para product_id=' + a.productId, rbErr);
                    }
                }
                throw new Error(`Algunas actualizaciones de inventario fallaron: ${failed.map(f => f.productId).join(', ')}`);
            }

        const rowNumbers = JSON.parse(cardPedido.dataset.rowNumbers || '[]');
        const delResp = await fetch(`${BACKEND_URL}/delete-order`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: rowNumbers })
        });

        if (!delResp.ok) {
            throw new Error(`Error eliminando pedido: ${delResp.status}`);
        }
        const delData = await delResp.json().catch(() => ({}));
        if (!delData.success) {
            throw new Error(`Error eliminando pedido: ${delData.message || JSON.stringify(delData)}`);
        }

        // Éxito completo: mostrar feedback visual y limpiar UI
        // Mostrar estado entregado y notificación interna antes de remover
        setCardEstado(cardPedido, 'entregado', 'Entregado');
        clearCardNotification(cardPedido);
        showCardNotification(cardPedido, 'exito', 'Pedido entregado y stock actualizado');
        setTimeout(() => {
            cardPedido.classList.add('eliminando');
        }, 300);
        setTimeout(() => {
            // Remove after animación y actualizar stats
            cardPedido.remove();
            actualizarEstadisticas();
            // Despachar evento global para que otros módulos sincronicen
            try { document.dispatchEvent(new CustomEvent('orders:changed', { detail: { pedidoId } })); } catch (e) { /* ignore */ }
            mostrarExito('Pedido entregado y stock actualizado');
            cargarPedidos();
        }, 800);

    } catch (error) {
        console.error('❌ Error al entregar pedido:', error);

        // Si hubo actualizaciones aplicadas, intentar rollback
        if (appliedUpdates && appliedUpdates.length > 0) {
            console.warn('🔁 Intentando rollback de actualizaciones aplicadas...');
            for (const a of appliedUpdates) {
                try {
                    await inventoryApiClient.saveInventory(a.productId, {
                        stock: a.originalQty,
                        precio_compra: a.meta.price ?? null,
                        proveedor: a.meta.supplier ?? null,
                        notas: a.meta.note ?? ''
                    });
                } catch (rbErr) {
                    console.error('❌ Error durante rollback para product_id=' + a.productId, rbErr);
                }
            }
            // UI feedback: mostrar error en la card y restaurar estado
            const cardPedidoNow = document.querySelector(`div[data-pedido-id="${pedidoId}"]`);
            if (cardPedidoNow) {
                cardPedidoNow.classList.remove('procesando');
                const botonNow = cardPedidoNow.querySelector('.btn-entregado');
                if (botonNow) { botonNow.disabled = false; botonNow.innerHTML = '<i class="fas fa-check-circle"></i> Marcar como Entregado'; }
                setCardEstado(cardPedidoNow, 'pendiente', 'Pendiente');
                clearCardNotification(cardPedidoNow);
                showCardNotification(cardPedidoNow, 'error', 'Error procesando entrega. Se intentó rollback; revisa logs.');
            }
            mostrarError('Error al procesar entrega. Se intentó rollback de inventario (revisa logs).');
        } else {
            // Restaurar estado del botón si no hubo cambios que revertir
            const cardPedidoNow = document.querySelector(`div[data-pedido-id="${pedidoId}"]`);
            if (cardPedidoNow) {
                cardPedidoNow.classList.remove('procesando');
                const botonNow = cardPedidoNow.querySelector('.btn-entregado');
                if (botonNow) { botonNow.disabled = false; botonNow.innerHTML = '<i class="fas fa-check-circle"></i> Marcar como Entregado'; }
                setCardEstado(cardPedidoNow, 'pendiente', 'Pendiente');
                clearCardNotification(cardPedidoNow);
                showCardNotification(cardPedidoNow, 'error', `Error al entregar pedido: ${error.message}`);
            }
            mostrarError(`Error al entregar pedido: ${error.message}`);
        }
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
        totalBadge.textContent = new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2
        }).format(totalVentas);
    }
    
    if (productosBadge) {
        productosBadge.textContent = totalProductos;
    }

    // Asegurar que el badge del menú refleje el número de pedidos (ocultar si 0)
    actualizarBadgePedidos(cards.length);
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
 * Muestra una notificación dentro de la card del pedido (procesando/exito/error)
 * @param {HTMLElement} card - Elemento de la card
 * @param {string} type - 'procesando'|'exito'|'error'
 * @param {string} message - Mensaje a mostrar
 */
function showCardNotification(card, type, message) {
    try {
        clearCardNotification(card);
        const note = document.createElement('div');
        note.className = `pedido-notificacion ${type}`;
        const icon = type === 'procesando' ? 'fas fa-spinner fa-spin' : (type === 'exito' ? 'fas fa-check-circle' : 'fas fa-exclamation-circle');
        note.innerHTML = `<i class="${icon}"></i><span>${message}</span>`;
        // Insertar justo antes del footer para que sea visible en la card
        const footer = card.querySelector('.card-footer') || card;
        footer.insertAdjacentElement('beforebegin', note);
        // Auto-remover en éxitos/errores para evitar acumular notificaciones
        if (type === 'exito') {
            setTimeout(() => { note.classList.add('desapareciendo'); setTimeout(() => note.remove(), 300); }, 2500);
        } else if (type === 'error') {
            setTimeout(() => { note.classList.add('desapareciendo'); setTimeout(() => note.remove(), 500); }, 6000);
        }
        return note;
    } catch (e) {
        console.warn('showCardNotification error', e);
        return null;
    }
}

function clearCardNotification(card) {
    try {
        const existing = card.querySelector('.pedido-notificacion');
        if (existing) existing.remove();
    } catch (e) { /* ignore */ }
}

function setCardEstado(card, estado, texto) {
    try {
        const badge = card.querySelector('.estado-badge');
        if (!badge) return;
        badge.classList.remove('estado-pendiente', 'estado-procesando', 'estado-entregado');
        badge.classList.add(`estado-${estado}`);
        if (estado === 'procesando') {
            badge.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${texto || 'Procesando...'}`;
        } else if (estado === 'entregado') {
            badge.innerHTML = `<i class="fas fa-check-circle"></i> ${texto || 'Entregado'}`;
        } else {
            badge.innerHTML = `${texto || 'Pendiente'}`;
        }
    } catch (e) { /* ignore */ }
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
