/**
 * Gestor de Productos con Lógica de Staging
 * Maneja el ciclo completo: Load → Edit/Stage → Sync a GitHub
 */

import { StagingDB } from './stagingDB.js';
import {
    fileToDataURL,
    base64ToDataURL,
    sanitizeFileName,
    objectToBase64,
    base64ToObject,
    isValidImageFile,
    isValidFileSize,
    generateProductId,
    validateProduct,
    createObjectURL,
    revokeObjectURL
} from './inventoryUtils.js';
import { inventoryApiClient } from './inventoryApiClient.js';

const CONFIG = {
    GITHUB_API: {
        REPO_OWNER: "HCoreBeat",
        REPO_NAME: "Buquenque",
        BRANCH: "main",
        PRODUCTS_FILE_PATH: "Json/products.json",
        IMAGE_PATH_PREFIX: "Images/products/"
    }
};

export class ProductManager {
    constructor(githubManager = null) {
        this.products = []; // Productos originales cargados de GitHub
        this.stagingDB = new StagingDB();
        this.githubManager = githubManager;
        this.stagedChanges = []; // Array de cambios en staging
        this.isLoading = false;
        this.lastSync = null;
        this._lastLoadTs = null; // timestamp de última carga de productos
        this._loadingInventories = false; // indicador para mostrar 'Cargando...' en tarjetas
        this._lastInventoryLoadTs = null; // timestamp de última carga de inventarios

        this.loadStagedChanges();
    }

    /**
     * Inicializa el ProductManager
     */
    async init() {
        await this.stagingDB.initStagingDB();
        console.log('ProductManager inicializado');
    }

    /**
     * Carga productos desde GitHub con anti-caché y throttling
     * @param {boolean} force - Forzar recarga desde el servidor ignorando cache TTL
     * @returns {Promise<Array>}
     */
    async loadProducts(force = false) {
        if (this.isLoading) return this.products;

        // TTL para evitar recargas constantes
        const TTL = 60 * 1000; // 60s
        if (!force && this._lastLoadTs && (Date.now() - this._lastLoadTs) < TTL) {
            console.log('📌 loadProducts: usando cache local (TTL no expirado)');
            return this.products;
        }

        this.isLoading = true;
        try {
            // URL con timestamp para evitar caché
            const url = `${this.getProductsFileUrl()}?t=${Date.now()}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();

            // Validar estructura
            if (data.products && Array.isArray(data.products)) {
                this.products = data.products;
                this.normalizeProducts();
                // Enriquecer productos con datos de inventario (stock, precio_compra)
                // Hacer en background para no bloquear render inicial. Evitar iniciar si ya está corriendo o si se cargó recientemente.
                const INV_TTL = 60 * 1000; // 60s
                if (!this._loadingInventories && (!this._lastInventoryLoadTs || (Date.now() - this._lastInventoryLoadTs) > INV_TTL)) {
                    this._loadInventoriesForProducts()
                        .then(() => { this._lastInventoryLoadTs = Date.now(); console.log('Carga de inventarios finalizada'); })
                        .catch(e => console.warn('Error al cargar inventarios de productos:', e));
                } else {
                    console.log('Carga de inventarios ya en progreso o se cargó recientemente, no iniciar otra');
                }
            } else {
                throw new Error('Estructura JSON inválida: se esperaba { products: [...] }');
            }

            this._lastLoadTs = Date.now();
            this.isLoading = false;
            console.log(`${this.products.length} productos cargados desde GitHub`);
            return this.products;
        } catch (error) {
            this.isLoading = false;
            console.error('Error al cargar productos:', error);
            throw error;
        }
    }

    /**
     * Normaliza estructura de productos
     */
    normalizeProducts() {
        this.products.forEach((product) => {
            // Generar ID si no existe
            if (!product.id) {
                product.id = generateProductId();
            }
            
            // Normalizar precio
            product.precio = parseFloat(product.precio) || 0;
            product.descuento = parseFloat(product.descuento) || 0;
            
            // Calcular precio final solo si tiene oferta
            if (product.oferta === true) {
                const precioConDescuento = product.precio * (1 - product.descuento / 100);
                product.precioFinal = parseFloat(precioConDescuento.toFixed(2));
            } else {
                product.precioFinal = product.precio;
            }
            
            // Normalizar disponibilidad
            product.disponibilidad = product.disponibilidad !== false;
            
            // Crear URL de imagen
            if (product.imagenes && Array.isArray(product.imagenes) && product.imagenes.length > 0) {
                product.imagenUrl = `${this.getImageUrl(product.imagenes[0])}`;
            } else {
                product.imagenUrl = 'Img/no_image.jpg';
            }
            
            // Crear campo de búsqueda
            product.searchText = `${product.nombre} ${product.categoria} ${product.descripcion || ''}`.toLowerCase();
            // Normalizar timestamps si existen o mapear campo legacy 'hora'
            product.created_at = product.created_at || product.hora || null;
            product.modified_at = product.modified_at || product.created_at || null;
            // Inicializar datos de inventario por defecto (se llenarán al cargar productos)
            product.inventory = null;
            product.stock = null;
            product.precio_compra = null;
        });
    }

    /**
     * Carga datos de inventario para cada producto (no bloquea si algunos fallan)
     * @param {number} concurrency - Número de peticiones paralelas por lote
     */
    async _loadInventoriesForProducts(concurrency = 10) {
        const prods = this.products || [];
        if (!prods.length) return;

        this._loadingInventories = true;

        try {
            // Intentar bulk primero (si el backend soporta devolver todo)
            const ids = prods.map(p => p.id);
            try {
                const bulk = await inventoryApiClient.getInventoriesBulk(ids);
                let enrichedCount = 0;
                prods.forEach(p => {
                    const inv = bulk[p.id];
                    if (inv && inv.hasData) {
                        p.inventory = inv;
                        p.stock = inv.stock !== undefined ? inv.stock : null;
                        p.precio_compra = inv.precio_compra !== undefined ? inv.precio_compra : null;
                        enrichedCount++;
                    } else {
                        p.inventory = null;
                        p.stock = null;
                        p.precio_compra = null;
                    }
                });
                console.log(`📦 Inventario (bulk): ${enrichedCount}/${prods.length} productos enriquecidos con datos`);
                // Notificar UI que hay actualizaciones (todos a la vez)
                document.dispatchEvent(new CustomEvent('inventories:updated', { detail: { ids } }));
                return;
            } catch (err) {
                console.warn('Bulk inventories no disponible, usando fallback individual por chunks', err.message || err);
            }

            // Fallback individual con concurrencia por chunks (con soft-timeout por producto y actualizaciones progresivas)
            let enrichedCount = 0;
            const SOFT_TIMEOUT_MS = 3000; // si una petición individual tarda más, actualizamos UI con placeholder y esperamos la respuesta en background
            for (let i = 0; i < prods.length; i += concurrency) {
                const chunk = prods.slice(i, i + concurrency);
                await Promise.all(chunk.map((product) => {
                    const invPromise = inventoryApiClient.getInventory(product.id, { retries: 1, useCache: true }).catch(err => {
                        console.warn(`getInventory falló (se devolverá placeholder) para ${product.id}:`, err && err.message ? err.message : err);
                        // Devolver placeholder normalizado para no romper el flujo
                        return { product_id: product.id, stock: null, precio_compra: null, proveedor: null, notas: null, last_updated: null, hasData: false };
                    });

                    const softTimeout = new Promise(res => setTimeout(() => res('__INVENTORY_SOFT_TIMEOUT__'), SOFT_TIMEOUT_MS));

                    return Promise.race([invPromise, softTimeout]).then(async (result) => {
                        if (result === '__INVENTORY_SOFT_TIMEOUT__') {
                            // Mostrar placeholder inmediatamente para no dejar la tarjeta bloqueada
                            product.inventory = product.inventory || null;
                            product.stock = (product.stock !== undefined && product.stock !== null) ? product.stock : null;
                            product.precio_compra = (product.precio_compra !== undefined && product.precio_compra !== null) ? product.precio_compra : null;
                            // Notificar UI que este producto tiene una actualización (placeholder)
                            document.dispatchEvent(new CustomEvent('inventories:updated', { detail: { ids: [product.id] } }));

                            // Esperar el invPromise en background y actualizar cuando llegue
                            try {
                                const invFinal = await invPromise;
                                if (invFinal && invFinal.hasData) {
                                    product.inventory = invFinal;
                                    product.stock = invFinal.stock !== undefined ? invFinal.stock : null;
                                    product.precio_compra = invFinal.precio_compra !== undefined ? invFinal.precio_compra : null;
                                    enrichedCount++;
                                } else {
                                    product.inventory = null;
                                    product.stock = null;
                                    product.precio_compra = null;
                                }
                                // Notificar UI con los datos finales cuando estén disponibles
                                document.dispatchEvent(new CustomEvent('inventories:updated', { detail: { ids: [product.id] } }));
                            } catch (err) {
                                console.warn(`Error resolviendo invPromise en background para ${product.id}:`, err && err.message ? err.message : err);
                            }
                        } else {
                            // Resultado inmediato (invPromise resolvió rápido)
                            const inv = result;
                            if (inv && inv.hasData) {
                                product.inventory = inv;
                                product.stock = inv.stock !== undefined ? inv.stock : null;
                                product.precio_compra = inv.precio_compra !== undefined ? inv.precio_compra : null;
                                enrichedCount++;
                            } else {
                                product.inventory = null;
                                product.stock = null;
                                product.precio_compra = null;
                            }
                        }
                    }).catch(err => {
                        console.warn(`No se pudo cargar inventario para ${product.id}:`, err && err.message ? err.message : err);
                        product.inventory = null;
                        product.stock = null;
                        product.precio_compra = null;
                    });
                }));
                // Notificar UI tras cada chunk para render progresivo (ids del chunk)
                const idsUpdated = chunk.map(p => p.id);
                document.dispatchEvent(new CustomEvent('inventories:updated', { detail: { ids: idsUpdated } }));
            }
            console.log(`📦 Inventario (fallback): ${enrichedCount}/${prods.length} productos enriquecidos con datos`);
        } finally {
            this._loadingInventories = false;
            this._lastInventoryLoadTs = Date.now();
        }
    }

    /**
     * Crea un cambio en staging (nuevo, modificado, eliminado)
     * @param {string} type - 'new', 'modify', 'delete'
     * @param {Object} productData - Datos del producto
     * @param {File} imageFile - Archivo de imagen (opcional)
     * @returns {Promise<Object>} - Cambio creado
     */
    async stageChange(type, productData, imageFile = null) {
        // Validar tipo de cambio
        if (!['new', 'modify', 'delete'].includes(type)) {
            throw new Error('Tipo de cambio inválido');
        }

        // Validar datos del producto
        const validation = validateProduct(productData);
        if (!validation.isValid) {
            throw new Error(`Producto inválido: ${validation.errors.join(', ')}`);
        }

        // Generar ID si es nuevo (asegurar unicidad respecto a productos actuales y cambios staged)
        if (type === 'new' && !productData.id) {
            let newId;
            const exists = (id) => {
                return this.products.some(p => p.id === id) || this.stagedChanges.some(c => c.productId === id) || this.stagedChanges.some(c => c.productData && c.productData.id === id);
            };
            do {
                newId = generateProductId();
            } while (exists(newId));
            productData.id = newId;
        }

        // Si es modificación, guardar el nombre original para referencia
        let originalProductName = null;
        if (type === 'modify') {
            const existingProduct = this.products.find(p => p.id === productData.id);
            if (existingProduct) {
                originalProductName = existingProduct.nombre;
            }
        }

        const change = {
            id: `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type,
            timestamp: Date.now(),
            productId: productData.id,
            productData: JSON.parse(JSON.stringify(productData)), // Deep copy
            originalProductName: originalProductName, // Guardar nombre original para búsqueda
            hasNewImage: false,
            imageKey: null,
            originalImagePath: null
        };

        // Procesar imagen si existe
        if (imageFile) {
            if (!isValidImageFile(imageFile)) {
                throw new Error('El archivo debe ser una imagen válida (JPEG, PNG, GIF, WebP)');
            }

            if (!isValidFileSize(imageFile)) {
                throw new Error('El archivo excede 5MB');
            }

            try {
                // Convertir a Base64
                const base64 = await fileToDataURL(imageFile);

                // Generar clave única
                const imageKey = sanitizeFileName(imageFile.name);
                change.imageKey = imageKey;
                change.hasNewImage = true;

                // Guardar en IndexedDB
                await this.stagingDB.saveImageToIDB(imageKey, base64);

                // Actualizar ruta de imagen en producto
                change.productData.imagenes = [imageKey];

                console.log(`Imagen procesada y guardada: ${imageKey}`);
            } catch (error) {
                console.error('Error procesando imagen:', error);
                throw error;
            }
        }

        // Guardar cambio en staged_changes
        this.stagedChanges.push(change);
        this.saveStagedChanges();

        return change;
    }

    /**
     * Obtiene los cambios en staging
     * @returns {Array}
     */
    getStagedChanges() {
        return this.stagedChanges;
    }

    /**
     * Obtiene estadísticas de cambios en staging
     * @returns {Object}
     */
    getStagingStats() {
        const stats = {
            total: this.stagedChanges.length,
            new: this.stagedChanges.filter(c => c.type === 'new').length,
            modify: this.stagedChanges.filter(c => c.type === 'modify').length,
            delete: this.stagedChanges.filter(c => c.type === 'delete').length,
            withImages: this.stagedChanges.filter(c => c.hasNewImage).length
        };
        return stats;
    }

    /**
     * Descarta un cambio en staging
     * @param {string} changeId - ID del cambio
     * @returns {Promise}
     */
    async discardChange(changeId) {
        const changeIndex = this.stagedChanges.findIndex(c => c.id === changeId);
        if (changeIndex === -1) {
            throw new Error('Cambio no encontrado');
        }

        const change = this.stagedChanges[changeIndex];

        // Eliminar imagen de IndexedDB si existe
        if (change.imageKey) {
            await this.stagingDB.deleteImageFromIDB(change.imageKey);
        }

        // Remover del array
        this.stagedChanges.splice(changeIndex, 1);
        this.saveStagedChanges();

        return true;
    }

    /**
     * Descarta todos los cambios en staging
     * @returns {Promise}
     */
    async discardAllChanges() {
        // Limpiar todas las imágenes de IDB
        await this.stagingDB.clearAllImages();

        // Vaciar array
        this.stagedChanges = [];
        this.saveStagedChanges();

        return true;
    }

    /**
     * Sincroniza todos los cambios con GitHub
     * @returns {Promise<Object>} - Resultado de sincronización
     */
    async saveAllStagedChanges(progressCallback = null) {
        if (!this.githubManager) {
            throw new Error('GitHubManager no está configurado');
        }

        if (!this.githubManager.isConfigured()) {
            throw new Error('Token de GitHub no configurado');
        }

        if (this.stagedChanges.length === 0) {
            return { success: true, message: 'No hay cambios para sincronizar' };
        }

        try {
            // 1. Procesar cambios
            const processedProducts = JSON.parse(JSON.stringify(this.products));

            // helper para reportar progreso de manera segura
            const report = (percent, message) => {
                try { if (typeof progressCallback === 'function') progressCallback(percent, message); } catch(e) { console.warn('progressCallback error', e); }
            };

            report(5, 'Iniciando procesamiento de cambios...');

            let processedCount = 0;
            // Acumulador de guardados de inventario que se ejecutarán tras subir el archivo de productos a GitHub
            const pendingInventorySaves = [];
            // Resumen de resultados de guardado de inventario (disponible al final del método)
            let inventorySaveSummary = { succeeded: [], failed: [] };
            for (const change of this.stagedChanges) {
                console.log(`Procesando cambio: ${change.type} - ${change.productId}`);

                processedCount++;
                report(Math.round((processedCount / this.stagedChanges.length) * 50), `Procesando cambios (${processedCount}/${this.stagedChanges.length})...`);

                // 2. Subir imágenes nuevas/modificadas
                if (change.hasNewImage && change.imageKey) {
                    const imageData = await this.stagingDB.getImageFromIDB(change.imageKey);
                    if (imageData) {
                        const uploadPath = `${CONFIG.GITHUB_API.IMAGE_PATH_PREFIX}${change.imageKey}`;
                        const uploadResult = await this.githubManager.uploadFile(
                            uploadPath,
                            imageData.base64
                        );
                        console.log(`Imagen subida: ${uploadPath}`);
                        report(null, `Imagen subida: ${change.imageKey}`);
                    }
                }

                // 3. Aplicar cambios al array de productos
                if (change.type === 'new') {
                    // Validar que no exista duplicado
                    const exists = processedProducts.some(p => p.nombre === change.productData.nombre);
                    if (!exists) {
                        const productToAdd = this.prepareProductForExport(change.productData);
                        // Asignar timestamps de creación/modificación al agregar nuevo
                        const nowIso = new Date().toISOString();
                        productToAdd.created_at = productToAdd.created_at || nowIso;
                        productToAdd.modified_at = productToAdd.modified_at || nowIso;
                        processedProducts.push(productToAdd);
                        
                        // Si el producto nuevo incluye datos del bloque "Inventario Interno" en el modal,
                        // acumular la petición de guardado para ejecutarla DESPUÉS de subir el archivo de productos.
                        try {
                            const invCandidates = {
                                stock: ['stock', 'inventory_stock', 'inventory-stock', 'inventoryStock'],
                                precio_compra: ['precio_compra', 'inventory_precio_compra', 'inventory-precio-compra', 'inventoryPrecioCompra'],
                                proveedor: ['proveedor', 'inventory_proveedor', 'inventory-proveedor', 'inventoryProveedor'],
                                notas: ['notas', 'inventory_notas', 'inventory-notas', 'inventoryNotas']
                            };
                            const getFirst = (obj, keys) => {
                                for (const k of keys) {
                                    if (obj && obj.hasOwnProperty(k) && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
                                }
                                return null;
                            };

                            const hasInv = Object.values(invCandidates).some(keys => getFirst(change.productData, keys) !== null);
                            if (hasInv) {
                                // Asegurar que el producto tenga ID (generar si por alguna razón faltara)
                                let productId = productToAdd.id || change.productData.id;
                                if (!productId) {
                                    if (typeof generateProductId === 'function') {
                                        productId = generateProductId();
                                    } else {
                                        productId = `${Date.now()}_${Math.random().toString(36).substr(2,9)}`;
                                    }
                                    // Actualizar referencias
                                    productToAdd.id = productId;
                                    change.productData.id = productId;
                                    change.productId = productId;
                                    // Actualizar el producto en processedProducts si fue añadido sin id
                                    const idxNoId = processedProducts.findIndex(p => p.nombre === productToAdd.nombre && (!p.id || p.id === undefined));
                                    if (idxNoId !== -1) processedProducts[idxNoId].id = productId;
                                }

                                const invPayload = {
                                    stock: getFirst(change.productData, invCandidates.stock),
                                    precio_compra: getFirst(change.productData, invCandidates.precio_compra),
                                    proveedor: getFirst(change.productData, invCandidates.proveedor),
                                    notas: getFirst(change.productData, invCandidates.notas)
                                };

                                pendingInventorySaves.push({ productId, invPayload, name: productToAdd.nombre, changeId: change.id });
                                console.log(`Inventario pendiente para producto nuevo ${productToAdd.nombre} (${productId})`);
                            }
                        } catch (err) {
                            console.warn(`Error detectando inventario en producto nuevo ${change.productData && change.productData.nombre}:`, err && err.message ? err.message : err);
                        }
                        console.log(`Producto nuevo agregado: ${change.productData.nombre}`);
                    } else {
                        console.warn(`Producto duplicado detectado, saltando: ${change.productData.nombre}`);
                    }
                } else if (change.type === 'modify') {
                    // Búsqueda por nombre original o por nombre actual
                    const searchName = change.originalProductName || change.productData.nombre;
                    const index = processedProducts.findIndex(p => p.nombre === searchName);
                    
                    if (index !== -1) {
                        const productToUpdate = this.prepareProductForExport(change.productData);
                        // Conservar fecha de creación existente si la tiene
                        const existing = processedProducts[index] || {};
                        productToUpdate.created_at = productToUpdate.created_at || existing.created_at || existing.hora || null;
                        // Actualizar modified_at
                        productToUpdate.modified_at = new Date().toISOString();
                        processedProducts[index] = productToUpdate;
                        console.log(`Producto modificado: ${change.productData.nombre}`);

                        // Si el cambio contiene datos del bloque "Inventario Interno", acumularlos para guardarlos tras la subida
                        try {
                            const invCandidates = {
                                stock: ['stock', 'inventory_stock', 'inventory-stock', 'inventoryStock'],
                                precio_compra: ['precio_compra', 'inventory_precio_compra', 'inventory-precio-compra', 'inventoryPrecioCompra'],
                                proveedor: ['proveedor', 'inventory_proveedor', 'inventory-proveedor', 'inventoryProveedor'],
                                notas: ['notas', 'inventory_notas', 'inventory-notas', 'inventoryNotas']
                            };
                            const getFirst = (obj, keys) => {
                                for (const k of keys) {
                                    if (obj && obj.hasOwnProperty(k) && obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
                                }
                                return null;
                            };

                            const hasInv = Object.values(invCandidates).some(keys => getFirst(change.productData, keys) !== null);
                            if (hasInv) {
                                const productId = productToUpdate.id || change.productData.id;
                                if (!productId) {
                                    console.warn('No se encontró ID para producto modificado; no se guardará inventario');
                                } else {
                                    const invPayload = {
                                        stock: getFirst(change.productData, invCandidates.stock),
                                        precio_compra: getFirst(change.productData, invCandidates.precio_compra),
                                        proveedor: getFirst(change.productData, invCandidates.proveedor),
                                        notas: getFirst(change.productData, invCandidates.notas)
                                    };

                                    pendingInventorySaves.push({ productId, invPayload, name: productToUpdate.nombre, changeId: change.id });
                                    console.log(`Inventario pendiente para producto modificado ${productToUpdate.nombre} (${productId})`);
                                }
                            }
                        } catch (err) {
                            console.warn(`Error detectando inventario en producto modificado ${change.productData && change.productData.nombre}:`, err && err.message ? err.message : err);
                        }

                        // Si se subió una nueva imagen, intentar eliminar la imagen anterior del repo
                        try {
                            if (change.hasNewImage && existing && Array.isArray(existing.imagenes) && existing.imagenes.length > 0) {
                                const oldImages = existing.imagenes.filter(n => !!n && n !== change.imageKey);
                                for (const oldImg of oldImages) {
                                    const oldPath = `${CONFIG.GITHUB_API.IMAGE_PATH_PREFIX}${oldImg}`;
                                    try {
                                        await this.githubManager.deleteFileFromRepo(oldPath, `Eliminar imagen antigua ${oldImg} al modificar producto ${change.productData.nombre}`);
                                        console.log(`Imagen antigua eliminada: ${oldPath}`);
                                    } catch (err) {
                                        console.warn(`No se pudo eliminar imagen antigua ${oldImg}:`, err.message || err);
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('Error al intentar eliminar imagen anterior durante modify:', err);
                        }
                    } else {
                        console.error(`Producto no encontrado para modificar: ${searchName}`);
                        throw new Error(`No se pudo encontrar el producto "${searchName}" para modificar`);
                    }
                } else if (change.type === 'delete') {
                    // Búsqueda por nombre original o por nombre actual
                    const searchName = change.originalProductName || change.productData.nombre;
                    const index = processedProducts.findIndex(p => p.nombre === searchName);
                    
                    if (index !== -1) {
                        const prod = processedProducts[index];
                        const productId = prod.id || change.productData.id;
                        
                        // Antes de eliminar del array, intentar eliminar las imágenes asociadas en el repo
                        try {
                            if (prod && Array.isArray(prod.imagenes) && prod.imagenes.length > 0) {
                                for (const imgName of prod.imagenes) {
                                    if (!imgName) continue;
                                    const imgPath = `${CONFIG.GITHUB_API.IMAGE_PATH_PREFIX}${imgName}`;
                                    try {
                                        await this.githubManager.deleteFileFromRepo(imgPath, `Eliminar imagen ${imgName} al borrar producto ${searchName}`);
                                        console.log(`Imagen eliminada: ${imgPath}`);
                                    } catch (err) {
                                        console.warn(`No se pudo eliminar imagen ${imgName}:`, err.message || err);
                                    }
                                }
                            }
                        } catch (err) {
                            console.warn('Error al intentar eliminar imágenes asociadas durante delete:', err);
                        }

                        // Acumular eliminación de inventario para ejecutarla tras subir a GitHub
                        if (productId) {
                            pendingInventorySaves.push({
                                productId,
                                invPayload: null, // null indica que es una eliminación
                                name: searchName,
                                changeId: change.id,
                                isDelete: true
                            });
                            console.log(`Eliminación de inventario pendiente para ${searchName} (${productId})`);
                        }

                        processedProducts.splice(index, 1);
                        console.log(`Producto eliminado: ${searchName}`);
                    } else {
                        console.error(`Producto no encontrado para eliminar: ${searchName}`);
                        throw new Error(`No se pudo encontrar el producto "${searchName}" para eliminar`);
                    }
                }
            }

            // 4. Convertir array final a JSON Base64
            // IMPORTANTE: Mantener la estructura exacta original { "products": [...] }
            // SANITIZAR: Asegurarse de que ningún producto contenga campos de inventario antes de exportar
            const sanitizedProducts = processedProducts.map(p => {
                try {
                    // prepareProductForExport filtra campos no permitidos y preserva id si existe
                    return this.prepareProductForExport(p);
                } catch (err) {
                    console.warn('prepareProductForExport falló para producto', p && p.id, err && err.message ? err.message : err);
                    // Fallback seguro: construir un objeto mínimo y limpio
                    return {
                        id: p && p.id ? String(p.id) : (typeof generateProductId === 'function' ? generateProductId() : undefined),
                        nombre: p && p.nombre ? String(p.nombre) : 'Sin nombre',
                        categoria: p && p.categoria ? String(p.categoria) : '',
                        precio: p && (p.precio !== undefined) ? parseFloat(p.precio) || 0 : 0,
                        descuento: p && (p.descuento !== undefined) ? parseFloat(p.descuento) || 0 : 0,
                        mas_vendido: Boolean(p && p.mas_vendido),
                        nuevo: Boolean(p && p.nuevo),
                        oferta: Boolean(p && p.oferta),
                        imagenes: Array.isArray(p && p.imagenes) ? p.imagenes : [],
                        descripcion: String((p && p.descripcion) || '').trim(),
                        disponibilidad: p && p.disponibilidad !== false,
                        created_at: p && (p.created_at || p.hora) ? (p.created_at || p.hora) : null,
                        modified_at: p && (p.modified_at || p.hora) ? (p.modified_at || p.hora) : null
                    };
                }
            });

            // Última defensa: eliminar cualquier campo 'inventory' inesperado que pueda quedar
            sanitizedProducts.forEach(p => {
                if (p && p.inventory !== undefined) {
                    console.warn('⚠️ Se eliminó campo inesperado `inventory` antes de exportar para product', p.id);
                    delete p.inventory;
                }
            });

            const fileContent = {
                products: sanitizedProducts
            };

            // Validar que la estructura es correcta antes de guardar
            if (!Array.isArray(fileContent.products)) {
                throw new Error('Error crítico: La estructura de productos no es un array válido');
            }

            // Validar que se pueden serializar correctamente
            // Preparar variable para el resultado de subida
            let uploadResult = null;

            try {
                const jsonString = JSON.stringify(fileContent, null, 2);
                
                // Re-parsear para validar integridad
                const reParsed = JSON.parse(jsonString);
                if (!reParsed.products || !Array.isArray(reParsed.products)) {
                    throw new Error('JSON no es válido después de serialización');
                }
                
                if (reParsed.products.length !== processedProducts.length) {
                    throw new Error(`Mismatch de cantidad de productos: esperaba ${processedProducts.length}, obtuve ${reParsed.products.length}`);
                }
                
                console.log(`✓ JSON validado correctamente con ${reParsed.products.length} productos`);
                console.log(`JSON (primeros 500 caracteres):`, jsonString.substring(0, 500));
                
                const base64Content = btoa(unescape(encodeURIComponent(jsonString)));
                
                // 5. Subir archivo de productos a GitHub
                report(75, 'Subiendo archivo de productos a la base de datos...');
                uploadResult = await this.githubManager.uploadFile(
                    CONFIG.GITHUB_API.PRODUCTS_FILE_PATH,
                    base64Content,
                    `Actualizar inventario - ${processedProducts.length} productos (${this.stagedChanges.length} cambios)`
                );
                
                console.log(`✓ Archivo subido a la base de datos correctamente`);
                report(95, 'Archivo de productos subido. Finalizando...');

                // 5.b Guardar inventarios pendientes (si los hay) AHORA que el archivo ya está en GitHub
                const inventorySaveSummary = { succeeded: [], failed: [], localStorageRecovered: [] };
                
                // Recuperar respaldos de inventario del localStorage (si backend no estaba disponible al crear)
                const localStorageInventories = this._getPendingInventoryFromLocalStorage();
                console.log(`📦 Recuperados ${Object.keys(localStorageInventories).length} respaldos de inventario del localStorage`);
                
                // Combinar: pendientes del staging + recuperados del localStorage
                const allInventorySaves = [
                    ...pendingInventorySaves,
                    ...Object.entries(localStorageInventories).map(([productId, invPayload]) => ({
                        productId,
                        invPayload,
                        name: processedProducts.find(p => p.id === productId)?.nombre || productId,
                        fromLocalStorage: true
                    }))
                ];
                
                if (allInventorySaves.length > 0) {
                    for (const item of allInventorySaves) {
                        try {
                            // Si invPayload es null, es una eliminación
                            if (item.isDelete) {
                                await inventoryApiClient.deleteInventory(item.productId);
                                inventorySaveSummary.succeeded.push({ productId: item.productId, name: item.name, action: 'delete' });
                                console.log(`✅ Inventario eliminado para producto ${item.name} (${item.productId})`);
                            } else {
                                const saved = await inventoryApiClient.saveInventory(item.productId, item.invPayload);
                                // Adjuntar inventario normalizado al producto en memoria
                                const idx = processedProducts.findIndex(p => p.id === item.productId);
                                if (idx !== -1) processedProducts[idx].inventory = saved;
                                
                                if (item.fromLocalStorage) {
                                    inventorySaveSummary.localStorageRecovered.push({ productId: item.productId, name: item.name });
                                    this._removeInventoryFromLocalStorage(item.productId);
                                    console.log(`✅ Inventario recuperado del localStorage y guardado para ${item.name} (${item.productId})`);
                                } else {
                                    inventorySaveSummary.succeeded.push({ productId: item.productId, name: item.name });
                                    console.log(`Inventario guardado post-upload para ${item.name} (${item.productId})`);
                                }
                            }
                        } catch (err) {
                            inventorySaveSummary.failed.push({ productId: item.productId, name: item.name, error: err && err.message ? err.message : String(err) });
                            console.warn(`No se pudo procesar inventario para ${item.name} (${item.productId}):`, err && err.message ? err.message : err);
                            // No limpiar del localStorage si falla, para reintentar después
                        }
                    }
                    console.log(`📊 Resumen inventario - Exitosos: ${inventorySaveSummary.succeeded.length} | Recuperados: ${inventorySaveSummary.localStorageRecovered.length} | Fallidos: ${inventorySaveSummary.failed.length}`);
                }
            } catch (error) {
                console.error('Error validando o serializando JSON:', error);
                throw error;
            }

            // 6. Limpiar localStorage e IndexedDB
            await this.discardAllChanges();
            this.lastSync = new Date();

            report(100, 'Sincronización completada');
            return {
                success: true,
                message: 'Todos los cambios han sido sincronizados con la base de datos',
                filesUpdated: this.stagedChanges.length + 1, // +1 por el archivo de productos
                commitSha: uploadResult?.commit?.sha || null,
                inventorySaveSummary
            };
        } catch (error) {
            console.error('Error sincronizando cambios:', error);
            throw error;
        }
    }

    /**
     * Guarda cambios en localStorage
     */
    saveStagedChanges() {
        // Solo guardar metadatos, no imágenes
        const stagedMetadata = this.stagedChanges.map(change => ({
            id: change.id,
            type: change.type,
            timestamp: change.timestamp,
            productId: change.productId,
            productData: change.productData,
            hasNewImage: change.hasNewImage,
            imageKey: change.imageKey
        }));

        localStorage.setItem('buquenque_staged_changes', JSON.stringify(stagedMetadata));
    }

    /**
     * Carga cambios desde localStorage
     */
    loadStagedChanges() {
        const stored = localStorage.getItem('buquenque_staged_changes');
        if (stored) {
            try {
                const metadata = JSON.parse(stored);
                this.stagedChanges = metadata.map(meta => ({
                    ...meta,
                    id: meta.id || `change_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
                }));
                console.log(`${this.stagedChanges.length} cambios cargados desde localStorage`);
            } catch (error) {
                console.warn('Error cargando cambios:', error);
                this.stagedChanges = [];
            }
        }
    }

    /**
     * Obtiene URL del archivo de productos en GitHub
     * @returns {string}
     */
    getProductsFileUrl() {
        return `https://raw.githubusercontent.com/${CONFIG.GITHUB_API.REPO_OWNER}/${CONFIG.GITHUB_API.REPO_NAME}/${CONFIG.GITHUB_API.BRANCH}/${CONFIG.GITHUB_API.PRODUCTS_FILE_PATH}`;
    }

    /**
     * Obtiene URL de imagen
     * @param {string} imageName - Nombre de la imagen
     * @returns {string}
     */
    getImageUrl(imageName) {
        return `https://raw.githubusercontent.com/${CONFIG.GITHUB_API.REPO_OWNER}/${CONFIG.GITHUB_API.REPO_NAME}/${CONFIG.GITHUB_API.BRANCH}/${CONFIG.GITHUB_API.IMAGE_PATH_PREFIX}${imageName}`;
    }

    /**
     * Busca productos
     * @param {string} searchTerm
     * @returns {Array}
     */
    searchProducts(searchTerm) {
        const term = searchTerm.toLowerCase();
        return this.products.filter(p => p.searchText.includes(term));
    }

    /**
     * Filtra por categoría
     * @param {string} category
     * @returns {Array}
     */
    filterByCategory(category) {
        if (!category || category === 'todos') {
            return this.products;
        }
        return this.products.filter(p => p.categoria.toLowerCase() === category.toLowerCase());
    }

    /**
     * Obtiene todas las categorías únicas
     * @returns {Array}
     */
    getAllCategories() {
        const categories = new Set(this.products.map(p => p.categoria));
        return Array.from(categories).sort();
    }

    /**
     * Obtiene un producto por ID
     * @param {string} productId
     * @returns {Object|null}
     */
    getProductById(productId) {
        return this.products.find(p => p.id === productId) || null;
    }

    /**
     * Prepara un producto para exportar a JSON (sin campos internos)
     * @param {Object} productData - Datos del producto
     * @returns {Object} - Producto formateado para exportar
     */
    /**
     * Prepara un producto para exportar a JSON (limpia campos internos, valida tipos)
     * IMPORTANTE: Esta función SOLO exporta campos de PRODUCTO, NUNCA campos de INVENTARIO
     * @param {Object} productData - Datos del producto
     * @returns {Object} - Producto listo para guardar en JSON
     */
    prepareProductForExport(productData) {
        // Validar campos requeridos
        if (!productData.nombre || typeof productData.nombre !== 'string') {
            throw new Error('El campo "nombre" es requerido y debe ser texto');
        }
        
        if (!productData.categoria || typeof productData.categoria !== 'string') {
            throw new Error('El campo "categoria" es requerido y debe ser texto');
        }
        
        if (productData.precio === undefined || productData.precio === null) {
            throw new Error('El campo "precio" es requerido');
        }

        // SEGURIDAD: Verificar que NO hay campos de inventario siendo incluidos
        const forbiddenFields = ['stock', 'precio_compra', 'proveedor', 'notas', 'last_updated', 'inventory', 'inventory_stock', 'inventory_precio_compra', 'inventory_proveedor', 'inventory_notas'];
        const hasInventoryFields = forbiddenFields.some(field => productData.hasOwnProperty(field) && productData[field] !== undefined && productData[field] !== null);
        
        if (hasInventoryFields) {
            // Campos de inventario detectados: serán descartados automáticamente por la whitelist.
        }

        // WHITELIST: Solo estos campos se exportan a GitHub
        return {
            id: productData.id ? String(productData.id) : undefined,
            nombre: String(productData.nombre).trim(),
            categoria: String(productData.categoria).trim(),
            precio: parseFloat(productData.precio),
            descuento: parseFloat(productData.descuento || 0),
            mas_vendido: Boolean(productData.mas_vendido || false),
            nuevo: Boolean(productData.nuevo || false),
            oferta: Boolean(productData.oferta || false),
            imagenes: Array.isArray(productData.imagenes) ? productData.imagenes : [],
            descripcion: String(productData.descripcion || '').trim(),
            disponibilidad: productData.disponibilidad !== false,
            // Mantener timestamps si vienen en los datos. Si no, quedarán null
            created_at: productData.created_at || productData.hora || null,
            modified_at: productData.modified_at || productData.hora || null
        };
    }

    /**
     * Recupera todos los datos de inventario del localStorage (respaldos pendientes)
     * @private
     */
    _getPendingInventoryFromLocalStorage() {
        try {
            const pending = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('buquenque_inventory_')) {
                    const stored = JSON.parse(localStorage.getItem(key));
                    if (stored && !stored.synced) {
                        pending[stored.productId] = stored.inventoryData;
                    }
                }
            }
            return pending;
        } catch (err) {
            console.warn('Error recuperando inventario de localStorage:', err);
            return {};
        }
    }

    /**
     * Elimina datos de inventario del localStorage
     * @private
     */
    _removeInventoryFromLocalStorage(productId) {
        try {
            const storageKey = `buquenque_inventory_${productId}`;
            localStorage.removeItem(storageKey);
        } catch (err) {
            console.warn('Error eliminando del localStorage:', err);
        }
    }
}
