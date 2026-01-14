/**
 * Inicializador del Sistema de Inventario
 * Integración con el Dashboard Principal
 */

import { ProductManager } from './productManager.js';
import { InventoryUIRenderer } from './inventoryUIRenderer.js';
import { GitHubManager } from './githubManager.js';

export class InventoryApp {
    constructor(githubManager = null) {
        this.productManager = null;
        this.uiRenderer = null;
        this.githubManager = githubManager;
        this.initialized = false;
    }

    /**
     * Inicializa la aplicación de inventario (prepara manager). La UI se inicializa bajo demanda
     */
    async initialize() {
        try {
            console.log('Inicializando Sistema de Inventario (sin UI, inicialización bajo demanda)...');

            // Crear gestor de productos
            this.productManager = new ProductManager(this.githubManager);
            await this.productManager.init();

            this.initialized = true;
            console.log('✓ ProductManager listo (llame a showInventory() para inicializar la UI)');
        } catch (error) {
            console.error('Error al inicializar Sistema de Inventario:', error);
            this.showError(`Error al inicializar inventario: ${error.message}`);
        }
    }

    /**
     * Inicializa la UI del inventario y carga productos si no está inicializada
     */
    async showInventory() {
        try {
            if (!this.productManager) {
                this.productManager = new ProductManager(this.githubManager);
                await this.productManager.init();
            }

            if (!this.uiRenderer) {
                this.uiRenderer = new InventoryUIRenderer('#inventory-view');
                await this.uiRenderer.initInventoryUI(this.productManager);
            }

            // Cargar productos y actualizar UI
            await this.productManager.loadProducts();
            this.uiRenderer.renderProductsGrid();
            this.uiRenderer.updateCategoryFilter();
            this.uiRenderer.updateStagingPanel();

        } catch (error) {
            console.error('Error mostrando inventario:', error);
            this.showError(`Error al mostrar inventario: ${error.message}`);
        }
    }

    /**
     * Carga productos desde GitHub (mantiene compatibilidad)
     */
    async loadProducts() {
        try {
            await this.productManager.loadProducts();
            if (this.uiRenderer) {
                this.uiRenderer.renderProductsGrid();
                this.uiRenderer.updateCategoryFilter();
                this.uiRenderer.updateStagingPanel();
            }
        } catch (error) {
            console.error('Error al cargar productos:', error);
            this.showError(`Error al cargar productos: ${error.message}`);
        }
    }

    /**
     * Obtiene estadísticas del staging
     */
    getStagingStats() {
        if (!this.productManager) return null;
        return this.productManager.getStagingStats();
    }

    /**
     * Muestra error en UI
     */
    showError(message) {
        const container = document.querySelector('.inventory-header') || this.uiRenderer.container;
        if (container) {
            const alertDiv = document.createElement('div');
            alertDiv.className = 'alert error';
            alertDiv.innerHTML = `
                <i class="fas fa-exclamation-circle"></i>
                <span>${message}</span>
            `;
            container.insertAdjacentElement('afterend', alertDiv);
            setTimeout(() => alertDiv.remove(), 5000);
        }
    }

    /**
     * Obtiene el ProductManager
     */
    getProductManager() {
        return this.productManager;
    }

    /**
     * Obtiene el UIRenderer
     */
    getUIRenderer() {
        return this.uiRenderer;
    }
}

export default InventoryApp;
