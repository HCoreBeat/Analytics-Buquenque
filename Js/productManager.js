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
     * Carga productos desde GitHub con anti-caché
     * @returns {Promise<Array>}
     */
    async loadProducts() {
        if (this.isLoading) return this.products;
        
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
            } else {
                throw new Error('Estructura JSON inválida: se esperaba { products: [...] }');
            }
            
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
        });
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

        // Generar ID si es nuevo
        if (type === 'new' && !productData.id) {
            productData.id = generateProductId();
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
                        processedProducts.push(productToAdd);
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
                        processedProducts[index] = productToUpdate;
                        console.log(`Producto modificado: ${change.productData.nombre}`);
                    } else {
                        console.error(`Producto no encontrado para modificar: ${searchName}`);
                        throw new Error(`No se pudo encontrar el producto "${searchName}" para modificar`);
                    }
                } else if (change.type === 'delete') {
                    // Búsqueda por nombre original o por nombre actual
                    const searchName = change.originalProductName || change.productData.nombre;
                    const index = processedProducts.findIndex(p => p.nombre === searchName);
                    
                    if (index !== -1) {
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
            const fileContent = {
                products: processedProducts
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
                commitSha: uploadResult?.commit?.sha || null
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
        return `https://raw.githubusercontent.com/${CONFIG.GITHUB_API.REPO_OWNER}/${CONFIG.GITHUB_API.REPO_NAME}/refs/heads/${CONFIG.GITHUB_API.BRANCH}/${CONFIG.GITHUB_API.PRODUCTS_FILE_PATH}`;
    }

    /**
     * Obtiene URL de imagen
     * @param {string} imageName - Nombre de la imagen
     * @returns {string}
     */
    getImageUrl(imageName) {
        return `https://raw.githubusercontent.com/${CONFIG.GITHUB_API.REPO_OWNER}/${CONFIG.GITHUB_API.REPO_NAME}/refs/heads/${CONFIG.GITHUB_API.BRANCH}/${CONFIG.GITHUB_API.IMAGE_PATH_PREFIX}${imageName}`;
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

        return {
            nombre: String(productData.nombre).trim(),
            categoria: String(productData.categoria).trim(),
            precio: parseFloat(productData.precio),
            descuento: parseFloat(productData.descuento || 0),
            mas_vendido: Boolean(productData.mas_vendido || false),
            nuevo: Boolean(productData.nuevo || false),
            oferta: Boolean(productData.oferta || false),
            imagenes: Array.isArray(productData.imagenes) ? productData.imagenes : [],
            descripcion: String(productData.descripcion || '').trim(),
            disponibilidad: productData.disponibilidad !== false
        };
    }
}
