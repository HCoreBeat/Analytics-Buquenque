/**
 * Dashboard Principal - Buquenque
 * Versión 2.0 - Modularizada
 */

import { DataManager } from './dataManager.js';
import { ChartManager } from './chartManager.js';
import { UIRenderer } from './uiRenderer.js';
import { SettingsUI } from './settingsUI.js';
import { showAlert, getCurrencySymbol } from './utils.js';

class DashboardApp {
    constructor() {
        this.dataManager = new DataManager();
        this.chartManager = new ChartManager();
        this.initialize();
    }

    async initialize() {
        try {
            // Cargar datos
            await this.dataManager.loadData();
            
            // Inicializar gráficos
            this.chartManager.initCharts();
            
            // Configurar event listeners
            this.setupEventListeners();

            // Cargar datos iniciales
            document.getElementById('filter-period').value = 'all';
            this.applyFilters();
            
            showAlert('✅ Dashboard cargado correctamente', 'success', 2000);
        } catch (error) {
            console.error('Error al inicializar:', error);
            showAlert(`❌ Error: ${error.message}`, 'error');
        }
    }

    setupEventListeners() {
        // Botón de actualizar
        document.getElementById('refresh-data')?.addEventListener('click', async () => {
            const refreshBtn = document.getElementById('refresh-data');
            const originalText = refreshBtn.innerHTML;
            
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
            refreshBtn.disabled = true;
            
            try {
                await this.dataManager.loadData();
                this.applyFilters();
                showAlert('✅ Datos actualizados', 'success');
            } catch (error) {
                showAlert(`❌ Error: ${error.message}`, 'error');
            } finally {
                setTimeout(() => {
                    refreshBtn.innerHTML = originalText;
                    refreshBtn.disabled = false;
                }, 1000);
            }
        });

        // Filtros
        document.querySelectorAll('.filter-group select, .filter-group input').forEach(el =>
            el.addEventListener('change', () => this.applyFilters()));

        // Búsqueda
        const searchInput = document.getElementById('search-data');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                this.dataManager.search(searchTerm);
                this.updateDashboard();
            });
        }

        // Pestañas de transacciones
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const tab = btn.dataset.tab;
                const filtered = this.dataManager.filterByTransactionType(tab);
                UIRenderer.renderTransactions(document.getElementById('data-list'), filtered, 
                    (order, idx) => UIRenderer.generateReceipt(order));
            });
        });
    }

    applyFilters() {
        const startDate = document.getElementById('filter-date-start')?.value;
        const endDate = document.getElementById('filter-date-end')?.value;
        const period = document.getElementById('filter-period')?.value || 'all';

        this.dataManager.filterByDateRange(startDate, endDate, period);
        this.updateDashboard();
    }

    updateDashboard() {
        // Actualizar estadísticas
        const stats = this.dataManager.getStats();
        UIRenderer.updateStats(stats);

        // Actualizar resumen general
        const monthlyData = this.dataManager.getMonthlyComparison();
        const period = document.getElementById('filter-period')?.value || 'all';
        UIRenderer.renderGeneralSummary(
            document.getElementById('general-summary'),
            monthlyData,
            this.dataManager.filteredData,
            period
        );

        // Actualizar resumen diario
        const dailySummary = this.dataManager.getDailySummary();
        UIRenderer.renderDailySummary(document.getElementById('daily-summary'), dailySummary);

        // Actualizar productos top
        const topProducts = this.dataManager.getTopProducts(this.dataManager.filteredData, 5);
        UIRenderer.renderTopProducts(document.getElementById('top-products'), topProducts);

        // Actualizar transacciones
        UIRenderer.renderTransactions(
            document.getElementById('data-list'),
            this.dataManager.filteredData,
            (order, idx) => UIRenderer.generateReceipt(order)
        );

        // Actualizar gráficos
        const trendData = this.dataManager.getSalesTrend();
        this.chartManager.updateCharts(topProducts, trendData);
    }
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', () => {
    new DashboardApp();
    new SettingsUI();
});
