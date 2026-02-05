import { InventoryApiClient } from '../Inventory/inventoryApiClient.js';
import FinanzasManager from './finanzasManager.js';
import { formatCurrency, showAlert, formatNumber } from '../../Core/utils.js';

export class FinanzasUI {
    constructor(containerSelector = '#finanzas-view') {
        this.containerSelector = containerSelector;
        this.container = document.querySelector(this.containerSelector);
        this.manager = new FinanzasManager();
        this.current = null; // current inventory object for Valor_Dolar
        this._lastLoadedPrice = null; // para comparación de sesión
        this._kpiValue = null; // mantener valor persistente del KPI
        this.productManager = null;
        this.metrics = null; // Guardar métricas para filtrado
    }

    setProductManager(pm) {
        this.productManager = pm;
    }

    /**
     * Preload data for Valor_Dolar so toolbar KPI can show on page load.
     * This does not require the Finanzas panel to be rendered.
     */
    async preload({ useCache = true } = {}) {
        try {
            console.log('[FinanzasUI] Starting preload of USD value...');
            const inv = await this.manager.getValorDolar({ useCache });
            this.current = inv;
            const precio = inv && inv.precio_compra !== null && inv.precio_compra !== undefined ? inv.precio_compra : null;
            console.log('[FinanzasUI] Preload success - USD value:', precio);
            // Store KPI persistently so restoreKPI() does not clear it on view changes
            this._kpiValue = precio;
            this._updateToolbarKPI(precio);
            // keep last loaded price for session comparisons
            this._lastLoadedPrice = precio;
        } catch (err) {
            console.warn('[FinanzasUI] Preload failed:', err && err.message ? err.message : err);
            this._updateToolbarKPI(null);
        }
    }

    async showFinanzas(totalSales = 0) {
        try {
            if (!this.container) this.container = document.querySelector(this.containerSelector);
            if (!this.container) return;

            // Ensure CSS loaded (optional)
            if (!document.querySelector('link[href*="finanzas.css"]')) {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'Css/finanzas.css';
                document.head.appendChild(link);
            }

            // Mostrar estado de carga (skeletons + progreso, accesible)
            this.container.innerHTML = `
                <div class="loading-state" role="status" aria-live="polite" aria-busy="true">
                    <div class="loading-top">
                        <i class="fas fa-coins" aria-hidden="true"></i>
                        <div class="loading-texts">
                            <p class="loading-title"><strong>Cargando datos financieros</strong></p>
                            <p class="loading-sub">KPIs, inventario y detalles — por favor espere</p>
                        </div>
                    </div>

                    <div class="skeleton kpi-skeleton" aria-hidden="true">
                        <div class="skeleton-card" style="--delay:0s"></div>
                        <div class="skeleton-card" style="--delay:0.08s"></div>
                        <div class="skeleton-card" style="--delay:0.16s"></div>
                        <div class="skeleton-card" style="--delay:0.24s"></div>
                    </div>

                    <div class="skeleton table-skeleton" aria-hidden="true">
                        <div class="skeleton-row" style="--delay:0s">
                            <div class="s-line short"></div>
                            <div class="s-line"></div>
                            <div class="s-line"></div>
                        </div>
                        <div class="skeleton-row" style="--delay:0.08s">
                            <div class="s-line short"></div>
                            <div class="s-line"></div>
                            <div class="s-line"></div>
                        </div>
                        <div class="skeleton-row" style="--delay:0.16s">
                            <div class="s-line short"></div>
                            <div class="s-line"></div>
                            <div class="s-line"></div>
                        </div>
                        <div class="skeleton-row" style="--delay:0.24s">
                            <div class="s-line short"></div>
                            <div class="s-line"></div>
                            <div class="s-line"></div>
                        </div>
                    </div>

                    <div class="loading-progress-bar-compact" aria-hidden="true" role="progressbar" aria-valuemin="0" aria-valuemax="100">
                        <div class="loading-progress" style="width:20%"></div>
                    </div>
                </div>
            `;

            // Cargar valor del dólar primero
            const inv = await this.manager.getValorDolar({ useCache: true });
            this.current = inv;
            const tasa = inv && inv.precio_compra ? parseFloat(inv.precio_compra) : 0;

            // Calcular métricas si hay productManager
            let metrics = null;
            if (this.productManager && this.productManager.products) {
                metrics = await this.manager.calculateFinancials(this.productManager.products, tasa, totalSales);
            }
            this.metrics = metrics;
            this.tasa = tasa;

            this.container.innerHTML = `
                <div class="finanzas-header">
                    <div>
                        <h2><i class="fas fa-money-bill-wave"></i> Finanzas</h2>
                        <p class="muted">Panel financiero · Administrador de moneda</p>
                    </div>
                    <div class="finanzas-header-actions">
                        <div class="finanzas-search-wrapper">
                            <input type="text" id="finanzas-search" placeholder="Buscar producto..." class="input-light">
                        </div>
                        <button class="btn btn-outline" id="finanzas-edit-btn">Editar Tasa</button>
                        <button class="btn" id="finanzas-refresh-btn"><i class="fas fa-sync-alt"></i> Refrescar</button>
                    </div>
                </div>

                <div class="finanzas-dashboard">
                    <!-- Sección Moneda -->
                    <div class="finanzas-card currency-card">
                        <div class="finanzas-card-body">
                            <div class="finanzas-label"><i class="fas fa-exchange-alt"></i> Tasa de Cambio Actual</div>
                            <div class="finanzas-price" id="finanzas-dolar-price">
                                <span id="finanzas-price-value">${tasa ? formatCurrency(tasa).replace('$', '') + ' CUP' : 'No definida'}</span>
                            </div>
                            <div class="finanzas-meta">
                                <small class="finanzas-lastupdated" id="finanzas-lastupdated">Cargando...</small>
                            </div>
                        </div>
                    </div>

                    ${metrics ? this._renderMetrics(metrics, tasa) : ''}
                </div>

                <div id="finanzas-table-container">
                    ${metrics ? this._renderDetailsTable(metrics.detalles, tasa) : ''}
                </div>
            `;

            this.setupListeners();
            this._attachManagerListeners();
            await this.loadValorDolar();
            this._updateLastSaveInfo();
        } catch (err) {
            console.error('Error mostrando Finanzas:', err);
            showAlert(`Error mostrando Finanzas: ${err.message}`, 'error');
        }
    }

    _renderMetrics(metrics, tasa) {
        const { totales } = metrics;
        
        // Calcular ROI y otras métricas
        const roi = totales.costoUSD > 0 ? ((totales.gananciaUSD / totales.costoUSD) * 100).toFixed(1) : 0;
        const margenPromedio = metrics.detalles.length > 0 
            ? (metrics.detalles.reduce((sum, p) => sum + p.margen, 0) / metrics.detalles.length).toFixed(1)
            : 0;
        
        // Contar productos en oferta
        const productosEnOferta = metrics.detalles.filter(p => p.enOferta).length;
        
        // Productos más rentables
        const topRentable = metrics.detalles.length > 0 
            ? metrics.detalles.reduce((max, p) => p.ganancia > max.ganancia ? p : max)
            : null;

        return `
            <div class="finanzas-kpi-grid">
                <div class="kpi-card">
                    <div class="kpi-label"><i class="fas fa-dollar-sign"></i> Valor Inventario (Venta)</div>
                    <div class="kpi-value">${formatCurrency(totales.ventaUSD)} <small>USD</small></div>
                    <div class="kpi-subvalue">${formatCurrency(totales.ventaCUP).replace('$', '')} CUP</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label"><i class="fas fa-box"></i> Costo Inventario</div>
                    <div class="kpi-value">${formatCurrency(totales.costoUSD)} <small>USD</small></div>
                    <div class="kpi-subvalue">${formatCurrency(totales.costoCUP).replace('$', '')} CUP</div>
                </div>
                <div class="kpi-card highlight">
                    <div class="kpi-label"><i class="fas fa-chart-line"></i> Ganancia Potencial</div>
                    <div class="kpi-value">${formatCurrency(totales.gananciaUSD)} <small>USD</small></div>
                    <div class="kpi-subvalue">${formatCurrency(totales.gananciaCUP).replace('$', '')} CUP</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label"><i class="fas fa-boxes"></i> Items en Stock</div>
                    <div class="kpi-value">${formatNumber(totales.items)}</div>
                    <div class="kpi-subvalue">Productos disponibles</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label"><i class="fas fa-percentage"></i> ROI</div>
                    <div class="kpi-value success">${roi}%</div>
                    <div class="kpi-subvalue">Retorno sobre inversión</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label"><i class="fas fa-code"></i> Pago Programador (5%)</div>
                    <div class="kpi-value">${formatCurrency(totales.pagoProgramadorUSD)} <small>USD</small></div>
                    <div class="kpi-subvalue">${formatCurrency(totales.pagoProgramadorCUP).replace('$', '')} CUP</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label"><i class="fas fa-chart-bar"></i> Margen Promedio</div>
                    <div class="kpi-value success">${margenPromedio}%</div>
                    <div class="kpi-subvalue">En todos los productos</div>
                </div>
                <div class="kpi-card">
                    <div class="kpi-label"><i class="fas fa-tag"></i> Productos en Oferta</div>
                    <div class="kpi-value">${productosEnOferta}</div>
                    <div class="kpi-subvalue">Con descuento aplicado</div>
                </div>
                ${topRentable ? `
                <div class="kpi-card">
                    <div class="kpi-label"><i class="fas fa-trophy"></i> Más Rentable</div>
                    <div class="kpi-value success">${formatCurrency(topRentable.ganancia).replace('$', '')} CUP</div>
                    <div class="kpi-subvalue">${topRentable.name}</div>
                </div>
                ` : ''}
            </div>
        `;
    }

    _renderDetailsTable(detalles, tasa) {
        return `
            <div class="finanzas-details-section">
                <h3><i class="fas fa-list"></i> Detalle de Rentabilidad por Producto</h3>
                
                <div class="finanzas-filters">
                    <div class="finanzas-search-wrapper">
                        <input type="text" id="finanzas-search-detailed" placeholder="🔍 Buscar producto..." class="input-light">
                    </div>
                    <div class="finanzas-filter-group">
                        <label>Filtrar por margen:</label>
                        <select id="finanzas-filter-margin">
                            <option value="">Todos</option>
                            <option value="30">Alto (>30%)</option>
                            <option value="15">Medio (15-30%)</option>
                            <option value="0">Bajo (<15%)</option>
                        </select>
                    </div>
                    <div class="finanzas-filter-group">
                        <label>Estado:</label>
                        <select id="finanzas-filter-status">
                            <option value="">Todos</option>
                            <option value="oferta">En Oferta</option>
                            <option value="normal">Normal</option>
                        </select>
                    </div>
                </div>

                <div class="table-responsive">
                    <table class="finanzas-table">
                        <thead>
                            <tr>
                                <th>Producto</th>
                                <th>Stock</th>
                                <th>Costo U. (CUP)</th>
                                <th>Costo Total (CUP)</th>
                                <th>Precio V. (USD)</th>
                                <th>Precio V. (CUP)</th>
                                <th>Margen %</th>
                                <th>Ganancia (CUP)</th>
                            </tr>
                        </thead>
                        <tbody id="finanzas-table-body">
                            ${this._renderTableRows(detalles, tasa)}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    _renderTableRows(detalles, tasa) {
        return detalles.map(d => `
            <tr data-product-id="${d.id}" data-margin="${d.margen}" data-oferta="${d.enOferta}">
                <td data-label="Producto">
                    <div class="product-cell">
                        <img src="${d.image}" alt="${d.name}" class="product-thumb" onerror="this.src='Img/no_image.jpg'">
                        <div class="product-info">
                            <span class="product-name">${d.name}</span>
                            <span class="product-id">ID: ${d.id}</span>
                        </div>
                    </div>
                </td>
                <td data-label="Stock">${d.stock}</td>
                <td data-label="Costo U. (CUP)">${formatCurrency(d.costoUnitario).replace('$', '')} CUP</td>
                <td data-label="Costo Total (CUP)">${formatCurrency(d.totalCosto).replace('$', '')} CUP</td>
                <td data-label="Precio V. (USD)">
                    ${formatCurrency(d.precioVenta)}
                    ${d.enOferta ? `<span class="offer-tag">-${d.descuento}%</span>` : ''}
                </td>
                <td data-label="Precio V. (CUP)">${formatCurrency(d.precioVentaCUP).replace('$', '')} CUP</td>
                <td data-label="Margen %"><span class="badge ${d.margen > 30 ? 'success' : (d.margen > 15 ? 'warning' : 'danger')}">${d.margen.toFixed(1)}%</span></td>
                <td data-label="Ganancia (CUP)">${formatCurrency(d.ganancia).replace('$', '')} CUP</td>
            </tr>
        `).join('');
    }

    filterTable(term) {
        if (!this.metrics || !this.metrics.detalles) return;
        const lowerTerm = term.toLowerCase();
        const marginFilter = document.getElementById('finanzas-filter-margin')?.value || '';
        const statusFilter = document.getElementById('finanzas-filter-status')?.value || '';
        
        let filtered = this.metrics.detalles.filter(d => {
            // Búsqueda por nombre o ID
            const matchText = !term || (d.name && d.name.toLowerCase().includes(lowerTerm)) || 
                             (d.id && d.id.toLowerCase().includes(lowerTerm));
            
            // Filtro por margen
            let matchMargin = true;
            if (marginFilter === '30') matchMargin = d.margen > 30;
            else if (marginFilter === '15') matchMargin = d.margen >= 15 && d.margen <= 30;
            else if (marginFilter === '0') matchMargin = d.margen < 15;
            
            // Filtro por estado
            let matchStatus = true;
            if (statusFilter === 'oferta') matchStatus = d.enOferta === true;
            else if (statusFilter === 'normal') matchStatus = d.enOferta !== true;
            
            return matchText && matchMargin && matchStatus;
        });
        
        // Actualizar tabla
        const tbody = document.getElementById('finanzas-table-body');
        if (tbody) {
            tbody.innerHTML = this._renderTableRows(filtered, this.tasa);
        }
    }

    async loadValorDolar() {
        try {
            const inv = await this.manager.getValorDolar({ useCache: true });
            this.current = inv;
            const valueEl = document.getElementById('finanzas-price-value');
            const statusEl = document.getElementById('finanzas-price-status');
            const lastEl = document.getElementById('finanzas-lastupdated');
            const lastCompactEl = document.getElementById('finanzas-lastupdated-compact');
            const stateCompactEl = document.getElementById('finanzas-state-compact');
            const changeEl = document.getElementById('finanzas-price-change');
            const precio = inv && inv.precio_compra !== null && inv.precio_compra !== undefined ? inv.precio_compra : null;
            
            // Actualizar KPI persistente
            this._kpiValue = precio;
            this._updateToolbarKPI(precio);
            
            if (valueEl) valueEl.textContent = precio !== null ? formatCurrency(precio).replace('$', '') + ' CUP' : '—';
            if (statusEl) { statusEl.className = `status idle`; statusEl.title = '' }
            if (lastEl) lastEl.textContent = inv && inv.last_updated ? `Última actualización: ${inv.last_updated}` : '';
            if (lastCompactEl) lastCompactEl.textContent = inv && inv.last_updated ? (new Date(inv.last_updated)).toLocaleString() : '—';
            if (stateCompactEl) stateCompactEl.textContent = 'Conectado';

            // compute session percent change if available
            if (changeEl) {
                // Show change since last loaded value in this session (if available)
                const prev = this._lastLoadedPrice !== undefined ? this._lastLoadedPrice : null;
                if (prev !== null && prev !== undefined && prev !== 0 && precio !== null && precio !== undefined) {
                    const pct = ((precio - prev) / Math.abs(prev)) * 100;
                    const cls = pct >= 0 ? 'positive' : 'negative';
                    changeEl.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
                    changeEl.className = `finanzas-change ${cls}`;
                } else {
                    changeEl.textContent = '';
                    changeEl.className = 'finanzas-change';
                }
            }
            // store last loaded price for session comparison
            this._lastLoadedPrice = precio;
        } catch (err) {
            console.error('Error cargando Valor_Dolar:', err);
            const valueEl = document.getElementById('finanzas-price-value');
            if (valueEl) valueEl.textContent = 'Error';
            showAlert('No fue posible cargar el valor del dólar', 'error');
        }
    }

    _updateToolbarKPI(value) {
        const el = document.getElementById('finanzas-toolbar-kpi');
        if (el) {
            const displayValue = value ? `${value} CUP` : '—';
            el.textContent = displayValue;
            el.dataset.value = value || '';
            console.log('[FinanzasUI] Toolbar KPI updated with value:', displayValue);
        } else {
            console.warn('[FinanzasUI] Element #finanzas-toolbar-kpi not found in DOM');
        }
    }

    setupListeners() {
        // Editar tasa
        const editBtn = document.getElementById('finanzas-edit-btn');
        if (editBtn) {
            editBtn.addEventListener('click', async () => {
                const precio = prompt('Ingrese la nueva tasa de cambio USD:', this.current && this.current.precio_compra ? this.current.precio_compra : '');
                if (precio !== null && precio !== '') {
                    try {
                        const numericPrice = parseFloat(precio);
                        if (!isNaN(numericPrice)) {
                            await this.manager.savePrecio(numericPrice);
                            // Refresh view
                            this.showFinanzas().catch(console.warn);
                        } else {
                            showAlert('Por favor, ingrese un número válido', 'error');
                        }
                    } catch (e) {
                        showAlert('Error guardando precio: ' + (e.message || e), 'error');
                    }
                }
            });
        }

        // Refrescar
        const refreshBtn = document.getElementById('finanzas-refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.showFinanzas().catch(err => console.warn('Error refrescando finanzas:', err));
            });
        }

        // Buscador principal
        const searchInput = document.getElementById('finanzas-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.filterTable(e.target.value);
            });
        }

        // Buscador detallado
        const searchDetailed = document.getElementById('finanzas-search-detailed');
        if (searchDetailed) {
            searchDetailed.addEventListener('input', (e) => {
                this.filterTable(e.target.value);
            });
        }

        // Filtro de margen
        const filterMargin = document.getElementById('finanzas-filter-margin');
        if (filterMargin) {
            filterMargin.addEventListener('change', () => {
                const searchTerm = document.getElementById('finanzas-search-detailed')?.value || '';
                this.filterTable(searchTerm);
            });
        }

        // Filtro de estado
        const filterStatus = document.getElementById('finanzas-filter-status');
        if (filterStatus) {
            filterStatus.addEventListener('change', () => {
                const searchTerm = document.getElementById('finanzas-search-detailed')?.value || '';
                this.filterTable(searchTerm);
            });
        }
    }

    _attachManagerListeners() {
        // Optional: Listen to manager events if needed
    }

    _updateLastSaveInfo() {
        // Optional: Update last save info if available
    }

    restoreKPI() {
        this._updateToolbarKPI(this._kpiValue);
    }
}
