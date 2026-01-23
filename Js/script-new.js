/**
 * Dashboard Principal - Buquenque
 * Versión 2.0 - Modularizada
 */

import { DataManager } from './dataManager.js';
import { ChartManager } from './chartManager.js';
import { UIRenderer } from './uiRenderer.js';
import { SettingsUI } from './settingsUI.js';
import { InventoryApp } from './inventoryApp.js';
import { GitHubManager } from './githubManager.js';
import { NotificationEditorUI } from './notificationEditorUI.js';
import { showAlert, getCurrencySymbol } from './utils.js';

class DashboardApp {
    constructor() {
        this.dataManager = new DataManager();
        this.chartManager = new ChartManager();
        this.inventoryApp = null;
        this.notificationEditor = null;
        this.githubManager = new GitHubManager();
        this.initialize();
    }

    async initialize() {
        try {
            // Cargar datos
            await this.dataManager.loadData();
            
            // Inicializar gráficos
            this.chartManager.initCharts();

            // Inicializar Sistema de Inventario
            this.inventoryApp = new InventoryApp(this.githubManager);
            await this.inventoryApp.initialize();

            // Inicializar Editor de Notificaciones
            this.notificationEditor = new NotificationEditorUI();
            
            // Configurar event listeners
            this.setupEventListeners();
            this.setupViewNavigation();

            // Forzar estado inicial de vistas: ocultar todas excepto la activa del menú
            this.switchView(document.querySelector('.menu-item.active')?.dataset.view || 'dashboard');

            // Cargar datos iniciales
            // Por defecto usar este mes
            document.getElementById('filter-period').value = 'month';

            // Poblar opciones dinámicas de filtros (países, afiliados, navegadores, OS)
            this.populateFilterOptions();

            this.applyFilters();

            // Configurar modal de filtros
            const openFiltersBtn = document.getElementById('open-filters');
            const filtersModal = document.getElementById('filters-modal');
            const filtersOverlay = document.getElementById('filters-modal-overlay');
            const filtersClose = document.getElementById('filters-modal-close');
            const filtersCloseFooter = document.getElementById('filters-close');
            const filtersApply = document.getElementById('filters-apply');

            function openFilters() {
                if (filtersModal) {
                    filtersModal.classList.add('active');
                    filtersModal.setAttribute('aria-hidden', 'false');
                    // Focus al primer control
                    const firstControl = filtersModal.querySelector('select, input, button');
                    if (firstControl) firstControl.focus();
                }
            }
            function closeFilters() {
                if (filtersModal) {
                    filtersModal.classList.remove('active');
                    filtersModal.setAttribute('aria-hidden', 'true');
                }
            }

            if (openFiltersBtn) openFiltersBtn.addEventListener('click', () => openFilters());
            if (filtersOverlay) filtersOverlay.addEventListener('click', () => closeFilters());
            if (filtersClose) filtersClose.addEventListener('click', () => closeFilters());
            if (filtersCloseFooter) filtersCloseFooter.addEventListener('click', () => closeFilters());
            if (filtersApply) filtersApply.addEventListener('click', () => { this.applyFilters(); closeFilters(); });

            // Cerrar con Escape
            document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFilters(); });
            
            showAlert('✅ Dashboard cargado correctamente', 'success', 2000);
        } catch (error) {
            console.error('Error al inicializar:', error);
            showAlert(`❌ Error: ${error.message}`, 'error');
        }
    }

    /**
     * Configurar navegación entre vistas
     */
    setupViewNavigation() {
        document.querySelectorAll('.menu-item[data-view]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                const viewName = item.dataset.view;
                this.switchView(viewName);
            });
        });
    }

    /**
     * Cambiar vista activa
     */
    switchView(viewName) {
        // Ocultar todas las vistas (usar clase .hidden para control explícito)
        document.querySelectorAll('.view-content').forEach(view => {
            view.classList.add('hidden');
            view.classList.remove('active');
        });

        // Mostrar vista seleccionada
        const selectedView = document.getElementById(`${viewName}-view`);
        if (selectedView) {
            selectedView.classList.remove('hidden');
            selectedView.classList.add('active');
        }

        // Si la vista es inventario, inicializar la UI bajo demanda
        if (viewName === 'inventory' && this.inventoryApp) {
            this.inventoryApp.showInventory().catch(err => console.warn('Error mostrando inventario:', err));
        }

        // Si la vista es notificaciones, reinicializar el editor
        if (viewName === 'notifications' && this.notificationEditor) {
            // Reiniciar para cargar datos frescos
            this.notificationEditor.init().catch(err => console.warn('Error inicializando notificaciones:', err));
        }

        // Actualizar menu activo
        document.querySelectorAll('.menu-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`.menu-item[data-view="${viewName}"]`)?.classList.add('active');

        // Cerrar menu en mobile
        const sidebar = document.getElementById('sidebar-menu');
        if (sidebar && sidebar.classList.contains('active')) sidebar.classList.remove('active');
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

    populateFilterOptions() {
        try {
            const countries = Array.from(new Set(this.dataManager.data.map(d => d.country).filter(Boolean))).sort();
            const affiliates = Array.from(new Set(this.dataManager.data.map(d => d.affiliate).filter(Boolean))).sort();
            const browsers = Array.from(new Set(this.dataManager.data.map(d => d.browser).filter(Boolean))).sort();
            const oses = Array.from(new Set(this.dataManager.data.map(d => d.operatingSystem).filter(Boolean))).sort();

            const countryEl = document.getElementById('filter-country');
            const affiliateEl = document.getElementById('filter-affiliate');
            const browserEl = document.getElementById('filter-browser');
            const osEl = document.getElementById('filter-os');

            if (countryEl) {
                countries.forEach(c => {
                    const opt = document.createElement('option'); opt.value = c; opt.textContent = c; countryEl.appendChild(opt);
                });
            }
            if (affiliateEl) {
                affiliates.forEach(a => {
                    const opt = document.createElement('option'); opt.value = a; opt.textContent = a; affiliateEl.appendChild(opt);
                });
            }
            if (browserEl) {
                browsers.forEach(b => {
                    const opt = document.createElement('option'); opt.value = b; opt.textContent = b; browserEl.appendChild(opt);
                });
            }
            if (osEl) {
                oses.forEach(o => {
                    const opt = document.createElement('option'); opt.value = o; opt.textContent = o; osEl.appendChild(opt);
                });
            }
        } catch (err) {
            console.warn('Error poblando opciones de filtros', err);
        }
    }

    applyFilters() {
        const startDate = document.getElementById('filter-date-start')?.value;
        const endDate = document.getElementById('filter-date-end')?.value;
        const period = document.getElementById('filter-period')?.value || 'all';

        const country = document.getElementById('filter-country')?.value || 'all';
        const affiliate = document.getElementById('filter-affiliate')?.value || 'all';
        const userType = document.getElementById('filter-user-type')?.value || 'all';
        const browser = document.getElementById('filter-browser')?.value || 'all';
        const os = document.getElementById('filter-os')?.value || 'all';
        const minTotal = document.getElementById('filter-min-total')?.value;
        const maxTotal = document.getElementById('filter-max-total')?.value;
        const hasPurchase = document.getElementById('filter-has-purchase')?.value || 'all';

        this.dataManager.filterByCriteria({ startDate, endDate, period, country, affiliate, userType, browser, os, minTotal, maxTotal, hasPurchase });
        this.updateDashboard();
    }

    updateDashboard() {
        // Actualizar estadísticas
        const stats = this.dataManager.getStats();
        UIRenderer.updateStats(stats);

        // Mostrar 'Visitas Totales' obtenidas desde el backend (/obtener-estadisticas).
        (function updateVisitsFromBackend(self) {
            const BACKEND_URL = 'https://backend-buquenque.onrender.com';
            fetch(`${BACKEND_URL}/obtener-estadisticas`)
                .then(resp => {
                    if (!resp.ok) throw new Error('Backend response not OK');
                    return resp.json();
                })
                .then(serverStats => {
                    const totalVisits = Array.isArray(serverStats) ? serverStats.length : 0;
                    const el = document.getElementById('server-available-users');
                    if (el) el.textContent = totalVisits;
                })
                .catch(err => {
                    console.warn('No se pudo obtener visitas totales desde backend, usando local', err);
                    const totalVisits = Array.isArray(self.dataManager.data) ? self.dataManager.data.length : 0;
                    const el = document.getElementById('server-available-users');
                    if (el) el.textContent = totalVisits;
                });
        })(this);

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
