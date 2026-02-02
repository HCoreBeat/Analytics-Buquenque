/**
 * Cliente API para Inventario Interno
 * Maneja comunicación con backend para datos privados de productos
 * (stock, precio_compra, proveedor, notas, last_updated)
 */

export class InventoryApiClient {
    constructor(backendUrl = null) {
        // Si no se proporciona URL, detectar automáticamente según el entorno
        if (!backendUrl) {
            // En desarrollo: localhost:10000
            // En producción: backend-buquenque.onrender.com
            const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
            if (isDevelopment && window.location.port === '5500') {
                // Ambiente de desarrollo con Live Server
                backendUrl = 'http://localhost:10000';
            } else {
                // Producción o entorno remoto
                backendUrl = 'https://backend-buquenque.onrender.com';
            }
        }
        this.backendUrl = backendUrl;
        this.timeout = 15000; // 15 segundos timeout (más tolerante para Apps Script lentos)
        // Cache en memoria para reducir peticiones repetidas durante la sesión
        this._cache = new Map(); // key -> {data, ts}
        this._cacheTTL = 10 * 60 * 1000; // 10 minutos (evita reconsultas frecuentes)
    }

    /**
     * Obtiene datos privados del inventario para un producto
     * @param {string} productId - ID del producto
     * @returns {Promise<Object>} Datos privados del producto
     */
    async getInventory(productId, { useCache = true, retries = 2 } = {}) {
        if (!productId) {
            throw new Error('El ID del producto es requerido');
        }

        // Revisa cache
        if (useCache && this._cache.has(productId)) {
            const entry = this._cache.get(productId);
            if ((Date.now() - entry.ts) < this._cacheTTL) {
                // console.log(`🧾 Cache hit inventario ${productId}`);
                return entry.data;
            }
            this._cache.delete(productId);
        }

        const url = `${this.backendUrl}/inventario/${productId}`;
        console.log(`🔍 Obteniendo inventario de: ${url}`);

        let attempt = 0;
        while (attempt <= retries) {
            try {
                const response = await this._fetchWithTimeout(url, {
                    method: 'GET',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });

                if (!response.ok) {
                    if (response.status === 404) {
                        console.log(`⚠️ No hay inventario para el producto ${productId}`);
                        const normalized = this._normalizeInventoryData(null, productId);
                        this._cache.set(productId, { data: normalized, ts: Date.now() });
                        return normalized;
                    }
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const rawData = await response.json();
                console.log(`📦 Datos crudos recibidos del backend:`, rawData);

                const normalizedData = this._normalizeInventoryData(rawData, productId);
                console.log(`✅ Datos normalizados:`, normalizedData);

                // Guardar en cache
                this._cache.set(productId, { data: normalizedData, ts: Date.now() });

                return normalizedData;
            } catch (error) {
                attempt++;
                console.error(`❌ Error al obtener inventario del producto ${productId}:`, error.message || error);
                if (attempt > retries) {
                    // No lanzar: devolver objeto vacío normalizado para que la UI no se quede bloqueada.
                    console.warn(`⚠️ Falló obtener inventario para ${productId} después de ${retries} reintentos. Devolviendo objeto vacío normalizado.`);
                    const normalized = this._normalizeInventoryData(null, productId);
                    // Guardar placeholder en cache para evitar reintentos inmediatos
                    this._cache.set(productId, { data: normalized, ts: Date.now() });
                    return normalized;
                }
                // Backoff exponencial (200ms, 400ms, 800ms...)
                const backoff = 200 * Math.pow(2, attempt - 1);
                await new Promise(res => setTimeout(res, backoff));
            }
        }
    }
    
    /**
     * Intenta parsear un valor JSON si es string que contenga JSON
     * @private
     */
    _tryParseJSON(value) {
        if (typeof value !== 'string') return value;
        const trimmed = value.trim();
        if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
        try {
            return JSON.parse(trimmed);
        } catch (e) {
            return value; // no es JSON válido, devolver string original
        }
    }

    /**
     * Extrae un valor primitivo (number|string|null) de estructuras comunes
     * Maneja: número, string, objeto {value: X}, {stock: X}, arrays, etc.
     * @private
     */
    _extractPrimitive(val) {
        if (val === null || val === undefined) return null;
        // Intentar parsear si es string con JSON
        const parsed = this._tryParseJSON(val);
        if (parsed !== val) return this._extractPrimitive(parsed);
        if (typeof parsed === 'number' || typeof parsed === 'string' || typeof parsed === 'boolean') return parsed;
        if (Array.isArray(parsed) && parsed.length > 0) return this._extractPrimitive(parsed[0]);
        if (typeof parsed === 'object') {
            // Buscar campos comunes que podrían contener el valor
            const candidates = ['value','valor','cantidad','stock','amount','precio','precio_compra','price'];
            for (const c of candidates) {
                if (parsed[c] !== undefined) return this._extractPrimitive(parsed[c]);
            }
            // Si no hay candidato, intentar stringify a cadena legible
            try { return JSON.stringify(parsed); } catch (e) { return null; }
        }
        return null;
    }

    /**
     * Normaliza los datos del Google Apps Script al formato esperado
     * Mapea diferentes posibles estructuras de respuesta y parsea strings JSON
     * @param {Object} rawData - Datos crudos del backend
     * @param {string} productId - ID del producto
     * @returns {Object} Datos normalizados
     */
    _normalizeInventoryData(rawData, productId) {
        // Si no hay datos, devolver objeto vacío
        if (!rawData) {
            return {
                product_id: productId,
                stock: null,
                precio_compra: null,
                proveedor: null,
                notas: null,
                last_updated: null,
                hasData: false
            };
        }

        // Si la respuesta viene como string JSON, parsearla
        if (typeof rawData === 'string') {
            const parsed = this._tryParseJSON(rawData);
            if (parsed !== rawData) rawData = parsed;
        }

        // Si la respuesta es un objeto con propiedad 'data' (envoltorio)
        if (rawData.data && typeof rawData.data === 'object') {
            return this._normalizeInventoryData(rawData.data, productId);
        }

        // Si es un array, tomar el primer elemento
        if (Array.isArray(rawData) && rawData.length > 0) {
            return this._normalizeInventoryData(rawData[0], productId);
        }

        // Mapear campos posibles del Google Apps Script y extraer primitivos
        const stockRaw = rawData.stock !== undefined ? rawData.stock : 
                         rawData.Stock !== undefined ? rawData.Stock :
                         rawData.cantidad !== undefined ? rawData.cantidad :
                         rawData.amount !== undefined ? rawData.amount : null;
        const stock = this._extractPrimitive(stockRaw);

        const precioRaw = rawData.precio_compra !== undefined ? rawData.precio_compra :
                         rawData.precio !== undefined ? rawData.precio :
                         rawData.Precio !== undefined ? rawData.Precio :
                         rawData.precioCompra !== undefined ? rawData.precioCompra : null;
        const precioPrincipal = this._extractPrimitive(precioRaw);

        const proveedorRaw = rawData.proveedor !== undefined ? rawData.proveedor :
                         rawData.Proveedor !== undefined ? rawData.Proveedor :
                         rawData.supplier !== undefined ? rawData.supplier : null;
        const proveedor = this._extractPrimitive(proveedorRaw);

        const notasRaw = rawData.notas !== undefined ? rawData.notas :
                     rawData.Notas !== undefined ? rawData.Notas :
                     rawData.notes !== undefined ? rawData.notes : null;
        const notas = this._extractPrimitive(notasRaw);

        const lastUpdatedRaw = rawData.last_updated !== undefined ? rawData.last_updated :
                           rawData.última_actualización !== undefined ? rawData.última_actualización :
                           rawData.updatedAt !== undefined ? rawData.updatedAt :
                           rawData.fecha_actualización !== undefined ? rawData.fecha_actualización : null;
        const lastUpdated = this._extractPrimitive(lastUpdatedRaw);

        // Verificar si hay al menos un dato
        const hasData = (stock !== null && stock !== undefined && stock !== '') || (precioPrincipal !== null && precioPrincipal !== undefined && precioPrincipal !== '') || proveedor !== null || notas !== null;

        return {
            product_id: productId,
            stock: stock !== null ? (isNaN(Number(stock)) ? stock : Number(stock)) : null,
            precio_compra: precioPrincipal !== null ? (isNaN(Number(precioPrincipal)) ? precioPrincipal : Number(precioPrincipal)) : null,
            proveedor: proveedor !== null ? String(proveedor) : null,
            notas: notas !== null ? String(notas) : null,
            last_updated: lastUpdated !== null ? String(lastUpdated) : null,
            hasData: !!hasData,
            rawData: rawData // Debug: incluir datos crudos para inspección
        };
    }

    /**
     * Guarda o actualiza datos privados del inventario
     * @param {string} productId - ID del producto
     * @param {Object} inventoryData - Datos a guardar {stock, precio_compra, proveedor, notas}
     * @returns {Promise<Object>} Respuesta del servidor con datos guardados
     */
    async saveInventory(productId, inventoryData) {
        if (!productId) {
            throw new Error('El ID del producto es requerido');
        }

        if (!inventoryData || typeof inventoryData !== 'object') {
            throw new Error('Los datos del inventario son requeridos y deben ser un objeto');
        }

        try {
            // INVALIDAR CACHE para este producto (para que próxima lectura sea fresca)
            if (this._cache.has(productId)) {
                this._cache.delete(productId);
                console.log(`🗑️ Cache invalidado para producto ${productId}`);
            }
            const url = `${this.backendUrl}/inventario/${productId}`;
            
            const payload = {
                product_id: productId,
                stock: inventoryData.stock !== '' && inventoryData.stock !== null ? parseInt(inventoryData.stock, 10) : null,
                precio_compra: inventoryData.precio_compra !== '' && inventoryData.precio_compra !== null ? parseFloat(inventoryData.precio_compra) : null,
                proveedor: inventoryData.proveedor && inventoryData.proveedor.trim() ? inventoryData.proveedor.trim() : null,
                notas: inventoryData.notas && inventoryData.notas.trim() ? inventoryData.notas.trim() : null
            };

            const response = await this._fetchWithTimeout(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const result = await response.json();
            // Normalizar respuesta y actualizar cache para que próximas lecturas sean consistentes
            const normalized = this._normalizeInventoryData(result && result.data ? result.data : result, productId);
            this._cache.set(productId, { data: normalized, ts: Date.now() });
            return normalized;
        } catch (error) {
            console.error(`Error al guardar inventario del producto ${productId}:`, error);
            throw error;
        }
    }

    /**
     * Elimina datos del inventario para un producto
     * Busca por product_id en la hoja de Google Sheets y elimina la fila correspondiente
     * @param {string} productId - ID del producto a eliminar
     * @returns {Promise<boolean>} true si se eliminó correctamente
     */
    async deleteInventory(productId) {
        if (!productId) {
            throw new Error('El ID del producto es requerido');
        }

        try {
            // Invalidar cache
            if (this._cache.has(productId)) {
                this._cache.delete(productId);
                console.log(`🗑️ Cache invalidado para producto ${productId}`);
            }

            const url = `${this.backendUrl}/inventario/${productId}`;

            const response = await this._fetchWithTimeout(url, {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (response.status === 404) {
                console.log(`ℹ️ Inventario no encontrado para producto ${productId} (probablemente no había datos)`);
                return true;
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            console.log(`✅ Inventario eliminado para producto ${productId}`);
            return true;
        } catch (error) {
            console.error(`Error al eliminar inventario del producto ${productId}:`, error);
            throw error;
        }
    }

    /**
     * Wrapper para fetch con timeout
     * @private
     */
    async _fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Timeout: La solicitud tardó más de ${this.timeout}ms`);
            }
            throw error;
        }
    }

    /**
     * Establece una URL de backend diferente (útil para cambiar entre entornos)
     */
    setBackendUrl(url) {
        this.backendUrl = url;
    }

    /**
     * Intenta obtener inventarios en lote si el backend lo soporta.
     * Si la ruta bulk no está disponible, lanza y el llamador puede volver a la estrategia individual.
     * @param {Array<string>} ids
     * @returns {Promise<Object>} Mapa id => normalizedData
     */
    async getInventoriesBulk(ids = []) {
        if (!Array.isArray(ids)) return {};

        // Revisar cache para respuestas completas
        const result = {};
        const idsToFetch = [];
        ids.forEach(id => {
            const entry = this._cache.get(id);
            if (entry && (Date.now() - entry.ts) < this._cacheTTL) {
                result[id] = entry.data;
            } else {
                idsToFetch.push(id);
            }
        });

        // Si ids está vacío, intentaremos obtener todo el sheet (si el backend lo soporta)
        if (ids.length === 0) {
            try {
                console.log('🔍 getInventoriesBulk: solicitando todos los inventarios (endpoint /inventario)');
                const response = await this._fetchWithTimeout(`${this.backendUrl}/inventario`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
                if (response && response.ok) {
                    const raw = await response.json();
                    let arr = Array.isArray(raw) ? raw : (raw && raw.data && Array.isArray(raw.data) ? raw.data : []);
                    arr.forEach(item => {
                        const id = item.product_id || item.productId || item.id || null;
                        const norm = id ? this._normalizeInventoryData(item, id) : null;
                        if (id && norm) {
                            result[id] = norm;
                            this._cache.set(id, { data: norm, ts: Date.now() });
                        }
                    });
                    return result;
                }
            } catch (err) {
                console.warn('getInventoriesBulk(all) falló:', err.message || err);
            }
            // si falla, continuar al flujo normal con idsToFetch
        }

        if (idsToFetch.length === 0) return result;

        // Probar endpoint bulk: /inventario?ids=id1,id2 or /inventarios?ids=...
        // Priorizar endpoint que devuelva todo el sheet si está disponible
        const tryUrls = [
            `${this.backendUrl}/inventario`,
            `${this.backendUrl}/inventario?ids=${idsToFetch.join(',')}`,
            `${this.backendUrl}/inventarios?ids=${idsToFetch.join(',')}`
        ];

        for (const url of tryUrls) {
            try {
                console.log(`🔍 Intentando obtener inventarios en lote: ${url}`);
                const response = await this._fetchWithTimeout(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
                if (!response.ok) {
                    // si 404, seguir intentando otras rutas
                    console.warn(`Bulk endpoint respondio HTTP ${response.status} para ${url}`);
                    continue;
                }
                const raw = await response.json();
                let arr = [];
                if (Array.isArray(raw)) arr = raw;
                else if (raw && raw.data && Array.isArray(raw.data)) arr = raw.data;
                else if (typeof raw === 'object') {
                    // si viene como objeto mapa id->obj
                    arr = Object.values(raw);
                }

                // Normalizar cada elemento y poblar result + cache
                arr.forEach(item => {
                    const id = item.product_id || item.productId || item.id || null;
                    const norm = id ? this._normalizeInventoryData(item, id) : null;
                    if (id && norm) {
                        result[id] = norm;
                        this._cache.set(id, { data: norm, ts: Date.now() });
                    }
                });

                // Para los ids que no vinieron en la respuesta, poner placeholder
                idsToFetch.forEach(id => {
                    if (!result[id]) {
                        result[id] = this._normalizeInventoryData(null, id);
                        this._cache.set(id, { data: result[id], ts: Date.now() });
                    }
                });

                return result;
            } catch (err) {
                console.warn(`Intento bulk fallido para ${url}:`, err.message || err);
                // probar siguiente URL
            }
        }

        // Si llegamos aquí, ninguno de los endpoints bulk funcionó
        throw new Error('Bulk endpoint no disponible');
    }

    /**
     * Verifica disponibilidad del backend
     */
    async isAvailable() {
        try {
            const response = await this._fetchWithTimeout(`${this.backendUrl}/api/server-status`, {
                method: 'GET'
            });
            return response.ok;
        } catch (error) {
            console.warn('Backend no disponible:', error.message);
            return false;
        }
    }
}

// Export singleton por defecto
export const inventoryApiClient = new InventoryApiClient();
