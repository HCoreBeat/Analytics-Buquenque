class DashboardApp {
    constructor() {
        // Datos brutos cargados del JSON
        this.data = [];
        // Datos filtrados para mostrar en el dashboard
        this.filteredData = [];
        // Referencias a los objetos de Chart.js para su actualización
        this.charts = {
            products: null,
            salesTrend: null
        };
        // Inicializa la aplicación cuando el DOM esté completamente cargado
        this.initialize();
    }

    async initialize() {
        // Carga los datos desde el archivo JSON
        await this.loadMyData();
        // Configura los filtros iniciales para los dropdowns
        this.initFilters();
        // Inicializa los gráficos de Chart.js
        this.initCharts();
        // Configura los eventos de la interfaz de usuario
        this.setupEventListeners();

        // Establece el filtro de periodo a "Todos" por defecto para que muestre datos al inicio
        document.getElementById('filter-period').value = 'all';
        // Aplica los filtros iniciales para renderizar el dashboard
        this.applyFilters();
    }

    // Método para obtener el nombre del mes
    getMonthName(monthIndex) {
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                       'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return months[monthIndex];
    }

    // Método para obtener el símbolo de la moneda (siempre CUP ahora)
    getCurrencySymbol() {
        return 'CUP';
    }

    // Carga los datos desde el archivo Json/my_data.json
    async loadMyData() {
        try {
            const response = await fetch('Json/my_data.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.data = await response.json();
            
            // Verifica si los datos son un array
            if (!Array.isArray(this.data)) {
                throw new Error('Datos inválidos: el JSON no es un array');
            }
            
            // Normaliza la estructura de los datos cargados
            this.normalizeMyData();
            // Inicializa los datos filtrados con todos los datos cargados
            this.filteredData = [...this.data];
        } catch (error) {
            console.error('Error al cargar los datos:', error);
            this.showAlert('Error al cargar los datos. Intente recargar la página.', 'error');
        }
    }

    // Normaliza la estructura de los datos para que coincida con el formato interno
    normalizeMyData() {
        this.data.forEach(item => {
            // Convierte la fecha_hora_entrada a un objeto Date
            item.date = new Date(item.fecha_hora_entrada);
            // Formatea la fecha para mostrarla
            item.dateStr = item.date.toLocaleDateString('es-ES', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
            // Parsea el precio_compra_total a un número flotante
            item.total = parseFloat(item.precio_compra_total) || 0;
            // Calcula el conteo total de productos en la compra
            item.productsCount = item.compras.reduce((acc, curr) => acc + (curr.quantity || 0), 0);

            // Mapea los nombres de las propiedades del JSON original a los nombres internos
            item.userType = item.tipo_usuario || 'No especificado';
            item.affiliate = item.afiliado || 'Sin afiliado';
            item.country = item.pais || 'No especificado';
            item.buyerName = item.nombre_comprador || 'Desconocido';
            item.buyerPhone = item.telefono_comprador || 'No especificado';
            item.buyerEmail = item.correo_comprador || 'No especificado';
            item.shippingAddress = item.direccion_envio || 'No especificada'; // Nueva propiedad
            item.browser = item.navegador || 'No especificado';
            item.operatingSystem = item.sistema_operativo || 'No especificado';
            item.trafficSource = item.fuente_trafico || 'No especificado';

            // Crea un campo de texto para facilitar la búsqueda
            item.searchText = `${item.buyerName} ${item.country} ${item.userType} ${item.affiliate} ${item.buyerPhone} ${item.buyerEmail} ${item.shippingAddress} ${item.browser} ${item.operatingSystem} ${item.trafficSource}`.toLowerCase();

            // Calcula el precio total de cada producto en la compra, aplicando el descuento
            item.compras = item.compras.map(product => {
                const priceBeforeDiscount = product.quantity * product.unitPrice;
                const finalPrice = priceBeforeDiscount * (1 - (product.discount || 0) / 100);
                return {
                    ...product,
                    producto: product.name,
                    precio_unitario: product.unitPrice,
                    precio_total: finalPrice
                };
            });
        });
    }

    // Configura los event listeners para los elementos interactivos de la página
    setupEventListeners() {
        // Listener para el botón de actualizar datos
        document.getElementById('refresh-data')?.addEventListener('click', async () => {
            const refreshBtn = document.getElementById('refresh-data');
            const originalText = refreshBtn.innerHTML;
            
            refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Actualizando...';
            refreshBtn.disabled = true;
            
            try {
                await this.loadMyData(); // Vuelve a cargar y normalizar los datos
                this.applyFilters(); // Re-aplica los filtros y renderiza el dashboard
                this.showAlert('✅ Datos actualizados correctamente', 'success');
            } catch (error) {
                console.error('Error al actualizar datos:', error);
                this.showAlert(`❌ Error al actualizar: ${error.message}`, 'error');
            } finally {
                setTimeout(() => {
                    refreshBtn.innerHTML = originalText;
                    refreshBtn.disabled = false;
                }, 1000);
            }
        });

        // Event listeners para los filtros de selección y fecha
        document.querySelectorAll('.filter-group select, .filter-group input').forEach(el =>
            el.addEventListener('change', () => this.applyFilters()));

        // Event listener para mostrar/ocultar detalles de la orden
        document.addEventListener('click', (e) => {
            if (e.target.closest('.order-header')) {
                const details = e.target.closest('.order-card').querySelector('.order-details');
                details.classList.toggle('active');
            }
        });

        // Event listener para la barra de búsqueda
        const searchInput = document.getElementById('search-data');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                // Filtra los datos originales para que la búsqueda sea sobre todo el dataset.
                this.filteredData = this.data.filter(item =>
                    item.searchText.includes(searchTerm)
                );
                // Re-renderiza el dashboard con los resultados de la búsqueda
                this.updateStats(this.filteredData);
                this.renderMonthlyComparison(this.filteredData);
                this.renderDailySummary();
                this.renderTransactions(this.filteredData);
                this.updateCharts(this.filteredData);
            });
        }

        // Event listeners para las pestañas de transacciones
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const tab = btn.dataset.tab;
                let filtered = this.filteredData; // Se basa en los datos actualmente filtrados por los filtros principales
                
                if (tab === 'affiliated') {
                    filtered = filtered.filter(order => order.afiliado && order.afiliado !== 'Sin afiliado');
                } else if (tab === 'direct') {
                    filtered = filtered.filter(order => !order.afiliado || order.afiliado === 'Sin afiliado');
                }
                
                this.renderTransactions(filtered); // Renderiza solo la lista de transacciones con el filtro de tab
            });
        });
    }

    // Inicializa los dropdowns de filtros con los valores únicos de los datos
    initFilters() {
        // No hay filtros de país, afiliado o tipo de usuario en el HTML, solo los de fecha y periodo
    }

    // Aplica todos los filtros seleccionados a los datos
    applyFilters() {
        const startDate = document.getElementById('filter-date-start')?.value;
        const endDate = document.getElementById('filter-date-end')?.value;
        const period = document.getElementById('filter-period')?.value || 'all'; // Default to 'all'

        const now = new Date();
        let periodStart, periodEnd;
        
        // Define el rango de fechas según el periodo seleccionado
        switch (period) {
            case 'month':
                periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
                periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0); // Último día del mes actual
                periodEnd.setHours(23, 59, 59, 999); // Ajustar al final del día
                break;
            case 'last-month':
                periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                periodEnd = new Date(now.getFullYear(), now.getMonth(), 0); // Último día del mes anterior
                periodEnd.setHours(23, 59, 59, 999); // Ajustar al final del día
                break;
            case 'year':
                periodStart = new Date(now.getFullYear(), 0, 1);
                periodEnd = new Date(now.getFullYear(), 11, 31); // Último día del año actual
                periodEnd.setHours(23, 59, 59, 999); // Ajustar al final del día
                break;
            default: // 'all'
                periodStart = null;
                periodEnd = null;
        }
        
        // Filtra los datos según las condiciones
        this.filteredData = this.data.filter(item => {
            const itemDate = item.date;
            const itemDateStr = itemDate.toISOString().split('T')[0]; // Formato YYYY-MM-DD

            const dateInRange =
                (!startDate || itemDateStr >= startDate) &&
                (!endDate || itemDateStr <= endDate);
                
            const periodInRange =
                !periodStart ||
                (itemDate >= periodStart && itemDate <= periodEnd);
                
            return (
                dateInRange &&
                periodInRange
            );
        });
        
        // Actualiza las estadísticas y los gráficos con los datos filtrados
        this.updateStats(this.filteredData);
        this.renderMonthlyComparison(this.filteredData);
        this.renderDailySummary();
        this.renderTransactions(this.filteredData);
        this.updateCharts(this.filteredData);
    }

    // Renderiza el resumen mensual de ventas y pedidos
    renderMonthlyComparison(data) {
        const container = document.getElementById('general-summary');
        if (!container) return;

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();
        const period = document.getElementById('filter-period')?.value || 'all';

        // Obtener todos los datos mensuales del *dataset completo*, no solo los filtrados.
        const monthlyData = this.getMonthlyComparison(this.data); 
        
        let referenceMonth = currentMonth;
        let title = `Resumen ${currentYear}`;
        let periodBadgeText = 'Anual';

        if (period === 'month') {
            title = `Resumen ${this.getMonthName(currentMonth)}`;
            periodBadgeText = this.getMonthName(currentMonth);
        } else if (period === 'last-month') {
            referenceMonth = (currentMonth - 1 + 12) % 12;
            title = `Resumen ${this.getMonthName(referenceMonth)}`;
            periodBadgeText = this.getMonthName(referenceMonth);
        } else { // 'year' or 'all'
            referenceMonth = null; 
        }

        const referenceData = referenceMonth !== null ?
            monthlyData.find(m => this.getMonthIndex(m.month) === referenceMonth) ||
            { month: this.getMonthName(referenceMonth), orders: 0, sales: 0, products: 0 }
            : null;

        let lastMonthWithData = null;
        if (referenceMonth !== null) {
            for (let i = 1; i <= 11; i++) {
                const checkMonth = (referenceMonth - i + 12) % 12;
                const monthData = monthlyData.find(m =>
                    this.getMonthIndex(m.month) === checkMonth &&
                    (m.orders > 0 || m.sales > 0)
                );
                
                if (monthData) {
                    lastMonthWithData = monthData;
                    break;
                }
            }
        }

        let salesChangeHtml = '';
        let ordersChangeHtml = '';
        
        if (lastMonthWithData && referenceData) {
            const salesChange = lastMonthWithData.sales > 0 ?
                ((referenceData.sales - lastMonthWithData.sales) / lastMonthWithData.sales * 100).toFixed(1) : 0;
            const ordersChange = lastMonthWithData.orders > 0 ?
                ((referenceData.orders - lastMonthWithData.orders) / lastMonthWithData.orders * 100).toFixed(1) : 0;
            
            salesChangeHtml = `
                <div class="stat-change ${salesChange >= 0 ? 'positive' : 'negative'}">
                    ${salesChange >= 0 ? '↑' : '↓'} ${Math.abs(salesChange)}%
                    vs ${lastMonthWithData.month}
                </div>
            `;
            
            ordersChangeHtml = `
                <div class="stat-change ${ordersChange >= 0 ? 'positive' : 'negative'}">
                    ${ordersChange >= 0 ? '↑' : '↓'} ${Math.abs(ordersChange)}%
                </div>
            `;
        }

        const yearlyData = {
            sales: monthlyData.reduce((sum, month) => sum + month.sales, 0),
            orders: monthlyData.reduce((sum, month) => sum + month.orders, 0),
            products: monthlyData.reduce((sum, month) => sum + month.products, 0)
        };

        const displaySales = referenceMonth !== null && referenceData ? referenceData.sales : yearlyData.sales;
        const displayOrders = referenceMonth !== null && referenceData ? referenceData.orders : yearlyData.orders;
        const displayProducts = referenceMonth !== null && referenceData ? referenceData.products : yearlyData.products;

        // Comprueba si hay pedidos para el período seleccionado
        const hasOrdersForPeriod = this.filteredData.length > 0;

        const monthlySummaryContent = hasOrdersForPeriod ? `
            <div class="summary-item highlight">
                <div class="stat-value">${this.getCurrencySymbol()} ${displaySales.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                <div class="stat-label">${referenceMonth !== null ? 'Ventas del mes' : 'Ventas anuales'}</div>
                ${salesChangeHtml}
            </div>
            
            <div class="summary-item">
                <div class="stat-value">${displayOrders.toLocaleString('es-ES')}</div>
                <div class="stat-label">${referenceMonth !== null ? 'Pedidos' : 'Pedidos anuales'}</div>
                ${ordersChangeHtml}
            </div>
            
            <div class="summary-item">
                <div class="stat-value">${displayProducts.toLocaleString('es-ES')}</div>
                <div class="stat-label">Productos</div>
            </div>
        ` : `
            <div class="summary-item highlight" style="grid-column: 1 / -1; text-align: center;">
                <p>No hay pedidos para este periodo seleccionado.</p>
                <p class="stat-label">Intenta cambiar los filtros de fecha o periodo.</p>
            </div>
        `;


        container.innerHTML = `
            <div class="summary-card">
                <div class="summary-header">
                    <h3><i class="fas fa-chart-line"></i> ${title}</h3>
                    <span class="period-badge">${periodBadgeText}</span>
                </div>
                
                <div class="summary-grid">
                    ${monthlySummaryContent}
                    <div class="summary-item yearly">
                        <div class="stat-value">${this.getCurrencySymbol()} ${yearlyData.sales.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
                        <div class="stat-label">Ventas anuales totales</div>
                        <div class="stat-sub">${yearlyData.orders.toLocaleString('es-ES')} pedidos, ${yearlyData.products.toLocaleString('es-ES')} productos</div>
                    </div>
                </div>
            </div>
        `;
    }

    // Helper para obtener el índice del mes a partir del nombre
    getMonthIndex(monthName) {
        const months = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
                       'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        return months.indexOf(monthName);
    }

    // Obtiene datos mensuales para la comparación
    getMonthlyComparison(data) {
        const monthlyData = {};
        const currentYear = new Date().getFullYear();
        
        // Inicializar todos los meses del año actual
        for (let month = 0; month < 12; month++) {
            const key = `${currentYear}-${month}`;
            monthlyData[key] = {
                month: this.getMonthName(month),
                orders: 0,
                sales: 0,
                products: 0,
                hasData: false
            };
        }
        
        // Procesar los datos reales
        data.forEach(order => {
            const orderDate = order.date;
            const year = orderDate.getFullYear();
            const month = orderDate.getMonth();
            
            if (year === currentYear) {
                const key = `${year}-${month}`;
                monthlyData[key].orders++;
                monthlyData[key].sales += order.total || 0;
                monthlyData[key].products += order.productsCount || 0;
                monthlyData[key].hasData = true;
            }
        });
        
        return Object.values(monthlyData).sort((a, b) => {
            const monthA = this.getMonthIndex(a.month);
            const monthB = this.getMonthIndex(b.month);
            return monthA - monthB;
        });
    }

    // Renderiza el resumen diario (hoy y ayer)
    renderDailySummary() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Fecha de hoy sin horas/minutos
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1); // Fecha de ayer
    
        // Filtra pedidos de hoy y ayer
        const todayOrders = this.data.filter(order => { // Usa this.data para incluir todos los datos
            const orderDate = new Date(order.date.getFullYear(), order.date.getMonth(), order.date.getDate());
            return orderDate.getTime() === today.getTime();
        });
    
        const yesterdayOrders = this.data.filter(order => { // Usa this.data para incluir todos los datos
            const orderDate = new Date(order.date.getFullYear(), order.date.getMonth(), order.date.getDate());
            return orderDate.getTime() === yesterday.getTime();
        });
    
        // Calcula totales
        const todaySales = todayOrders.reduce((sum, order) => sum + order.total, 0);
        const yesterdaySales = yesterdayOrders.reduce((sum, order) => sum + order.total, 0);
    
        // Calcula porcentaje de cambio (evita división por cero)
        let salesChange = "N/A";
        let salesChangeClass = "";
        if (yesterdaySales > 0) {
            const change = ((todaySales - yesterdaySales) / yesterdaySales * 100).toFixed(1);
            salesChange = `${change}%`;
            salesChangeClass = change >= 0 ? 'positive' : 'negative';
        }
    
        // Actualiza HTML
        const container = document.getElementById('daily-summary');
        container.innerHTML = `
            <div class="summary-item">
                <h4><i class="fas fa-sun"></i> Hoy</h4>
                <div class="stat-value">${this.getCurrencySymbol()} ${todaySales.toFixed(2)}</div>
                <div class="stat-label">${todayOrders.length} pedidos</div>
            </div>
            <div class="summary-item">
                <h4><i class="fas fa-moon"></i> Ayer</h4>
                <div class="stat-value">${this.getCurrencySymbol()} ${yesterdaySales.toFixed(2)}</div>
                <div class="stat-change ${salesChangeClass}">
                    ${salesChange !== "N/A" ? `${salesChange}` : 'Sin datos previos'}
                </div>
            </div>
        `;
    }

    // Actualiza las estadísticas principales del dashboard
    updateStats(data) {
        if (!data || !Array.isArray(data)) return;
        
        // Calcula ventas totales en CUP
        const totalSalesCUP = data.reduce((acc, order) => acc + (order.total || 0), 0);
        
        // Calcula el valor promedio del pedido
        const avgOrderValue = data.length > 0 ? totalSalesCUP / data.length : 0;

        // Actualiza elementos del DOM
        document.getElementById('total-sales').textContent = 
            `${this.getCurrencySymbol()} ${totalSalesCUP.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        document.getElementById('avg-order-value').textContent = 
            `${this.getCurrencySymbol()} ${avgOrderValue.toLocaleString('es-ES', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        
        // Resto de las estadísticas
        const totalProducts = data.reduce((acc, order) => acc + (order.productsCount || 0), 0);
        const uniqueCustomers = new Set(data.map(order => order.correo_comprador).filter(Boolean)).size;
        
        document.getElementById('total-products').textContent = totalProducts.toLocaleString('es-ES');
        document.getElementById('total-orders').textContent = data.length.toLocaleString('es-ES');
        document.getElementById('unique-customers').textContent = uniqueCustomers.toLocaleString('es-ES');
    }

    // Inicializa los gráficos de Chart.js
    initCharts() {
        // Configuración común para los gráficos
        const gridColor = 'rgba(108, 117, 125, 0.1)'; // Usando text-secondary para la rejilla
        const textColor = '#333333'; // Usando text-primary para el texto
        const tooltipBg = 'rgba(255, 255, 255, 0.9)'; // White with opacity for tooltip
        const tooltipTextColor = '#333333'; // Dark text for tooltip

        // Gráfica de productos (bar)
        const productsCtx = document.getElementById('products-chart')?.getContext('2d');
        if (productsCtx) {
            this.charts.products = new Chart(productsCtx, {
                type: 'bar',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Unidades Vendidas',
                        data: [],
                        backgroundColor: '#4A90E2', // Accent color for product bars
                        borderRadius: 6,
                        borderWidth: 0,
                        hoverBackgroundColor: '#0056b3' // Darker accent on hover
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.raw} unidades vendidas`
                            },
                            backgroundColor: tooltipBg,
                            titleColor: tooltipTextColor,
                            bodyColor: tooltipTextColor,
                            borderColor: '#E0E0E0',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: gridColor },
                            ticks: { color: textColor }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: textColor }
                        }
                    }
                }
            });
        }

        // Gráfica de tendencia (line)
        const trendCtx = document.getElementById('sales-trend-chart')?.getContext('2d');
        if (trendCtx) {
            this.charts.salesTrend = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: [],
                    datasets: [{
                        label: 'Ventas (CUP)', // Etiqueta de ventas ahora con CUP
                        data: [],
                        borderColor: '#28A745', // Success color for sales trend line
                        backgroundColor: 'rgba(40, 167, 69, 0.1)', // Success color with opacity for fill
                        borderWidth: 3,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#28A745',
                        pointBorderColor: '#FFFFFF',
                        pointBorderWidth: 2,
                        pointRadius: 8,
                        pointHoverRadius: 5
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${this.getCurrencySymbol()} ${context.raw.toFixed(2)}` // Formato CUP en tooltip
                            },
                            backgroundColor: tooltipBg,
                            titleColor: tooltipTextColor,
                            bodyColor: tooltipTextColor,
                            borderColor: '#E0E0E0',
                            borderWidth: 1
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: gridColor },
                            ticks: { 
                                color: textColor,
                                callback: (value) => `${this.getCurrencySymbol()} ${value}` // Formato CUP en eje Y
                            }
                        },
                        x: {
                            grid: { color: gridColor },
                            ticks: { color: textColor }
                        }
                    }
                }
            });
        }
    }

    // Actualiza los datos de los gráficos con los datos filtrados
    updateCharts(data) {
        // La gráfica de países ha sido eliminada
        // Gráfica de productos
        if (this.charts.products) {
            const products = this.getTopProducts(data, 5);
            this.charts.products.data.labels = products.map(p => p.product || 'Sin nombre');
            this.charts.products.data.datasets[0].data = products.map(p => p.quantity || 0);
            
            this.charts.products.options.plugins.tooltip.callbacks.label = (context) => {
                const value = context.raw || 0;
                return `${value} unidades`;
            };
            this.charts.products.update();
            this.renderTopProducts(products); // Renderiza también la lista de productos
        }

        // Actualizar gráfica de tendencia
        if (this.charts.salesTrend) {
            const trendData = this.getSalesTrend(data);
            this.charts.salesTrend.data.labels = trendData.map(d => d.date);
            this.charts.salesTrend.data.datasets[0].data = trendData.map(d => d.total);
            
            // Actualizar tooltip con nuevos datos
            this.charts.salesTrend.options.plugins.tooltip.callbacks.afterBody = (context) => {
                const date = context[0].label;
                const dailyOrders = data.filter(o => {
                    const orderDate = o.date.toISOString().split('T')[0];
                    return orderDate === date;
                }).length;
                return [`Pedidos: ${dailyOrders}`];
            };
            
            this.charts.salesTrend.update();
        }
    }

    // Se ha eliminado getCountryDistribution()
    
    // Obtiene los productos más vendidos
    getTopProducts(data, limit = 10) {
        const products = data.reduce((acc, order) => {
            order.compras.forEach(product => {
                // Usa product.name ya que así se llama en el JSON original
                acc[product.name] = (acc[product.name] || 0) + product.quantity;
            });
            return acc;
        }, {});

        return Object.entries(products)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([product, quantity]) => ({ product, quantity }));
    }

    // Obtiene la tendencia de ventas por día
    getSalesTrend(data) {
        const dailySales = data.reduce((acc, order) => {
            const dateStr = order.date.toISOString().split('T')[0];
            acc[dateStr] = (acc[dateStr] || 0) + order.total;
            return acc;
        }, {});

        return Object.entries(dailySales)
            .map(([date, total]) => ({ date, total }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    // Se ha eliminado renderCountryDistribution()

    // Renderiza los productos principales en una lista
    renderTopProducts(productsData) {
        const container = document.getElementById('top-products');
        if (container) {
            container.innerHTML = productsData
                .map(({ product, quantity }) => `
                    <div class="ranking-item">
                        <span>${product}</span>
                        <span>${quantity} unidades</span>
                    </div>
                `).join('');
        }
    }

    // Renderiza la lista de transacciones (pedidos)
    renderTransactions(data) {
        const container = document.getElementById('data-list');
        if (!container) return;

        if (data.length === 0) {
            container.innerHTML = `
                <div class="text-center p-4" style="color: var(--text-secondary);">
                    <p><i class="fas fa-box-open"></i> No hay transacciones para mostrar con los filtros aplicados.</p>
                    <p>Intenta ajustar el rango de fechas o el periodo.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = data
            .sort((a, b) => b.date - a.date) // Ordena por fecha descendente
            .map(order => `
                <div class="order-card">
                    <div class="order-header">
                        <div class="order-main-info">
                            <h4>${order.nombre_comprador}</h4>
                            <div class="order-meta">
                                <span class="meta-item">
                                    <i class="fas fa-calendar"></i>
                                    ${order.dateStr}
                                </span>
                                <span class="meta-item">
                                    <i class="fas fa-user-tag"></i>
                                    ${order.tipo_usuario}
                                </span>
                            </div>
                            ${order.afiliado && order.afiliado !== 'Sin afiliado' ? `
                            <div class="affiliate-info">
                                <i class="fas fa-handshake"></i>
                                <span>Afiliado: ${order.afiliado}</span>
                            </div>
                            ` : ''}
                            <div class="traffic-source">
                                <i class="fas fa-route"></i>
                                <span>Origen: ${order.fuente_trafico}</span>
                            </div>
                        </div>
                        <div class="order-stats">
                            <div class="stat-value">${this.getCurrencySymbol()} ${order.total.toFixed(2)}</div>
                            <div class="stat-label">${order.productsCount} productos</div>
                        </div>
                    </div>
                    <div class="order-details">
                        <div class="products-list">
                            ${order.compras.map(product => `
                                <div class="product-item">
                                    <span>${product.name}</span>
                                    <span>${product.quantity} × ${this.getCurrencySymbol()} ${product.unitPrice}</span>
                                    ${product.discount > 0 ? `<span style="color: var(--error);">(-${product.discount}%)</span>` : ''}
                                </div>
                            `).join('')}
                        </div>
                        <div class="order-footer">
                            <div class="meta-item">
                                <i class="fas fa-map-marker-alt"></i>
                                ${order.direccion_envio}
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-desktop"></i>
                                ${order.navegador} / ${order.sistema_operativo}
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-phone"></i>
                                ${order.telefono_comprador}
                            </div>
                            <div class="meta-item">
                                <i class="fas fa-envelope"></i>
                                ${order.correo_comprador}
                            </div>
                        </div>
                    </div>
                </div>
            `).join('');
    }

    // Método para mostrar notificaciones
    showAlert(message, type = 'success') {
        const alert = document.createElement('div');
        alert.className = `alert ${type}`;
        alert.innerHTML = `
            ${type === 'loading' ? 
                '<i class="fas fa-spinner fa-spin"></i>' : 
                type === 'success' ? 
                '<i class="fas fa-check-circle"></i>' : 
                '<i class="fas fa-exclamation-circle"></i>'}
            <span>${message}</span>
            ${type !== 'loading' ? '<button class="close-alert"><i class="fas fa-times"></i></button>' : ''}
        `;
        
        document.body.appendChild(alert);
        
        if (type !== 'loading') {
            setTimeout(() => {
                alert.classList.add('show');
            }, 10);
            
            setTimeout(() => {
                alert.classList.remove('show');
                setTimeout(() => alert.remove(), 300);
            }, 7000);
        } else {
            alert.classList.add('show');
        }
        
        alert.querySelector('.close-alert')?.addEventListener('click', () => {
            alert.classList.remove('show');
            setTimeout(() => alert.remove(), 300);
        });
        
        return alert;
    }
}

// Inicializa la aplicación cuando el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', () => new DashboardApp());
