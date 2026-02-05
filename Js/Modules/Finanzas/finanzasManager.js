import { InventoryApiClient } from '../Inventory/inventoryApiClient.js';

export class FinanzasManager {
    constructor() {
        this.client = new InventoryApiClient();
        this.current = null;
        this.listeners = {};
        this.lastSave = null; // keep last save info (no persistent or in-memory full history retained)
    }

    on(event, cb) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(cb);
    }
    off(event, cb) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(f => f !== cb);
    }
    _emit(event, payload) {
        (this.listeners[event] || []).forEach(cb => { try { cb(payload); } catch (e) { console.warn('finanzas listener error', e); } });
    }

    async getValorDolar({ useCache = true } = {}) {
        const id = 'Valor_Dolar';
        const inv = await this.client.getInventory(id, { useCache, retries: 1 });
        this.current = inv;
        return inv;
    }

    /**
     * Calcula métricas financieras basadas en productos e inventario
     * @param {Array} products - Lista de productos desde products.json
     * @param {Number} tasaCambio - Valor del dólar actual
     * @param {Number} totalSales - Ventas totales del dashboard (USD)
     */
    async calculateFinancials(products, tasaCambio, totalSales = 0) {
        if (!products || !Array.isArray(products)) return null;
        
        // Obtener inventarios en lote
        const ids = products.map(p => p.id);
        const inventories = await this.client.getInventoriesBulk(ids);
        
        let totalCostoUSD = 0;
        let totalVentaUSD = 0;
        let totalItems = 0;
        let totalProductos = 0;
        let productosConStock = 0;
        const detalles = [];
        
        // Base URL para imágenes de GitHub
        const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/HCoreBeat/Buquenque/main/Images/products/';

        products.forEach(p => {
            const inv = inventories[p.id] || {};
            const stock = Number(inv.stock) || 0;
            const costoCUP = Number(inv.precio_compra) || 0; // Costo en CUP según feedback
            
            // El precio en products.json es USD (campo 'precio')
            // ProductManager ya calcula 'precioFinal' considerando ofertas
            // Si no existe precioFinal, usar precio normal
            let ventaUSD = p.precioFinal !== undefined ? p.precioFinal : (p.precio || 0);
            
            // Asegurar que sea número
            ventaUSD = Number(ventaUSD) || 0;

            const ventaCUP = ventaUSD * tasaCambio;

            const totalCostoCUP = stock * costoCUP;
            const totalVentaCUP = stock * ventaCUP;
            
            const gananciaCUP = totalVentaCUP - totalCostoCUP;
            const gananciaUSD = tasaCambio > 0 ? gananciaCUP / tasaCambio : 0;
            
            const margen = ventaCUP > 0 ? ((ventaCUP - costoCUP) / ventaCUP) * 100 : 0;
            const roi = costoCUP > 0 ? ((ventaCUP - costoCUP) / costoCUP) * 100 : 0;

            totalProductos++;
            if (stock > 0) {
                productosConStock++;
                totalCostoUSD += (tasaCambio > 0 ? totalCostoCUP / tasaCambio : 0);
                totalVentaUSD += ventaUSD * stock;
                totalItems += stock;
            }

            // Usar imagen normalizada por ProductManager
            let imageUrl = p.imagenUrl || 'Img/no_image.jpg';

            detalles.push({
                id: p.id,
                name: p.nombre || p.name, // products.json usa "nombre"
                image: imageUrl,
                stock,
                costoUnitario: costoCUP, // CUP
                precioVenta: ventaUSD,   // USD
                precioVentaCUP: ventaCUP, // CUP
                totalCosto: totalCostoCUP, // CUP
                totalVenta: totalVentaCUP, // CUP
                ganancia: gananciaCUP,     // CUP
                gananciaUSD: gananciaUSD,  // USD
                margen,
                roi,
                enOferta: p.oferta === true,
                descuento: p.descuento
            });
        });

        // No ordenar, respetar orden del JSON
        // detalles.sort((a, b) => b.ganancia - a.ganancia);

        // Calcular Pago del Programador basado en Ventas Reales (totalSales)
        const pagoProgramadorUSD = (Number(totalSales) || 0) * 0.05;
        const pagoProgramadorCUP = pagoProgramadorUSD * tasaCambio;
        
        // Calcular estadísticas adicionales
        const gananciasArray = detalles.filter(d => d.ganancia > 0).map(d => d.ganancia);
        const margenPromedio = detalles.length > 0 ? detalles.reduce((sum, d) => sum + d.margen, 0) / detalles.length : 0;
        const margenMaximo = detalles.length > 0 ? Math.max(...detalles.map(d => d.margen)) : 0;
        const margenMinimo = detalles.length > 0 ? Math.min(...detalles.map(d => d.margen)) : 0;

        return {
            totales: {
                costoUSD: totalCostoUSD,
                ventaUSD: totalVentaUSD,
                gananciaUSD: totalVentaUSD - totalCostoUSD,
                items: totalItems,
                costoCUP: totalCostoUSD * tasaCambio,
                ventaCUP: totalVentaUSD * tasaCambio,
                gananciaCUP: (totalVentaUSD - totalCostoUSD) * tasaCambio,
                pagoProgramadorUSD: pagoProgramadorUSD,
                pagoProgramadorCUP: pagoProgramadorCUP,
                tasa: tasaCambio,
                totalProductos,
                productosConStock,
                productosSinStock: totalProductos - productosConStock,
                margenPromedio,
                margenMaximo,
                margenMinimo
            },
            detalles
        };
    }

    async savePrecio(precio) {
        const id = 'Valor_Dolar';
        this._emit('saving', { precio });
        try {
            // Preserve other fields from current or fetch
            const current = this.current || await this.getValorDolar({ useCache: true });
            const payload = {
                stock: current && current.stock !== undefined && current.stock !== null ? current.stock : 0,
                precio_compra: precio,
                proveedor: current && current.proveedor !== undefined ? current.proveedor : null,
                notas: current && current.notas ? current.notas : 'Valor_Dolar'
            };
            const saved = await this.client.saveInventory(id, payload);
            // update current
            this.current = saved;
            // last save
            this.lastSave = { precio, ts: Date.now(), status: 'ok', saved };
            this._emit('saved', { precio, saved });
            return saved;
        } catch (err) {
            this.lastSave = { precio, ts: Date.now(), status: 'error', message: err.message };
            this._emit('error', { precio, error: err });
            throw err;
        }
    }

    // History removed: no persistent or in-memory full history retained.
    getLastSave() {
        return this.lastSave;
    }
}

export default FinanzasManager;
