// assets/js/compras.js

let proveedoresCache = [];
let catalogoCache = [];
let carritoCompra = [];
let tasaActual = 1.00;

// =============================================================================
// VARIABLES GLOBALES DE CONTROL DE COSTOS
// =============================================================================
let payloadCompraPendiente = null;
let listaCambiosDetectados = [];

document.addEventListener('DOMContentLoaded', () => {
    cargarDatosIniciales();
    inicializarBuscador();
    inicializarEventosModal(); // Inicializa los botones del popup de forma segura
});

async function cargarDatosIniciales() {
    try {
        // 1. Obtener Proveedores
        proveedoresCache = await apiFetch('/proveedores/', 'GET');
        const selectProv = document.getElementById('compra-proveedor');
        selectProv.innerHTML = '<option value="">-- Seleccione un Proveedor --</option>';
        proveedoresCache.forEach(p => {
            selectProv.innerHTML += `<option value="${p.id}">${p.nombre} (${p.documento || 'S/N'})</option>`;
        });

        // 2. Obtener Catálogo de Productos y Tasa de Cambio
        try {
            const caja = await apiFetch('/pos/caja/', 'GET');
            tasaActual = parseFloat(caja.tasa_cambio_actual) || 1.00;
        } catch (e) {
            console.warn("No se pudo obtener la tasa desde la caja. Asegúrate de configurar la tasa global.");
        }
        document.getElementById('compra-tasa').value = tasaActual.toFixed(2);

        // Cargamos el catálogo
        catalogoCache = await apiFetch('/pos/catalogo/', 'GET');

    } catch (error) {
        console.error("Error cargando datos base:", error);
        alert("Error de conexión. " + (error.detail || error.messageForUser || ""));
    }
}

// ==============================================================================
// BUSCADOR Y AGREGADO
// ==============================================================================
function inicializarBuscador() {
    const buscador = document.getElementById('buscador-catalogo');
    if (buscador) {
        buscador.addEventListener('input', (e) => {
            const texto = e.target.value.toLowerCase().trim();
            const contenedor = document.getElementById('lista-resultados-busqueda');
            contenedor.innerHTML = '';

            if (!texto) {
                contenedor.innerHTML = '<div class="text-muted text-center small py-3">Usa el buscador para agregar productos.</div>';
                return;
            }

            const filtrados = catalogoCache.filter(item => {
                const nom = (item.producto.nombre || '').toLowerCase();
                const cod = (item.producto.codigo_base || '').toLowerCase();
                return nom.includes(texto) || cod.includes(texto);
            });

            if (filtrados.length === 0) {
                contenedor.innerHTML = '<div class="list-group-item text-muted small">No se encontraron productos.</div>';
                return;
            }

            filtrados.forEach(item => {
                contenedor.innerHTML += `
                    <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center" onclick="agregarItemACompra(${item.id})">
                        <div>
                            <div class="fw-bold text-primary">${item.producto.nombre}</div>
                            <small class="text-muted">${item.producto.codigo_base} | Pres: ${item.nombre_presentacion}</small>
                        </div>
                        <i class="bi bi-plus-circle-fill text-success fs-5"></i>
                    </button>
                `;
            });
        });
    }

    // 1. AUTO-POBLAR COSTO ACTUAL AL SELECCIONAR PRODUCTO (En caso de usar un select)
    const selectProducto = document.getElementById('compra-producto');
    if (selectProducto) {
        selectProducto.addEventListener('change', function(e) {
            const id = parseInt(e.target.value);
            const item = catalogoCache.find(x => x.id === id);
            if (item) {
                const inputCosto = document.getElementById('compra-costo');
                if (inputCosto) {
                    inputCosto.value = parseFloat(item.costo || item.producto?.costo_base || 0).toFixed(2);
                }
            }
        });
    }
}

function agregarItemACompra(idPresentacion) {
    const itemCat = catalogoCache.find(i => i.id === idPresentacion);
    if (!itemCat) return;

    // Verificar si ya está en la lista
    const index = carritoCompra.findIndex(i => i.presentacion_id === idPresentacion);
    if (index > -1) {
        carritoCompra[index].cantidad += 1;
    } else {
        // Auto-poblamos el costo desde el catálogo al agregarlo a la tabla
        const costoBase = parseFloat(itemCat.costo || itemCat.producto?.costo_base || 0);

        carritoCompra.push({
            presentacion_id: itemCat.id,
            nombre: itemCat.producto.nombre,
            presentacion: itemCat.nombre_presentacion,
            impuesto_porcentaje: parseFloat(itemCat.producto.impuesto_porcentaje || 0),
            cantidad: 1,
            costo_unitario: costoBase 
        });
    }

    // Limpiar buscador
    const buscadorInput = document.getElementById('buscador-catalogo');
    const contenedorResultados = document.getElementById('lista-resultados-busqueda');
    
    if(buscadorInput) buscadorInput.value = '';
    if(contenedorResultados) contenedorResultados.innerHTML = '<div class="text-muted text-center small py-3">Usa el buscador para agregar productos.</div>';

    renderizarCarrito();
}

// ==============================================================================
// TABLA Y CÁLCULOS
// ==============================================================================
function actualizarFila(index, campo, valor) {
    let num = parseFloat(valor);
    if (isNaN(num) || num < 0) num = 0;
    carritoCompra[index][campo] = num;
    renderizarCarrito();
}

function eliminarFila(index) {
    carritoCompra.splice(index, 1);
    renderizarCarrito();
}

function vaciarCompra() {
    if(confirm("¿Seguro que deseas vaciar toda la lista?")) {
        carritoCompra = [];
        renderizarCarrito();
    }
}

function renderizarCarrito() {
    const tbody = document.getElementById('tabla-compra');
    tbody.innerHTML = '';

    if (carritoCompra.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted py-5"><i class="bi bi-box-seam fs-1 d-block mb-2"></i>Aún no has agregado productos a esta compra.</td></tr>';
        calcularTotales();
        return;
    }

    carritoCompra.forEach((item, index) => {
        const subtotal = item.cantidad * item.costo_unitario;
        item.subtotal = subtotal;

        tbody.innerHTML += `
            <tr>
                <td class="text-start ps-3">
                    <div class="fw-bold text-dark">${item.nombre}</div>
                    <small class="text-muted">${item.presentacion}</small>
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm text-center fw-bold" value="${item.cantidad}" min="0.01" step="0.01" onchange="actualizarFila(${index}, 'cantidad', this.value)">
                </td>
                <td>
                    <input type="number" class="form-control form-control-sm text-center" value="${item.costo_unitario.toFixed(2)}" min="0.00" step="0.01" onchange="actualizarFila(${index}, 'costo_unitario', this.value)">
                </td>
                <td class="fw-bold text-primary">$ ${subtotal.toFixed(2)}</td>
                <td>
                    <button class="btn btn-sm btn-outline-danger" onclick="eliminarFila(${index})"><i class="bi bi-x-lg"></i></button>
                </td>
            </tr>
        `;
    });

    calcularTotales();
}

function calcularTotales() {
    let subtotalUSD = 0;
    let totalImpuestos = 0;

    carritoCompra.forEach(item => {
        subtotalUSD += item.subtotal;
        totalImpuestos += item.subtotal * (item.impuesto_porcentaje / 100);
    });

    const totalUSD = subtotalUSD + totalImpuestos;
    
    // Tomamos la tasa del input por si el gerente la ajustó a mano
    const tasaInput = parseFloat(document.getElementById('compra-tasa').value) || tasaActual;
    const totalBS = totalUSD * tasaInput;

    document.getElementById('compra-total-usd').innerText = `$ ${totalUSD.toFixed(2)}`;
    document.getElementById('compra-total-bs').innerText = `BS ${totalBS.toFixed(2)}`;

    return { subtotalUSD, totalImpuestos, totalUSD, totalBS, tasaInput };
}

// ==============================================================================
// PROCESAR Y ENVIAR AL BACKEND (INTERCEPTADO)
// ==============================================================================
async function procesarCompra() {
    const proveedorId = document.getElementById('compra-proveedor').value;
    if (!proveedorId) { alert("Por favor, selecciona un proveedor."); return; }
    if (carritoCompra.length === 0) { alert("El carrito de compras está vacío."); return; }

    // Verificamos que no haya costos en 0
    const hayCostosCero = carritoCompra.some(item => item.costo_unitario <= 0);
    if (hayCostosCero) {
        if(!confirm("Hay productos con Costo Unitario en $0.00. ¿Estás seguro de registrar la compra así?")) {
            return;
        }
    }

    const totales = calcularTotales();
    const tipoCompra = document.getElementById('compra-tipo')?.value || 'CONTADO';

    // Estructuramos el payload de la cabecera y el detalle
    payloadCompraPendiente = {
        proveedor_id: parseInt(proveedorId),
        almacen_id: 1, 
        tipo: tipoCompra,
        tasa_cambio_historica: totales.tasaInput.toFixed(2),
        subtotal_principal: totales.subtotalUSD.toFixed(2),
        total_impuestos_principal: totales.totalImpuestos.toFixed(2),
        total_principal: totales.totalUSD.toFixed(2),
        total_secundaria: totales.totalBS.toFixed(2),
        detalles: carritoCompra.map(item => ({
            presentacion_id: item.presentacion_id,
            cantidad_presentacion: item.cantidad.toFixed(2), // Corregido: presentacion
            precio_unitario_aplicado: item.costo_unitario.toFixed(2),
            porcentaje_impuesto_aplicado: item.impuesto_porcentaje.toFixed(2),
            subtotal: item.subtotal.toFixed(2)
        }))
    };

    // 2. ANALIZAR VARIACIONES DE COSTOS
    listaCambiosDetectados = [];
    carritoCompra.forEach(item => {
        const itemCatalogo = catalogoCache.find(x => x.id === item.presentacion_id);
        const costoCatalogo = itemCatalogo ? parseFloat(itemCatalogo.costo || itemCatalogo.producto?.costo_base || 0) : 0;
        const costoFacturado = item.costo_unitario;

        // Comparamos si hubo variación de precios (Evitamos errores de redondeo nativos de JS con Math.abs)
        if (Math.abs(costoCatalogo - costoFacturado) > 0.001) {
            const diferencia = costoFacturado - costoCatalogo;
            const porcentajeVariacion = costoCatalogo > 0 ? (diferencia / costoCatalogo) * 100 : 100;

            listaCambiosDetectados.push({
                presentacion_id: item.presentacion_id,
                nombre: item.nombre,
                costo_anterior: costoCatalogo,
                costo_nuevo: costoFacturado,
                porcentaje: porcentajeVariacion
            });
        }
    });

    // EVALUAR RUTA DE GUARDADO
    if (listaCambiosDetectados.length > 0) {
        renderizarModalCostos();
    } else {
        // Si no hay variaciones, guardamos directamente
        ejecutarGuardadoCompra();
    }
}

// 3. RENDERIZAR LA TABLA DE CAMBIOS EN EL POPUP
function renderizarModalCostos() {
    const tbody = document.getElementById('lista-cambios-costos');
    tbody.innerHTML = '';

    listaCambiosDetectados.forEach((cambio, index) => {
        const esIncremento = cambio.porcentaje > 0;
        const badgeClass = esIncremento ? 'badge bg-danger' : 'badge bg-success';
        const iconoClass = esIncremento ? 'bi-arrow-up-short' : 'bi-arrow-down-short';
        const signo = esIncremento ? '+' : '';

        tbody.innerHTML += `
            <tr>
                <td class="text-start ps-3 fw-bold">${cambio.nombre}</td>
                <td class="text-muted">$ ${cambio.costo_anterior.toFixed(2)}</td>
                <td class="text-dark fw-bold">$ ${cambio.costo_nuevo.toFixed(2)}</td>
                <td><span class="${badgeClass}"><i class="bi ${iconoClass}"></i>${signo}${cambio.porcentaje.toFixed(1)}%</span></td>
                <td>
                    <input type="checkbox" class="form-check-input chk-costo-update" data-index="${index}" checked>
                </td>
            </tr>
        `;
    });

    const modal = new bootstrap.Modal(document.getElementById('modalAlertaCostos'));
    modal.show();
}

// =============================================================================
// MANEJO DE EVENTOS DEL MODAL DE CONTROL DE PRECIOS
// =============================================================================
function inicializarEventosModal() {
    const btnOmitir = document.getElementById('btn-omitir-costos');
    if (btnOmitir) {
        btnOmitir.addEventListener('click', () => {
            const modalEl = document.getElementById('modalAlertaCostos');
            bootstrap.Modal.getInstance(modalEl).hide();
            ejecutarGuardadoCompra();
        });
    }

    const btnConfirmar = document.getElementById('btn-confirmar-costos');
    if (btnConfirmar) {
        btnConfirmar.addEventListener('click', async () => {
            const checkboxes = document.querySelectorAll('.chk-costo-update');
            const cambiosAProcesar = [];

            checkboxes.forEach(chk => {
                if (chk.checked) {
                    const idx = parseInt(chk.getAttribute('data-index'));
                    cambiosAProcesar.push({
                        presentacion_id: listaCambiosDetectados[idx].presentacion_id,
                        nuevo_costo: listaCambiosDetectados[idx].costo_nuevo
                    });
                }
            });

            // Enviamos primero la actualización masiva de costos maestros si hay elementos seleccionados
            if (cambiosAProcesar.length > 0) {
                try {
                    await apiFetch('/inventario/productos/actualizar-costos/', 'POST', { cambios: cambiosAProcesar });
                    console.log("Fichas de costos de catálogo actualizadas.");
                } catch (err) {
                    console.error("Error al actualizar costos base:", err);
                    alert("Atención: Hubo un inconveniente al actualizar algunos costos base, pero procederemos a registrar la compra.");
                }
            }

            const modalEl = document.getElementById('modalAlertaCostos');
            bootstrap.Modal.getInstance(modalEl).hide();
            ejecutarGuardadoCompra();
        });
    }
}

// 4. GUARDADO FINAL DE LA TRANSACCIÓN DE COMPRA
async function ejecutarGuardadoCompra() {
    const btn = document.getElementById('btn-procesar-compra');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span> Registrando...';

    try {
        const respuesta = await apiFetch('/compras/registrar/', 'POST', payloadCompraPendiente);
        alert(`¡Compra #${respuesta.compra_id} procesada exitosamente! El stock ha ingresado al almacén.`);
        
        // Limpieza total del formulario y estado de memoria
        document.getElementById('compra-proveedor').value = '';
        carritoCompra = [];
        renderizarCarrito(); 
        
    } catch (error) {
        alert("Error al procesar la compra:\n" + (error.detail || error.error || error.messageForUser || "Revisa los logs del servidor."));
        console.error(error);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-circle-fill me-2"></i> REGISTRAR COMPRA E INGRESAR STOCK';
    }
}