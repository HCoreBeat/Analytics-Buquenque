/**
 * Renderizador de UI para el Sistema de Inventario
 * Genera HTML dinámico para productos, modales y staging panel
 */

import { createObjectURL, revokeObjectURL, base64ToDataURL } from './inventoryUtils.js';
import { GitHubSaveModal } from './githubSaveModal.js';
import { GitHubImagesModal } from './githubImagesModal.js';

export class InventoryUIRenderer {
    constructor(containerSelector = '#inventory-view') {
        this.container = document.querySelector(containerSelector);
        this.productManager = null;
    }

    /**
     * Inicializa la UI del inventario
     */
    async initInventoryUI(productManager) {
        this.productManager = productManager;
        this.renderInventoryTemplate();
        this.setupEventListeners();

        // Modal de guardado en GitHub
        try {
            this.githubSaveModal = new GitHubSaveModal();
        } catch (e) {
            console.warn('No se pudo inicializar GitHubSaveModal', e);
            this.githubSaveModal = null;
        }

        // Estado inicial: mostrar Productos (grid visible), ocultar Cambios (staging panel hidden)
        const btnProducts = document.getElementById('btn-view-products');
        const btnChanges = document.getElementById('btn-view-changes');
        const productsGrid = document.getElementById('products-grid');
        const stagingPanel = document.getElementById('staging-panel');

        // Botones: Productos activo, Cambios inactivo
        if (btnProducts) btnProducts.classList.add('active');
        if (btnChanges) btnChanges.classList.remove('active');

        // Vistas: Productos visible, Cambios (panel) oculto
        if (productsGrid) productsGrid.classList.remove('hidden');
        if (stagingPanel) stagingPanel.classList.add('hidden'); // FUERZA: panel siempre inicia oculto

        // Cargar productos inicialmente
        await this.productManager.loadProducts();
        this.updateCategoryFilter();
        this.renderProductsGrid();

        // Actualizar contenido y badge del panel de staging (SIN cambiar su visibilidad)
        this.updateStagingPanel();
    }

    /**
     * Renderiza el template principal del inventario
     */
    renderInventoryTemplate() {
        this.container.innerHTML = `
            <div class="inventory-header">
                <h2><i class="fas fa-boxes"></i> Gestión de Inventario</h2>
                <div class="inventory-actions">
                    <div class="inventory-view-toggle" style="display:flex; gap:0.5rem; align-items:center;">
                        <button class="btn btn-outline active" id="btn-view-products">Productos</button>
                        <button class="btn btn-outline" id="btn-view-changes">Cambios</button>
                    </div>

                    <button class="btn btn-primary" id="btn-add-product">
                        <i class="fas fa-plus"></i> Nuevo Producto
                    </button>
                    <button class="btn btn-outline" id="btn-manage-repo-images">
                        <i class="fas fa-images"></i> Imágenes Repo
                    </button>
                    <button class="btn btn-secondary" id="btn-refresh-products">
                        <i class="fas fa-sync-alt"></i> Recargar
                    </button>
                </div>
            </div>

            <!-- Panel de Staging -->
            <div class="staging-panel hidden" id="staging-panel">
                <div class="staging-header">
                    <div class="staging-title">
                        <i class="fas fa-code-branch"></i>
                        <span>Cambios Pendientes en Staging</span>
                    </div>
                </div>

                <div class="staging-stats" id="staging-stats"></div>

                <!-- Las pestañas se crean dinámicamente -->
                <!-- staging-tabs, staging-tab-content se insertan aquí -->

                <div class="staging-actions">
                    <button class="btn-discard-all" id="btn-discard-all">
                        <i class="fas fa-trash"></i> Descartar Todos
                    </button>
                    <button class="btn-sync-github" id="btn-sync-github">
                        <i class="fas fa-cloud-upload-alt"></i> Sincronizar con Base de Datos
                    </button>
                </div>
            </div>

            <!-- Toolbar -->
            <div class="inventory-toolbar">
                <div class="search-box">
                    <i class="fas fa-search"></i>
                    <input type="text" id="search-products" placeholder="Buscar productos...">
                </div>
                <div class="filter-controls">
                    <select class="filter-select" id="filter-category">
                        <option value="">Todas las categorías</option>
                    </select>
                </div>
            </div>

            <!-- Grid de Productos -->
            <div class="products-grid" id="products-grid">
                <div class="empty-state">
                    <i class="fas fa-spinner-third"></i>
                    <p>Cargando productos...</p>
                </div>
            </div>
        `;

        // Agregar estilos si no existen
        if (!document.querySelector('link[href*="inventory.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'Css/inventory.css';
            document.head.appendChild(link);
        }
    }

    /**
     * Renderiza la grid de productos
     */
    renderProductsGrid(products = null) {
        const grid = document.getElementById('products-grid');
        const productsToRender = products || this.productManager.products;

        if (!grid) return;

        if (productsToRender.length === 0) {
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox"></i>
                    <p>No hay productos para mostrar</p>
                </div>
            `;
            return;
        }

        grid.innerHTML = productsToRender.map(product => this.createProductCard(product)).join('');

        // Event listeners para acciones de productos
        grid.querySelectorAll('.btn-product-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const productId = btn.dataset.productId;
                this.openProductModal(productId, 'edit');
            });
        });

        grid.querySelectorAll('.btn-product-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const productId = btn.dataset.productId;
                if (confirm('¿Estás seguro de que deseas eliminar este producto?')) {
                    this.handleDeleteProduct(productId);
                }
            });
        });
    }

    /**
     * Crea el HTML de una tarjeta de producto
     */
    createProductCard(product) {
        const discount = product.descuento ? `<span class="product-price-original">$${product.precio.toFixed(2)}</span>` : '';
        const isModified = this.productManager.getStagedChanges().some(c => c.productId === product.id && c.type === 'modify');

        return `
            <div class="product-card ${isModified ? 'modified' : ''}">
                <div class="product-image">
                    <img src="${product.imagenUrl}" alt="${product.nombre}" onerror="this.src='Img/no_image.jpg'">
                    ${product.nuevo ? '<span class="product-badge new">Nuevo</span>' : ''}
                    ${product.oferta ? '<span class="product-badge sale">Oferta</span>' : ''}
                    ${isModified ? '<span class="product-badge modified">Modificado</span>' : ''}
                </div>
                <div class="product-info">
                    <div class="product-name">${product.nombre}</div>
                    <div class="product-category">${product.categoria}</div>
                    <div class="product-description">${product.descripcion || 'Sin descripción'}</div>
                    <div class="product-footer">
                        <div class="product-price">
                            <div class="product-price-final">$${product.precioFinal.toFixed(2)}</div>
                            ${discount}
                        </div>
                        <div class="product-actions">
                            <button class="btn-product-edit" data-product-id="${product.id}">
                                <i class="fas fa-edit"></i>
                            </button>
                            <button class="btn-product-delete" data-product-id="${product.id}">
                                <i class="fas fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Actualiza el panel de staging (SOLO contenido, NO visibilidad)
     * La visibilidad es controlada ÚNICAMENTE por los botones Productos/Cambios
     */
    updateStagingPanel() {
        const panel = document.getElementById('staging-panel');
        const stats = this.productManager.getStagingStats();


        // Actualizar badge en la cabecera
        const headerChangesBtn = document.getElementById('btn-view-changes');
        if (headerChangesBtn) {
            let badge = headerChangesBtn.querySelector('.header-changes-badge');
            if (stats.total > 0) {
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'header-changes-badge';
                    headerChangesBtn.appendChild(badge);
                }
                badge.textContent = stats.total;
            } else if (badge) {
                badge.remove();
            }
        }

        // Limpiar lista anterior
        const existingList = panel.querySelector('.staging-changes-simple');
        if (existingList) existingList.remove();
        const existingEmpty = panel.querySelector('.staging-empty-message');
        if (existingEmpty) existingEmpty.remove();

        // Si no hay cambios, mostrar mensaje vacío (SIN controlar visibilidad)
        if (stats.total === 0) {
            // Mostrar mensaje vacío
            document.getElementById('staging-stats').innerHTML = `
                <div class="stat-badge images">
                    <i class="fas fa-image"></i>
                    <span>${stats.withImages} Con imagen${stats.withImages !== 1 ? 's' : ''}</span>
                </div>
            `;

            const emptyMsg = document.createElement('div');
            emptyMsg.className = 'staging-empty-message';
            emptyMsg.style.padding = '1rem';
            emptyMsg.style.color = '#7f8c8d';
            emptyMsg.textContent = 'No hay cambios en staging';
            const actions = panel.querySelector('.staging-actions');
            if (actions) actions.insertAdjacentElement('beforebegin', emptyMsg);

            return;
        }

        // Actualizar estadísticas
        const statsHtml = `
            <div class="stat-badge new">
                <i class="fas fa-plus-circle"></i>
                <span>${stats.new} Nuevo${stats.new !== 1 ? 's' : ''}</span>
            </div>
            <div class="stat-badge modify">
                <i class="fas fa-edit"></i>
                <span>${stats.modify} Modificado${stats.modify !== 1 ? 's' : ''}</span>
            </div>
            <div class="stat-badge delete">
                <i class="fas fa-trash"></i>
                <span>${stats.delete} Eliminado${stats.delete !== 1 ? 's' : ''}</span>
            </div>
            <div class="stat-badge images">
                <i class="fas fa-image"></i>
                <span>${stats.withImages} Con imagen${stats.withImages !== 1 ? 's' : ''}</span>
            </div>
        `;

        document.getElementById('staging-stats').innerHTML = statsHtml;

        // Renderizar cambios
        this.renderStagedChanges();
    }

    /**
     * Renderiza la lista de cambios en staging (SIN TABS)
     */
    renderStagedChanges() {
        const stagingPanel = document.getElementById('staging-panel');
        if (!stagingPanel) return;

        const changes = this.productManager.getStagedChanges();

        // Si no hay cambios, no renderizar nada (el panel ya muestra "Sin cambios")
        if (changes.length === 0) {
            return;
        }

        // Limpiar lista anterior
        const existingList = stagingPanel.querySelector('.staging-changes-simple');
        if (existingList) existingList.remove();

        // Construir HTML de cambios
        const changesHTML = changes.map(change => `
            <div class="change-item ${change.type}" data-change-id="${change.id}">
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    <span class="change-type ${change.type}">
                        <i class="fas ${this.getChangeIcon(change.type)}"></i>
                        ${change.type.charAt(0).toUpperCase() + change.type.slice(1)}
                    </span>
                    <div class="change-product-name">${change.productData.nombre}</div>
                    ${change.hasNewImage ? '<i class="fas fa-image" style="color: #3498db; font-size: 0.9rem;"></i>' : ''}
                </div>
                <div class="change-actions">
                    <button class="btn-view-change" data-change-id="${change.id}"><i class="fas fa-eye"></i> Ver</button>
                    <button class="btn-discard-change" data-change-id="${change.id}">
                        <i class="fas fa-times"></i> Descartar
                    </button>
                </div>
                <div class="change-preview" id="change-preview-${change.id}" style="display:none; margin-top:0.5rem; padding:0.75rem; border:1px solid #eee; border-radius:4px;">
                    <div style="display:flex; gap:0.75rem; align-items:flex-start;">
                        <div style="flex:1;">
                            <div><strong>Categoría:</strong> ${change.productData.categoria || '—'}</div>
                            <div><strong>Precio:</strong> $${change.productData.precio || '—'}</div>
                            <div><strong>Descuento:</strong> ${change.productData.descuento || 0}%</div>
                            <div><strong>Oferta:</strong> ${change.productData.oferta ? 'Sí' : 'No'}</div>
                            <div style="margin-top:0.5rem;"><strong>Descripción:</strong><div>${change.productData.descripcion || '—'}</div></div>
                        </div>
                        <div style="width:120px;">
                            <div id="change-preview-img-${change.id}"></div>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');

        // Crear contenedor y agregar HTML
        const changesContent = `<div id="staging-changes-list" class="staging-changes-simple">${changesHTML}</div>`;

        // Insertar cambios después del stats
        const statsDiv = stagingPanel.querySelector('.staging-stats');
        if (statsDiv) {
            statsDiv.insertAdjacentHTML('afterend', changesContent);
        }

        // Event listeners para Ver previews
        const changesList = stagingPanel.querySelector('#staging-changes-list');
        if (changesList) {
            changesList.querySelectorAll('.btn-view-change').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = btn.dataset.changeId;
                    const preview = document.getElementById(`change-preview-${id}`);
                    if (!preview) return;
                    preview.style.display = preview.style.display === 'none' ? 'block' : 'none';

                    // Cargar imagen si existe
                    const change = this.productManager.getStagedChanges().find(c => c.id === id);
                    if (!change) return;

                    const imgContainer = document.getElementById(`change-preview-img-${id}`);
                    if (!imgContainer) return;

                    imgContainer.innerHTML = '';

                    if (change.hasNewImage && change.imageKey) {
                        try {
                            const img = await this.productManager.stagingDB.getImageFromIDB(change.imageKey);
                            if (img && img.base64) {
                                const src = base64ToDataURL(img.base64, img.mimeType || 'image/jpeg');
                                imgContainer.innerHTML = `<img src="${src}" style="max-width:100%; border-radius:4px; border:1px solid #ddd;">`;
                            }
                        } catch (err) {
                            console.warn('No se pudo cargar imagen:', err);
                        }
                    } else if (change.productData.imagenes && change.productData.imagenes.length > 0) {
                        const imgName = change.productData.imagenes[0];
                        try {
                            const src = imgName.startsWith('http') ? imgName : this.productManager.getImageUrl(imgName);
                            imgContainer.innerHTML = `<img src="${src}" style="max-width:100%; border-radius:4px; border:1px solid #ddd;">`;
                        } catch (err) {
                            console.warn('No se pudo cargar URL:', err);
                        }
                    }
                });
            });

            // Descartar cambio
            changesList.querySelectorAll('.btn-discard-change').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = btn.dataset.changeId;
                    try {
                        await this.handleDiscardChange(id);
                    } catch (error) {
                        this.showNotification(`Error: ${error.message}`, 'error');
                    }
                });
            });
        }
    }

    /**
     * Obtiene el icono según el tipo de cambio
     */
    getChangeIcon(type) {
        switch (type) {
            case 'new': return 'fa-plus-circle';
            case 'modify': return 'fa-edit';
            case 'delete': return 'fa-trash';
            default: return 'fa-circle';
        }
    }

    /**
     * Abre modal de producto (crear/editar)
     */
    openProductModal(productId = null, mode = 'create') {
        const product = mode === 'edit' ? this.productManager.getProductById(productId) : null;
        const title = mode === 'edit' ? `Editar: ${product.nombre}` : 'Nuevo Producto';

        const categories = this.productManager.getAllCategories();
        const categoryOptions = categories.map(cat => `<option value="${cat}" ${product?.categoria === cat ? 'selected' : ''}>${cat}</option>`).join('');

        const modalHTML = `
            <div class="modal-overlay active" id="product-modal-overlay">
                <div class="product-modal" id="product-modal">
                    <div class="modal-header">
                        <h3 class="modal-title">${title}</h3>
                    </div>

                    <div class="modal-content">
                        <form id="product-form">
                            <div class="form-group">
                                <label>Nombre del Producto *</label>
                                <input type="text" name="nombre" value="${product?.nombre || ''}" required>
                            </div>

                            <div class="form-group">
                                <label>Categoría *</label>
                                <select name="categoria" required>
                                    <option value="">Seleccionar categoría</option>
                                    ${categoryOptions}
                                </select>
                            </div>

                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                                <div class="form-group">
                                    <label>Precio Original *</label>
                                    <input type="number" name="precio" value="${product?.precio || ''}" step="0.01" min="0" required id="input-precio-original">
                                </div>

                                <div class="form-group">
                                    <label>Precio Final Deseado</label>
                                    <input type="number" name="precio_final_deseado" value="${product?.precioFinal || ''}" step="0.01" min="0" id="input-precio-final" placeholder="Ingresa el precio final deseado">
                                </div>
                            </div>

                            <div class="form-group" style="display: none;">
                                <input type="hidden" name="descuento" id="input-descuento" value="${product?.descuento || 0}">
                            </div>

                            <div class="form-group">
                                <label>Descripción</label>
                                <textarea name="descripcion" maxlength="500">${product?.descripcion || ''}</textarea>
                            </div>

                            <div class="form-group">
                                <label>
                                    <input type="checkbox" name="disponibilidad" ${product?.disponibilidad !== false ? 'checked' : ''}>
                                    Disponible
                                </label>
                            </div>

                            <div class="form-group">
                                <label>
                                    <input type="checkbox" name="nuevo" ${product?.nuevo ? 'checked' : ''}>
                                    Marcar como Nuevo
                                </label>
                            </div>

                            <div class="form-group">
                                <label>
                                    <input type="checkbox" name="oferta" ${product?.oferta ? 'checked' : ''}>
                                    Marcar como Oferta
                                </label>
                            </div>

                            <div class="form-group">
                                <label>
                                    <input type="checkbox" name="mas_vendido" ${product?.mas_vendido ? 'checked' : ''}>
                                    Marcar como Más Vendido
                                </label>
                            </div>

                            <div class="image-upload-group">
                                <label class="image-upload-label">Imagen del Producto</label>
                                <div class="image-upload-area" id="image-upload-area">
                                    <i class="fas fa-cloud-upload-alt"></i>
                                    <div class="image-upload-text">
                                        Arrastra una imagen aquí o haz clic para seleccionar
                                    </div>
                                </div>
                                <input type="file" id="image-upload-input" class="image-upload-input" accept="image/*">
                                <div class="image-preview" id="image-preview"></div>
                            </div>

                            ${product?.imagenUrl && product.imagenUrl !== 'Img/no_image.jpg' ? `
                                <div class="form-group">
                                    <label>Imagen actual</label>
                                    <div style="margin-top: 0.5rem;">
                                        <img src="${product.imagenUrl}" alt="Imagen actual" style="max-width: 150px; max-height: 150px; border-radius: 0.3rem; border: 1px solid #ddd;">
                                    </div>
                                </div>
                            ` : ''}
                        </form>
                    </div>

                    <div class="form-actions">
                        <button class="btn-form-cancel" id="btn-modal-cancel">Cancelar</button>
                        <button class="btn-form-submit" id="btn-modal-submit">
                            ${mode === 'edit' ? 'Actualizar Producto' : 'Crear Producto'}
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Remover modal anterior si existe
        const oldModal = document.getElementById('product-modal-overlay');
        if (oldModal) oldModal.remove();

        // Agregar modal al DOM
        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Setup event listeners del modal
        this.setupModalListeners(mode, productId);
    }

    /**
     * Setup de event listeners del modal
     */
    setupModalListeners(mode, productId) {
        const overlay = document.getElementById('product-modal-overlay');
        const form = document.getElementById('product-form');
        const closeBtn = document.querySelector('.modal-close');
        const cancelBtn = document.getElementById('btn-modal-cancel');
        const submitBtn = document.getElementById('btn-modal-submit');
        const imageUploadArea = document.getElementById('image-upload-area');
        const imageInput = document.getElementById('image-upload-input');
        const precioOriginalInput = document.getElementById('input-precio-original');
        const precioFinalInput = document.getElementById('input-precio-final');
        const descuentoInput = document.getElementById('input-descuento');
        let selectedImage = null;

        const product = mode === 'edit' ? this.productManager.getProductById(productId) : null;
        // Asegurar que la categoría del producto quede seleccionada cuando se edita
        const categorySelect = form.querySelector('select[name="categoria"]');
        if (categorySelect && product && product.categoria) {
            categorySelect.value = product.categoria;
        }

        // Mostrar preview de imagen existente (si existe) al editar
        if (product && product.imagenUrl && product.imagenUrl !== 'Img/no_image.jpg') {
            this.updateImagePreview(product.imagenUrl);
        }

        // Lógica de cálculo automático del descuento
        const calcularDescuento = () => {
            const precioOriginal = parseFloat(precioOriginalInput.value) || 0;
            const precioFinal = parseFloat(precioFinalInput.value) || 0;

            if (precioOriginal > 0 && precioFinal > 0) {
                if (precioFinal > precioOriginal) {
                    alert('El precio final no puede ser mayor al precio original');
                    precioFinalInput.value = '';
                    descuentoInput.value = 0;
                    return;
                }
                const descuentoPorcentaje = ((precioOriginal - precioFinal) / precioOriginal) * 100;
                descuentoInput.value = parseFloat(descuentoPorcentaje.toFixed(2));
            } else if (precioFinal === 0) {
                descuentoInput.value = 0;
            }
        };

        precioOriginalInput.addEventListener('change', calcularDescuento);
        precioFinalInput.addEventListener('input', calcularDescuento);
        precioFinalInput.addEventListener('change', calcularDescuento);

        // Cerrar modal
        const closeModal = () => {
            if (overlay && overlay.parentElement) {
                overlay.remove();
            }
        };

        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                closeModal();
            });
        }
        cancelBtn.addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        // Manejo de imagen
        imageUploadArea.addEventListener('click', () => imageInput.click());

        imageUploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            imageUploadArea.classList.add('dragover');
        });

        imageUploadArea.addEventListener('dragleave', () => {
            imageUploadArea.classList.remove('dragover');
        });

        imageUploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            imageUploadArea.classList.remove('dragover');
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                selectedImage = files[0];
                this.updateImagePreview(selectedImage);
            }
        });

        imageInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                selectedImage = e.target.files[0];
                this.updateImagePreview(selectedImage);
            }
        });

        // Enviar formulario
        submitBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            await this.handleProductFormSubmit(mode, productId, form, selectedImage);
            closeModal();
        });
    }

    /**
     * Actualiza preview de imagen
     */
    updateImagePreview(fileOrUrl) {
        const preview = document.getElementById('image-preview');
        if (!preview) return;

        // Si se pasa una URL de imagen (imagen existente al editar)
        if (typeof fileOrUrl === 'string') {
            preview.innerHTML = `
                <div class="image-preview-item">
                    <img src="${fileOrUrl}" alt="Preview" class="image-preview-img">
                    <button type="button" class="image-preview-remove">×</button>
                </div>
            `;
            preview.querySelector('.image-preview-remove').addEventListener('click', () => {
                preview.innerHTML = '';
                const imageInput = document.getElementById('image-upload-input');
                if (imageInput) imageInput.value = '';
            });
            return;
        }

        // Si es un File
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `
                <div class="image-preview-item">
                    <img src="${e.target.result}" alt="Preview" class="image-preview-img">
                    <button type="button" class="image-preview-remove">×</button>
                </div>
            `;

            preview.querySelector('.image-preview-remove').addEventListener('click', () => {
                preview.innerHTML = '';
                const imageInput = document.getElementById('image-upload-input');
                if (imageInput) imageInput.value = '';
            });
        };
        reader.readAsDataURL(fileOrUrl);
    }

    /**
     * Setup de event listeners generales
     */
    setupEventListeners() {
        // Botón agregar producto
        const addBtn = document.getElementById('btn-add-product');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.openProductModal(null, 'create'));
        }

        // Botón recargar
        const refreshBtn = document.getElementById('btn-refresh-products');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.handleRefreshProducts());
        }

        // Botón administrar imágenes del repo
        const imagesBtn = document.getElementById('btn-manage-repo-images');
        if (imagesBtn) {
            imagesBtn.addEventListener('click', () => {
                try {
                    if (!this.productManager) return alert('ProductManager no inicializado');
                    const ghManager = this.productManager.githubManager;
                    if (!ghManager || !ghManager.isConfigured()) {
                        return alert('Token de GitHub no configurado. Ve a Ajustes para configurarlo.');
                    }

                    if (!this.githubImagesModal) {
                        this.githubImagesModal = new GitHubImagesModal(ghManager, this.productManager);
                    }
                    this.githubImagesModal.show();
                } catch (err) {
                    console.error('Error abriendo modal de imágenes:', err);
                    alert('No se pudo abrir el modal de imágenes: ' + err.message);
                }
            });
        }

        // Búsqueda
        const searchInput = document.getElementById('search-products');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const results = this.productManager.searchProducts(e.target.value);
                this.renderProductsGrid(results);
            });
        }

        // Filtro de categoría
        this.updateCategoryFilter();
        const categoryFilter = document.getElementById('filter-category');
        if (categoryFilter) {
            categoryFilter.addEventListener('change', (e) => {
                const results = this.productManager.filterByCategory(e.target.value);
                this.renderProductsGrid(results);
            });
        }

        // Botones de staging
        const discardAllBtn = document.getElementById('btn-discard-all');
        if (discardAllBtn) {
            discardAllBtn.addEventListener('click', () => this.handleDiscardAll());
        }

        const syncBtn = document.getElementById('btn-sync-github');
        if (syncBtn) {
            syncBtn.addEventListener('click', () => this.handleSyncGitHub());
        }

        // Toggle Productos / Cambios (vista en la cabecera)
        const btnProducts = document.getElementById('btn-view-products');
        const btnChanges = document.getElementById('btn-view-changes');
        const productsGrid = document.getElementById('products-grid');
        const stagingPanel = document.getElementById('staging-panel');

        if (btnProducts && btnChanges) {
            btnProducts.addEventListener('click', () => {
                btnProducts.classList.add('active');
                btnChanges.classList.remove('active');
                if (productsGrid) productsGrid.classList.remove('hidden');
                if (stagingPanel) stagingPanel.classList.add('hidden');
                
                // Mostrar toolbar en vista de productos
                const toolbar = document.querySelector('.inventory-toolbar');
                if (toolbar) toolbar.classList.remove('hidden');
            });

            btnChanges.addEventListener('click', () => {
                btnChanges.classList.add('active');
                btnProducts.classList.remove('active');
                if (productsGrid) productsGrid.classList.add('hidden');
                if (stagingPanel) stagingPanel.classList.remove('hidden');
                
                // Ocultar toolbar en vista de cambios
                const toolbar = document.querySelector('.inventory-toolbar');
                if (toolbar) toolbar.classList.add('hidden');
                
                // Actualizar panel de cambios
                this.updateStagingPanel();
            });
        }
    }

    /**
     * Actualiza el filtro de categorías
     */
    updateCategoryFilter() {
        const categoryFilter = document.getElementById('filter-category');
        if (!categoryFilter) return;

        const categories = this.productManager.getAllCategories();
        const currentValue = categoryFilter.value;

        const options = `
            <option value="">Todas las categorías</option>
            ${categories.map(cat => `<option value="${cat}">${cat}</option>`).join('')}
        `;

        categoryFilter.innerHTML = options;
        categoryFilter.value = currentValue;
    }

    /**
     * Manejadores de eventos
     */

    async handleProductFormSubmit(mode, productId, form, imageFile) {
        const formData = new FormData(form);
        const descuentoCalculado = parseFloat(formData.get('descuento')) || 0;
        const productData = {
            id: mode === 'edit' ? productId : undefined,
            nombre: formData.get('nombre'),
            categoria: formData.get('categoria'),
            precio: parseFloat(formData.get('precio')),
            descuento: descuentoCalculado,
            descripcion: formData.get('descripcion'),
            disponibilidad: formData.get('disponibilidad') === 'on',
            nuevo: formData.get('nuevo') === 'on',
            oferta: formData.get('oferta') === 'on',
            mas_vendido: formData.get('mas_vendido') === 'on'
        };

        // Si estamos editando, mantener las imagenes actuales si no se selecciona una nueva
        if (mode === 'edit') {
            const existingProduct = this.productManager.getProductById(productId);
            productData.imagenes = existingProduct?.imagenes ? [...existingProduct.imagenes] : (existingProduct?.imagenes || []);
        }

        try {
            const changeType = mode === 'edit' ? 'modify' : 'new';
            await this.productManager.stageChange(changeType, productData, imageFile);
            
            this.updateStagingPanel();
            this.renderProductsGrid();
            
            this.showNotification('Producto guardado en staging', 'success');
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    async handleDeleteProduct(productId) {
        const product = this.productManager.getProductById(productId);
        if (!product) return;

        try {
            await this.productManager.stageChange('delete', product);
            this.updateStagingPanel();
            this.renderProductsGrid();
            this.showNotification('Producto marcado para eliminar', 'success');
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    async handleDiscardChange(changeId) {
        try {
            await this.productManager.discardChange(changeId);
            this.updateStagingPanel();
            this.showNotification('Cambio descartado', 'info');
        } catch (error) {
            this.showNotification(`Error: ${error.message}`, 'error');
        }
    }

    async handleDiscardAll() {
        if (confirm('¿Descartar todos los cambios en staging?')) {
            try {
                await this.productManager.discardAllChanges();
                this.updateStagingPanel();
                this.showNotification('Todos los cambios han sido descartados', 'info');
            } catch (error) {
                this.showNotification(`Error: ${error.message}`, 'error');
            }
        }
    }

    async handleSyncGitHub() {
        const syncBtn = document.getElementById('btn-sync-github');
        if (!syncBtn) return;
        const originalText = syncBtn.innerHTML;
        syncBtn.disabled = true;
        syncBtn.innerHTML = '<span class="loading-spinner"></span> Sincronizando...';

        // Use modal if available
        const modal = this.githubSaveModal || null;
        if (modal) modal.showLoading();

        const progressCb = (percent, message) => {
            try {
                if (modal) {
                    if (percent != null) modal.showProgress(percent, message || 'Procesando...');
                    else modal.updateDetail(message || 'Procesando...');
                }
            } catch (e) { console.warn('progressCb error', e); }
        };

        const doSync = async () => {
            try {
                const result = await this.productManager.saveAllStagedChanges(progressCb);
                this.updateStagingPanel();
                this.renderProductsGrid();
                const msg = result && result.message ? result.message : 'Sincronización completada exitosamente';
                if (modal) modal.showSuccess(msg, result.filesUpdated || 0);
                this.showNotification(`✓ ${msg}`, 'success');
            } catch (error) {
                if (modal) modal.showError(error.message || 'Error desconocido', () => doSync());
                this.showNotification(`Error en sincronización: ${error.message}`, 'error');
            } finally {
                syncBtn.disabled = false;
                syncBtn.innerHTML = originalText;
            }
        };

        // Ejecutar sincronización
        doSync();
    }

    async handleRefreshProducts() {
        const refreshBtn = document.getElementById('btn-refresh-products');
        if (!refreshBtn) return;

        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fas fa-spinner-third"></i> Cargando...';

        try {
            await this.productManager.loadProducts();
            this.updateCategoryFilter();
            this.renderProductsGrid();
            this.showNotification('Productos recar gados', 'success');
        } catch (error) {
            this.showNotification(`Error al cargar productos: ${error.message}`, 'error');
        } finally {
            refreshBtn.disabled = false;
            refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Recargar';
        }
    }

    /**
     * Muestra notificaciones
     */
    showNotification(message, type = 'info') {
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert ${type}`;
        
        const iconClass = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        }[type] || 'fa-info-circle';

        alertDiv.innerHTML = `
            <i class="fas ${iconClass}"></i>
            <span>${message}</span>
        `;

        const container = document.querySelector('.inventory-header') || this.container;
        container.insertAdjacentElement('afterend', alertDiv);

        setTimeout(() => {
            alertDiv.remove();
        }, 4000);
    }
}
