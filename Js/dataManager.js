/**
 * Módulo de manejo de datos
 */

import { getMonthName, formatDate, getMonthIndex } from './utils.js';

export class DataManager {
    constructor() {
        this.data = [];
        this.filteredData = [];
    }

    /**
     * Carga los datos desde el archivo JSON
     */
    async loadData() {
        try {
            const response = await fetch('Json/my_data.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.data = await response.json();
            
            if (!Array.isArray(this.data)) {
                throw new Error('Datos inválidos: el JSON no es un array');
            }
            
            this.normalizeData();
            this.filteredData = [...this.data];
            return this.data;
        } catch (error) {
            console.error('Error al cargar los datos:', error);
            throw error;
        }
    }

    /**
     * Normaliza la estructura de los datos
     */
    normalizeData() {
        this.data.forEach(item => {
            // Convierte fecha a objeto Date
            item.date = new Date(item.fecha_hora_entrada);
            item.dateStr = formatDate(item.date);
            
            // Parsea el precio
            item.total = parseFloat(item.precio_compra_total) || 0;
            
            // Conteo de productos
            item.productsCount = item.compras.reduce((acc, curr) => acc + (curr.quantity || 0), 0);

            // Mapea propiedades
            item.userType = item.tipo_usuario || 'No especificado';
            item.affiliate = item.afiliado || 'Sin afiliado';
            item.country = item.pais || 'No especificado';
            item.buyerName = item.nombre_comprador || 'Desconocido';
            item.buyerPhone = item.telefono_comprador || 'No especificado';
            item.buyerEmail = item.correo_comprador || 'No especificado';
            item.shippingAddress = item.direccion_envio || 'No especificada';
            item.browser = item.navegador || 'No especificado';
            item.operatingSystem = item.sistema_operativo || 'No especificado';
            item.trafficSource = item.fuente_trafico || 'No especificado';

            // Campo de búsqueda
            item.searchText = `${item.buyerName} ${item.country} ${item.userType} ${item.affiliate} ${item.buyerPhone} ${item.buyerEmail} ${item.shippingAddress} ${item.browser} ${item.operatingSystem} ${item.trafficSource}`.toLowerCase();

            // Normaliza productos
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

    /**
     * Filtra los datos por rango de fechas y período
     */
    filterByDateRange(startDate = null, endDate = null, period = 'all') {
        const now = new Date();
        let periodStart, periodEnd;
        
        switch (period) {
            case 'month':
                periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
                periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                periodEnd.setHours(23, 59, 59, 999);
                break;
            case 'last-month':
                periodStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                periodEnd = new Date(now.getFullYear(), now.getMonth(), 0);
                periodEnd.setHours(23, 59, 59, 999);
                break;
            case 'year':
                periodStart = new Date(now.getFullYear(), 0, 1);
                periodEnd = new Date(now.getFullYear(), 11, 31);
                periodEnd.setHours(23, 59, 59, 999);
                break;
            default:
                periodStart = null;
                periodEnd = null;
        }
        
        this.filteredData = this.data.filter(item => {
            const itemDate = item.date;
            const itemDateStr = itemDate.toISOString().split('T')[0];

            const dateInRange =
                (!startDate || itemDateStr >= startDate) &&
                (!endDate || itemDateStr <= endDate);
                
            const periodInRange =
                !periodStart ||
                (itemDate >= periodStart && itemDate <= periodEnd);
                
            return dateInRange && periodInRange;
        });
        
        return this.filteredData;
    }

    /**
     * Busca en los datos
     */
    search(searchTerm) {
        const term = searchTerm.toLowerCase();
        this.filteredData = this.data.filter(item =>
            item.searchText.includes(term)
        );
        return this.filteredData;
    }

    /**
     * Filtra por tipo de transacción (afiliado/directo)
     */
    filterByTransactionType(type = 'all') {
        if (type === 'affiliated') {
            return this.filteredData.filter(order => 
                order.afiliado && order.afiliado !== 'Sin afiliado'
            );
        } else if (type === 'direct') {
            return this.filteredData.filter(order => 
                !order.afiliado || order.afiliado === 'Sin afiliado'
            );
        }
        return this.filteredData;
    }

    /**
     * Calcula estadísticas generales
     */
    getStats(data = this.filteredData) {
        const totalSales = data.reduce((acc, order) => acc + (order.total || 0), 0);
        const avgOrderValue = data.length > 0 ? totalSales / data.length : 0;
        const totalProducts = data.reduce((acc, order) => acc + (order.productsCount || 0), 0);
        const uniqueCustomers = new Set(data.map(order => order.correo_comprador).filter(Boolean)).size;

        return {
            totalSales,
            avgOrderValue,
            totalProducts,
            totalOrders: data.length,
            uniqueCustomers
        };
    }

    /**
     * Obtiene datos mensuales comparativos
     */
    getMonthlyComparison(data = this.data) {
        const monthlyData = {};
        const currentYear = new Date().getFullYear();
        
        for (let month = 0; month < 12; month++) {
            const key = `${currentYear}-${month}`;
            monthlyData[key] = {
                month: getMonthName(month),
                orders: 0,
                sales: 0,
                products: 0,
                hasData: false
            };
        }
        
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
            const monthA = getMonthIndex(a.month);
            const monthB = getMonthIndex(b.month);
            return monthA - monthB;
        });
    }

    /**
     * Obtiene los productos más vendidos
     */
    getTopProducts(data = this.filteredData, limit = 10) {
        const products = data.reduce((acc, order) => {
            order.compras.forEach(product => {
                acc[product.name] = (acc[product.name] || 0) + product.quantity;
            });
            return acc;
        }, {});

        return Object.entries(products)
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([product, quantity]) => ({ product, quantity }));
    }

    /**
     * Obtiene la tendencia de ventas por día
     */
    getSalesTrend(data = this.filteredData) {
        const dailySales = data.reduce((acc, order) => {
            const dateStr = order.date.toISOString().split('T')[0];
            acc[dateStr] = (acc[dateStr] || 0) + order.total;
            return acc;
        }, {});

        return Object.entries(dailySales)
            .map(([date, total]) => ({ date, total }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
    }

    /**
     * Obtiene resumen diario (hoy y ayer)
     */
    getDailySummary() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
    
        const todayOrders = this.data.filter(order => {
            const orderDate = new Date(order.date.getFullYear(), order.date.getMonth(), order.date.getDate());
            return orderDate.getTime() === today.getTime();
        });
    
        const yesterdayOrders = this.data.filter(order => {
            const orderDate = new Date(order.date.getFullYear(), order.date.getMonth(), order.date.getDate());
            return orderDate.getTime() === yesterday.getTime();
        });
    
        const todaySales = todayOrders.reduce((sum, order) => sum + order.total, 0);
        const yesterdaySales = yesterdayOrders.reduce((sum, order) => sum + order.total, 0);
    
        let salesChange = "N/A";
        let salesChangeClass = "";
        if (yesterdaySales > 0) {
            const change = ((todaySales - yesterdaySales) / yesterdaySales * 100).toFixed(1);
            salesChange = `${change}%`;
            salesChangeClass = change >= 0 ? 'positive' : 'negative';
        }

        return {
            todaySales,
            todayOrders: todayOrders.length,
            yesterdaySales,
            yesterdayOrders: yesterdayOrders.length,
            salesChange,
            salesChangeClass
        };
    }
}
