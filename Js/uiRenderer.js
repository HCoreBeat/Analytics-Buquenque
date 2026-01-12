/**
 * Módulo de renderizado de UI
 */

import { getCurrencySymbol, formatCurrency, formatNumber, getMonthName, getMonthIndex } from './utils.js';

export class UIRenderer {
    /**
     * Renderiza resumen general
     */
    static renderGeneralSummary(container, monthlyData, filteredData, period) {
        if (!container) return;

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        let referenceMonth = currentMonth;
        let title = `Resumen ${currentYear}`;
        let periodBadgeText = 'Anual';

        if (period === 'month') {
            title = `Resumen ${getMonthName(currentMonth)}`;
            periodBadgeText = getMonthName(currentMonth);
        } else if (period === 'last-month') {
            referenceMonth = (currentMonth - 1 + 12) % 12;
            title = `Resumen ${getMonthName(referenceMonth)}`;
            periodBadgeText = getMonthName(referenceMonth);
        } else {
            referenceMonth = null;
        }

        const referenceData = referenceMonth !== null ?
            monthlyData.find(m => getMonthIndex(m.month) === referenceMonth) ||
            { month: getMonthName(referenceMonth), orders: 0, sales: 0, products: 0 }
            : null;

        const yearlyData = {
            sales: monthlyData.reduce((sum, month) => sum + month.sales, 0),
            orders: monthlyData.reduce((sum, month) => sum + month.orders, 0),
            products: monthlyData.reduce((sum, month) => sum + month.products, 0)
        };

        const displaySales = referenceMonth !== null && referenceData ? referenceData.sales : yearlyData.sales;
        const displayOrders = referenceMonth !== null && referenceData ? referenceData.orders : yearlyData.orders;
        const displayProducts = referenceMonth !== null && referenceData ? referenceData.products : yearlyData.products;

        const hasOrdersForPeriod = filteredData.length > 0;

        const monthlySummaryContent = hasOrdersForPeriod ? `
            <div class="summary-item highlight">
                <div class="stat-value">${formatCurrency(displaySales)}</div>
                <div class="stat-label">${referenceMonth !== null ? 'Ventas del mes' : 'Ventas anuales'}</div>
            </div>
            
            <div class="summary-item">
                <div class="stat-value">${formatNumber(displayOrders)}</div>
                <div class="stat-label">${referenceMonth !== null ? 'Pedidos' : 'Pedidos anuales'}</div>
            </div>
            
            <div class="summary-item">
                <div class="stat-value">${formatNumber(displayProducts)}</div>
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
                        <div class="stat-value">${formatCurrency(yearlyData.sales)}</div>
                        <div class="stat-label">Ventas anuales totales</div>
                        <div class="stat-sub">${formatNumber(yearlyData.orders)} pedidos, ${formatNumber(yearlyData.products)} productos</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Renderiza resumen diario
     */
    static renderDailySummary(container, dailySummary) {
        if (!container) return;

        const { todaySales, todayOrders, yesterdaySales, yesterdayOrders, salesChange, salesChangeClass } = dailySummary;

        container.innerHTML = `
            <div class="summary-item">
                <h4><i class="fas fa-sun"></i> Hoy</h4>
                <div class="stat-value">${formatCurrency(todaySales)}</div>
                <div class="stat-label">${formatNumber(todayOrders)} pedidos</div>
            </div>
            <div class="summary-item">
                <h4><i class="fas fa-moon"></i> Ayer</h4>
                <div class="stat-value">${formatCurrency(yesterdaySales)}</div>
                <div class="stat-change ${salesChangeClass}">
                    ${salesChange !== "N/A" ? `${salesChange}` : 'Sin datos previos'}
                </div>
            </div>
        `;
    }

    /**
     * Actualiza estadísticas
     */
    static updateStats(stats) {
        document.getElementById('total-sales').textContent = formatCurrency(stats.totalSales);
        document.getElementById('avg-order-value').textContent = formatCurrency(stats.avgOrderValue);
        document.getElementById('total-products').textContent = formatNumber(stats.totalProducts);
        document.getElementById('total-orders').textContent = formatNumber(stats.totalOrders);
        document.getElementById('unique-customers').textContent = formatNumber(stats.uniqueCustomers);
    }

    /**
     * Renderiza lista de productos top
     */
    static renderTopProducts(container, productsData) {
        if (!container) return;

        container.innerHTML = productsData
            .map(({ product, quantity }) => `
                <div class="ranking-item">
                    <span>${product}</span>
                    <span>${formatNumber(quantity)} unidades</span>
                </div>
            `).join('');
    }

    /**
     * Renderiza transacciones
     */
    static renderTransactions(container, data, onReceiptClick) {
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
            .sort((a, b) => b.date - a.date)
            .map((order, idx) => `
                <div class="order-card" data-order-idx="${idx}">
                    <div class="order-header">
                        <div class="order-main-info">
                            <div class="customer-header">
                                <div class="customer-avatar">
                                    <span>${order.nombre_comprador.charAt(0).toUpperCase()}</span>
                                </div>
                                <h4>${order.nombre_comprador}</h4>
                            </div>
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
                            <div class="stat-value">${formatCurrency(order.total)}</div>
                            <div class="stat-label">${formatNumber(order.productsCount)} productos</div>
                        </div>
                    </div>
                    <div class="order-details">
                        <div class="products-list">
                            ${order.compras.map(product => `
                                <div class="product-item">
                                    <span>${product.name}</span>
                                    <span>${product.quantity} × ${getCurrencySymbol()} ${product.unitPrice}</span>
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
                        <div class="receipt-btn-container" style="text-align:right;margin-top:10px;">
                            <button class="btn btn-secondary download-receipt-btn" data-order-idx="${idx}"><i class="fas fa-file-download"></i> Descargar Recibo</button>
                        </div>
                    </div>
                </div>
            `).join('');

        // Agregar listeners
        container.querySelectorAll('.download-receipt-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = btn.getAttribute('data-order-idx');
                onReceiptClick(data[idx], idx);
            });
        });

        // Listeners para expandir/contraer detalles
        container.querySelectorAll('.order-header').forEach(header => {
            header.addEventListener('click', () => {
                const details = header.closest('.order-card').querySelector('.order-details');
                details.classList.toggle('active');
            });
        });
    }

    /**
     * Genera recibo descargable
     */
    static async generateReceipt(order) {
        const now = new Date();
        const fechaDescarga = now.toLocaleDateString('es-ES', { 
            day: '2-digit', 
            month: '2-digit', 
            year: 'numeric' 
        }) + ' ' + now.toLocaleTimeString('es-ES', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });

        const receiptHtml = `
            <div id="receipt-content" style="width:370px;padding:28px 20px;background:#fff;border:1.5px solid #e3e6e8;border-radius:10px;box-shadow:0 2px 12px #0001;font-family:Arial,sans-serif;color:#222;">
                <div style="text-align:center;margin-bottom:10px;">
                    <div style="font-size:18px;font-weight:bold;color:#3B82F6;">BUQUENQUE</div>
                    <div style="font-size:13px;color:#888;">Recibo de Pago</div>
                </div>
                <hr style="margin:10px 0 14px 0;border:0;border-top:1.5px solid #e3e6e8;">
                <div style="font-size:15px;margin-bottom:8px;"><b>Cliente:</b> ${order.nombre_comprador}</div>
                <div style="font-size:13px;margin-bottom:8px;"><b>Fecha:</b> ${fechaDescarga}</div>
                <div style="background:#f6f6f6;padding:10px 12px;border-radius:6px;margin-bottom:10px;">
                    <div style="font-size:14px;margin-bottom:6px;"><b>Productos:</b></div>
                    <table style="width:100%;font-size:13px;border-collapse:collapse;">
                        <thead>
                            <tr style="color:#888;text-align:left;">
                                <th style="padding-bottom:3px;">Producto</th>
                                <th style="padding-bottom:3px;">Cantidad</th>
                                <th style="padding-bottom:3px;">Precio</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${order.compras.map(p => `
                                <tr>
                                    <td>${p.name}${p.discount > 0 ? ` <span style='color:#EF4444;'>(-${p.discount}%)</span>` : ''}</td>
                                    <td>${p.quantity}</td>
                                    <td>${formatCurrency(p.unitPrice * p.quantity * (1 - (p.discount || 0)/100))}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="font-size:15px;margin-bottom:8px;text-align:right;"><b>Total:</b> <span style='color:#10B981;font-weight:bold;'>${formatCurrency(order.total)}</span></div>
                <div style="margin-top:18px;text-align:center;font-size:13px;color:#3B82F6;">¡Gracias por su compra!<br>Buquenque</div>
            </div>
        `;

        let preview = document.createElement('div');
        preview.style.position = 'fixed';
        preview.style.left = '-9999px';
        preview.innerHTML = receiptHtml;
        document.body.appendChild(preview);

        await new Promise(r => setTimeout(r, 100));

        if (window.html2canvas) {
            const canvas = await window.html2canvas(preview.querySelector('#receipt-content'));
            const filename = `recibo_buquenque_${order.nombre_comprador.replace(/\s+/g,'_')}_${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}.png`;
            
            const link = document.createElement('a');
            link.download = filename;
            link.href = canvas.toDataURL('image/png');
            link.click();
        }

        document.body.removeChild(preview);
    }
}
