// assets/js/pos.js

// ==============================================================================
// 1. ESTADO GLOBAL
// ==============================================================================
let catalogo = [];
let carrito = [];
let tasaCambio = 0;
let sessionCajaAbierta = false;
let sesionCajaId = null;
let keepAliveTimer = null;
let clientesCache = [];
let metodosPagoCache = [];
let clienteSeleccionadoId = 1;
let clienteSeleccionadoNombre = "Cliente Generico";
let conceptosEgresoCache = [];
let carritoEgresoInv = [];
let puedeCambiarPrecio = false;
// >>> NUEVO: bandera anti doble-clic en facturacion <<<
let facturandoEnCurso = false;

const POS_CART_KEY = 'pos_cart';
const POS_SESION_ID_KEY = 'pos_sesion_id';
const CLIENTE_MOSTRADOR_ID = 1;
const ALMACEN_PRINCIPAL_ID = 1;

// ==============================================================================
// 2. INICIALIZACION
// ==============================================================================
async function inicializarPOS() {
    if (!localStorage.getItem('access_token')) {
        alert("No has iniciado sesion. Seras redirigido al login.");
        window.location.href = 'index.html';
        return;
    }

    try {
        await cargarDatosIniciales();

        // >>> FASE 2: VERIFICAR TASA DIARIA <<<
        const tasaOK = await verificarTasaDiaria();
        if (!tasaOK) return; // El modal de tasa se encargará de continuar

        await continuarInicializacionPOS();
    } catch (error) {
        console.error("Error critico al iniciar el POS:", error);
        alert("Error critico al iniciar el sistema. Revisa la consola.");
    }
}

async function continuarInicializacionPOS() {
    let sesion = null;
    try {
        sesion = await apiFetch('/pos/caja/', 'GET');

        if (sesion.requiere_cierre_obligatorio === true) {
            console.warn("Bloqueo activado: Desplegando modal de cierre obligatorio.");
            sesionCajaId = sesion.id;
            const modalCierre = new bootstrap.Modal(document.getElementById('modalCierreObligatorio'));
            modalCierre.show();
            return;
        }

        sessionCajaAbierta = true;
        sesionCajaId = sesion.id;

        if (sesion.rol_usuario === 'ADMIN' || sesion.rol_usuario === 'GERENTE') {
            puedeCambiarPrecio = true;
        } else {
            puedeCambiarPrecio = (sesion.cajero_puede_cambiar_precio === true);
        }

        console.log("Permiso de cambio de precio activo: " + puedeCambiarPrecio);
        document.getElementById('nombreCajero').innerText = sesion.cajero || 'Admin';
        iniciarKeepAlive();

    } catch (cajaError) {
        console.error("ERROR REAL DETECTADO DENTRO DEL BLOQUE DE CAJA:", cajaError);

        if (cajaError instanceof TypeError || cajaError instanceof ReferenceError) {
            alert("Error de codigo en el POS: " + cajaError.message + ". Revisa la consola.");
            return;
        }

        const msg = String(cajaError?.messageForUser || cajaError?.detail || cajaError?.error || cajaError?.mensaje || '');

        const tokenProblem =
            cajaError?.code === 'token_not_valid' ||
            msg.toLowerCase().includes('token') ||
            msg.toLowerCase().includes('sesion') ||
            msg.toLowerCase().includes('expired') ||
            msg.toLowerCase().includes('authentication') || 
            msg.toLowerCase().includes('credentials');

        if (tokenProblem) {
            alert(msg || 'Tu sesion expiro o es invalida. Inicia sesion nuevamente.');
            window.location.href = 'index.html';
            return;
        }

        console.warn("No se encontro caja abierta. Solicitando apertura...");
        const modalApertura = new bootstrap.Modal(document.getElementById('modalAperturaCaja'));
        modalApertura.show();
        return;
    }

    // >>> AGREGAR ESTA LINEA: cargar config de stock del backend <<<
    await cargarConfiguracionStock();

    const clienteGenerico = clientesCache.find(c => String(c.documento).toLowerCase() === 'generico');
    if (clienteGenerico) {
        seleccionarCliente(clienteGenerico.id, clienteGenerico.nombre);
        console.log("Cliente por defecto asignado: " + clienteGenerico.nombre + " (ID: " + clienteGenerico.id + ")");
    } else {
        console.warn("No se encontro un cliente con documento 'generico'. Usando ID fallback.");
        seleccionarCliente(CLIENTE_MOSTRADOR_ID, "Cliente Generico");
    }

    const respuestaCatalogo = await apiFetch('/pos/catalogo/', 'GET');
    catalogo = Array.isArray(respuestaCatalogo) ? respuestaCatalogo : (respuestaCatalogo.results || []);

    tasaCambio = parseFloat(sesion.tasa_cambio_actual) || 0;
    console.log("Tasa cargada:", tasaCambio.toFixed(2));
    document.getElementById('tasaDisplay').innerText = "TASA Bs " + tasaCambio.toFixed(2);

    renderizarCatalogoHTML();
    restaurarCarritoSiHay();
    inicializarBuscador();
    inicializarModalClientes();
}

// ==============================================================================
// 3. DATOS INICIALES (Clientes + Metodos de Pago)
// ==============================================================================
async function cargarDatosIniciales() {
    try {
        const resp = await apiFetch('/pos/datos-iniciales/', 'GET');
        clientesCache = resp.clientes || [];
        metodosPagoCache = resp.metodos_pago || [];
        console.log("Datos iniciales cargados. Clientes:", clientesCache.length, "Metodos:", metodosPagoCache.length);
    } catch (e) {
        console.warn("No se pudieron cargar datos iniciales:", e);
        clientesCache = [];
        metodosPagoCache = [];
    }

    try {
        const respConceptos = await apiFetch('/egresos/conceptos/', 'GET');
        conceptosEgresoCache = respConceptos;
        llenarSelectsEgresos();
    } catch (e) {
        console.warn("No se pudieron cargar los conceptos de egreso:", e);
    }
}

// ==============================================================================
// 4. CLIENTES
// ==============================================================================
function inicializarModalClientes() {
    const modal = document.getElementById('modalBuscarCliente');
    if (modal) {
        modal.addEventListener('shown.bs.modal', () => {
            renderizarClientesModal(clientesCache);
            const input = document.getElementById('input-buscar-cliente');
            if (input) { input.value = ''; input.focus(); }
        });
    }
}

function filtrarClientesModal() {
    const texto = document.getElementById('input-buscar-cliente').value.toLowerCase().trim();
    if (!texto) {
        renderizarClientesModal(clientesCache);
        return;
    }
    const filtrados = clientesCache.filter(c => {
        const nom = (c.nombre || '').toLowerCase();
        const doc = (c.documento || c.cedula || c.rif || '').toLowerCase();
        return nom.includes(texto) || doc.includes(texto);
    });
    renderizarClientesModal(filtrados);
}

function renderizarClientesModal(lista) {
    const cont = document.getElementById('lista-clientes-modal');
    cont.innerHTML = '';
    if (lista.length === 0) {
        cont.innerHTML = '<div class="list-group-item text-muted">No se encontraron clientes</div>';
        return;
    }
    lista.forEach(c => {
        const doc = c.documento || c.cedula || c.rif || 'S/N';
        const deuda = parseFloat(c.deuda_total || 0);
        const saldoFavor = parseFloat(c.saldo_a_favor || 0);
        const limite = parseFloat(c.limite_credito || 0);

        let badges = '';

        // Deuda SIEMPRE visible
        if (deuda > 0) {
            badges += '<span class="badge bg-danger me-1">Deuda: $' + deuda.toFixed(2) + '</span>';
        } else {
            badges += '<span class="badge bg-secondary me-1">Sin deuda</span>';
        }

        // Saldo a favor
        if (saldoFavor > 0) {
            badges += '<span class="badge bg-success me-1">Saldo a favor: $' + saldoFavor.toFixed(2) + '</span>';
        }

        // Límite de crédito
        if (limite > 0) {
            badges += '<span class="badge bg-info text-dark me-1">Límite: $' + limite.toFixed(2) + '</span>';
        } else if (limite === -1) {
            badges += '<span class="badge bg-dark">Crédito BLOQUEADO</span>';
        }

        const item = document.createElement('a');
        item.href = '#';
        item.className = 'list-group-item list-group-item-action cliente-item';
        item.innerHTML =
            '<div class="d-flex w-100 justify-content-between align-items-center mb-1">' +
                '<h6 class="mb-0 fw-bold">' + c.nombre + '</h6>' +
                '<small class="text-muted">' + doc + '</small>' +
            '</div>' +
            '<div class="d-flex flex-wrap gap-1 mt-1">' + badges + '</div>';
        item.onclick = (e) => { e.preventDefault(); seleccionarCliente(c.id, c.nombre); };
        cont.appendChild(item);
    });
}

function seleccionarCliente(id, nombre) {
    clienteSeleccionadoId = id;
    clienteSeleccionadoNombre = nombre;
    const select = document.getElementById('select-cliente');
    select.innerHTML = '<option value="' + id + '">' + nombre + '</option>';
    select.value = id;

    // POS MÓVIL: nombre del cliente en el header superior
    const hmCliente = document.getElementById('mobile-cliente-nombre');
    if (hmCliente) hmCliente.innerText = nombre;
    const modalEl = document.getElementById('modalBuscarCliente');
    const modalInst = bootstrap.Modal.getInstance(modalEl);
    if (modalInst) modalInst.hide();
}

async function guardarNuevoCliente() {
    const nombre = document.getElementById('nuevo-cliente-nombre').value.trim();
    const doc = document.getElementById('nuevo-cliente-doc').value.trim();
    const tlf = document.getElementById('nuevo-cliente-tlf').value.trim();

    if (!nombre) { alert("El nombre es obligatorio"); return; }

    try {
        const payload = { nombre: nombre, documento: doc, telefono: tlf };
        await apiFetch('/clientes/', 'POST', payload);

        await cargarDatosIniciales();

        document.getElementById('nuevo-cliente-nombre').value = '';
        document.getElementById('nuevo-cliente-doc').value = '';
        document.getElementById('nuevo-cliente-tlf').value = '';

        const modalNuevo = bootstrap.Modal.getInstance(document.getElementById('modalNuevoCliente'));
        if (modalNuevo) modalNuevo.hide();

        const inputBuscar = document.getElementById('input-buscar-cliente');
        if (inputBuscar) {
            inputBuscar.value = nombre;
            filtrarClientesModal();
        }
        alert('Cliente "' + nombre + '" guardado. Buscalo en la lista y seleccionalo.');
    } catch (e) {
        alert("Error al guardar cliente: " + (e.messageForUser || e.detail || e.error || "Error desconocido"));
    }
}

// ==============================================================================
// 5. CARRITO
// ==============================================================================
// Variable global para configuración (agregar al inicio del archivo, después de las otras variables globales)
let permitirStockNegativo = false;
// >>> FASE 1.5: políticas de vuelto (se cargan de /config/tasa-status/) <<<
let configVuelto = {
    permitir_vuelto_a_saldo_favor: true,
    permitir_vuelto_a_cxc: true,
    vuelto_obligatorio_efectivo: false
};

// >>> FASE 1.6: configuración de tasas + BCV (se cargan de /config/tasa-status/) <<<
let configTasa = {
    usar_tasa_bcv: false,
    mostrar_diferencia_tasa_en_pos: true,
    alertar_si_diferencia_tasa_supera: 0
};
// Última tasa BCV conocida: { tasa, fuente, obtenida_el, es_manual } | null
let tasaBCVReferencia = null;

// Función para cargar configuración (agregar después de cargarDatosIniciales)
async function cargarConfiguracionStock() {
    try {
        const config = await apiFetch('/config/tasa-status/', 'GET');
        permitirStockNegativo = config.permitir_stock_negativo || false;
        configVuelto.permitir_vuelto_a_saldo_favor = config.permitir_vuelto_a_saldo_favor !== false;
        configVuelto.permitir_vuelto_a_cxc = config.permitir_vuelto_a_cxc !== false;
        configVuelto.vuelto_obligatorio_efectivo = config.vuelto_obligatorio_efectivo === true;
        // FASE 1.6: flags de tasas
        configTasa.usar_tasa_bcv = config.usar_tasa_bcv === true;
        configTasa.mostrar_diferencia_tasa_en_pos = config.mostrar_diferencia_tasa_en_pos !== false;
        configTasa.alertar_si_diferencia_tasa_supera = parseFloat(config.alertar_si_diferencia_tasa_supera) || 0;
    } catch (e) {
        console.warn("No se pudo cargar configuración de stock:", e);
        permitirStockNegativo = false;
    }
}

function agregarAlCarrito(idPresentacion) {
    if (!sessionCajaAbierta) { 
        alert("Abre la caja primero."); 
        return; 
    }

    const itemCatalogo = catalogo.find(p => p.id === idPresentacion);
    if (!itemCatalogo) return;

    const itemEnCarrito = carrito.find(item => item.presentacion_id === idPresentacion);
    const cantidadEnCarrito = itemEnCarrito ? itemEnCarrito.cantidad : 0;
    const nuevaCantidad = cantidadEnCarrito + 1;

    // >>> FIX: priorizar el stock guardado en el item del carrito, que se
    //     sincroniza con cada refrescarCatalogo / refrescarStockCarrito,
    //     sobre el del catálogo (que puede quedar desactualizado) <<<
    const stockDisponible = (itemEnCarrito && typeof itemEnCarrito.stock_disponible !== 'undefined')
        ? (parseFloat(itemEnCarrito.stock_disponible) || 0)
        : (parseFloat(itemCatalogo.stock_disponible) || 0);
    
    if (!permitirStockNegativo && stockDisponible <= 0) {
        alert(
            `❌ SIN STOCK\n\n` +
            `Producto: ${itemCatalogo.producto.nombre}\n` +
            `Stock disponible: ${stockDisponible.toFixed(2)}\n\n` +
            `Este producto no tiene stock disponible.`
        );
        return;
    }
    
    if (!permitirStockNegativo && nuevaCantidad > stockDisponible) {
        alert(
            `⚠️ STOCK INSUFICIENTE\n\n` +
            `Producto: ${itemCatalogo.producto.nombre}\n` +
            `Disponible: ${stockDisponible.toFixed(2)} ${itemEnCarrito ? (itemEnCarrito.unidad_sigla || 'und') : (itemCatalogo.unidad_sigla || 'und')}\n` +
            `En carrito: ${cantidadEnCarrito.toFixed(2)}\n` +
            `Solicitado: ${nuevaCantidad.toFixed(2)}\n\n` +
            `No puedes agregar más unidades.`
        );
        return;
    }

    if (itemEnCarrito) {
        itemEnCarrito.cantidad = nuevaCantidad;
        itemEnCarrito.subtotal = itemEnCarrito.cantidad * itemEnCarrito.precio_unitario;
    } else {
        const precio = parseFloat(itemCatalogo.precio_venta_principal);
        const impuesto = parseFloat(itemCatalogo.producto.impuesto_porcentaje);
        carrito.push({
            presentacion_id: itemCatalogo.id,
            nombre: itemCatalogo.producto.nombre + ' (' + itemCatalogo.nombre_presentacion + ')',
            cantidad: 1,
            precio_unitario: precio,
            impuesto_porcentaje: impuesto,
            subtotal: precio,
            stock_disponible: stockDisponible,
            unidad_sigla: itemCatalogo.unidad_sigla || 'und'
        });
    }
    
    calcularTotales();
    renderizarCarritoHTML();
    guardarCarritoEnStorage();

    // POS MÓVIL: el carrito siempre muestra el último ítem agregado
    if (typeof esVistaMovilPOS === 'function' && esVistaMovilPOS()) {
        const contM = document.getElementById('carrito-lista-mobile');
        if (contM) contM.scrollTop = contM.scrollHeight;
    }
}
function quitarDelCarrito(idPresentacion) {
    const index = carrito.findIndex(item => item.presentacion_id === idPresentacion);
    if (index === -1) return;
    if (carrito[index].cantidad > 1) {
        carrito[index].cantidad -= 1;
        carrito[index].subtotal = carrito[index].cantidad * carrito[index].precio_unitario;
    } else {
        carrito.splice(index, 1);
    }
    calcularTotales();
    renderizarCarritoHTML();
    guardarCarritoEnStorage();
}

function eliminarFila(idPresentacion) {
    carrito = carrito.filter(item => item.presentacion_id !== idPresentacion);
    calcularTotales();
    renderizarCarritoHTML();
    guardarCarritoEnStorage();
}

function vaciarCarrito() {
    if (confirm("Estas seguro de cancelar esta factura?")) {
        carrito = [];
        calcularTotales();
        renderizarCarritoHTML();
        guardarCarritoEnStorage();
    }
}

// ==============================================================================
// 6. MATEMATICAS
// ==============================================================================
function calcularTotales() {
    let subtotal_principal = 0;
    let total_impuestos_principal = 0;

    carrito.forEach(item => {
        subtotal_principal += item.subtotal;
        const montoImpuestoLinea = item.subtotal * (item.impuesto_porcentaje / 100);
        total_impuestos_principal += montoImpuestoLinea;
    });

    const total_principal = subtotal_principal + total_impuestos_principal;
    const total_secundaria = total_principal * tasaCambio;

    const resumen = {
        subtotal: subtotal_principal.toFixed(2),
        impuestos: total_impuestos_principal.toFixed(2),
        total_usd: total_principal.toFixed(2),
        total_bs: total_secundaria.toFixed(2)
    };

    actualizarPantallaTotales(resumen);
    return resumen;
}

function actualizarPantallaTotales(totales) {
    document.getElementById('ui-subtotal').innerText = '$ ' + totales.subtotal;
    document.getElementById('ui-impuestos').innerText = '$ ' + totales.impuestos;
    document.getElementById('ui-total-usd').innerText = '$ ' + totales.total_usd;
    document.getElementById('ui-total-bs').innerText = 'BS ' + totales.total_bs;

    // POS MÓVIL: total siempre visible en el header superior
    const hmTotal = document.getElementById('mobile-total');
    if (hmTotal) hmTotal.innerText = '$ ' + totales.total_usd;
}

// ==============================================================================
// 7. COBRO Y FACTURACION
// ==============================================================================
// REEMPLAZAR la función abrirModalCobro completa
async function abrirModalCobro() {
    if (carrito.length === 0) { 
        alert("El carrito está vacío"); 
        return; 
    }

    // Refrescar stock antes de validar
    await refrescarStockCarrito();
    
    // Validar stock de todo el carrito
    if (!permitirStockNegativo) {
        const erroresStock = [];
        
        carrito.forEach(function(item) {
            const stockDisponible = parseFloat(item.stock_disponible) || 0;
            
            if (stockDisponible <= 0) {
                erroresStock.push(
                    `• ${item.nombre}: SIN STOCK (disponible: ${stockDisponible.toFixed(2)})`
                );
            } else if (item.cantidad > stockDisponible) {
                erroresStock.push(
                    `• ${item.nombre}: Disponible ${stockDisponible.toFixed(2)}, ` +
                    `Solicitado ${item.cantidad.toFixed(2)}`
                );
            }
        });
        
        if (erroresStock.length > 0) {
            alert(
                `⚠️ PROBLEMAS DE STOCK\n\n` +
                `Los siguientes productos tienen problemas:\n\n` +
                erroresStock.join('\n') +
                `\n\nPor favor ajusta las cantidades antes de cobrar.`
            );
            return;
        }
    }

    // Info cliente (resto de la función original)
    const cliente = clientesCache.find(c => c.id === clienteSeleccionadoId);
    const infoClienteDiv = document.getElementById('cobro-info-cliente');
    const infoClienteInner = infoClienteDiv.querySelector('.col-12');

    if (cliente) {
        const deuda = parseFloat(cliente.deuda_total || 0);
        const limite = parseFloat(cliente.limite_credito || 0);
        const saldo = parseFloat(cliente.saldo_a_favor || 0);

        document.getElementById('cobro-cliente-nombre').innerText = cliente.nombre;
        document.getElementById('cobro-cliente-doc').innerText = 'Doc: ' + (cliente.documento || 'S/N');
        document.getElementById('cobro-cliente-deuda').innerText = '$ ' + deuda.toFixed(2);
        document.getElementById('cobro-cliente-limite').innerText = '$ ' + (limite > 0 ? limite.toFixed(2) : 'ILIMITADO');
        document.getElementById('cobro-cliente-saldo').innerText = '$ ' + saldo.toFixed(2);

        infoClienteInner.className = 'col-12 bg-white p-2 rounded shadow-sm border-start border-4';

        if (limite === -1) {
            infoClienteInner.classList.add('border-danger', 'bg-danger', 'bg-opacity-10');
        } else if (limite > 0 && deuda >= limite) {
            infoClienteInner.classList.add('border-danger', 'bg-danger', 'bg-opacity-10');
        } else if (limite > 0 && deuda >= (limite * 0.8)) {
            infoClienteInner.classList.add('border-warning', 'bg-warning', 'bg-opacity-10');
        } else {
            infoClienteInner.classList.add('border-primary');
        }
    } else {
        document.getElementById('cobro-cliente-nombre').innerText = clienteSeleccionadoNombre;
        document.getElementById('cobro-cliente-doc').innerText = 'Doc: S/N';
        document.getElementById('cobro-cliente-deuda').innerText = '$ 0.00';
        document.getElementById('cobro-cliente-limite').innerText = '$ 0.00';
        document.getElementById('cobro-cliente-saldo').innerText = '$ 0.00';
        infoClienteInner.className = 'col-12 bg-white p-2 rounded shadow-sm border-start border-4 border-primary';
    }

    const totales = calcularTotales();
    document.getElementById('cobro-total-usd').innerText = '$ ' + totales.total_usd;
    document.getElementById('cobro-total-bs').innerText = 'BS ' + totales.total_bs;

    document.getElementById('contenedor-pagos').innerHTML = '';
    agregarLineaPago();

    document.getElementById('btn-contado').checked = true;
    evaluarEstadoPago();

    // Resetear bandera de facturación
    facturandoEnCurso = false;

    // >>> FIX: restaurar el botón por si quedó en "PROCESANDO..." de una
    //     sesión anterior (el modal persiste en el DOM) <<<
    const btnFacturarReset = document.getElementById('btn-procesar-factura');
    if (btnFacturarReset) {
        if (btnFacturarReset.dataset.labelOriginal) {
            btnFacturarReset.innerHTML = btnFacturarReset.dataset.labelOriginal;
        }
        btnFacturarReset.disabled = true; // evaluarEstadoPago() lo reactivará si corresponde
    }

    const modal = new bootstrap.Modal(document.getElementById('modalCobro'));
    modal.show();
}

// NUEVA FUNCIÓN: Agregar después de abrirModalCobro
async function refrescarStockCarrito() {
    try {
        const respuestaCatalogo = await apiFetch('/pos/catalogo/', 'GET');
        const catalogoActualizado = Array.isArray(respuestaCatalogo) ? respuestaCatalogo : (respuestaCatalogo.results || []);
        
        carrito.forEach(function(item) {
            const itemActualizado = catalogoActualizado.find(p => p.id === item.presentacion_id);
            if (itemActualizado) {
                item.stock_disponible = parseFloat(itemActualizado.stock_disponible) || 0;
            }
        });
        
        catalogo = catalogoActualizado;
        
    } catch (e) {
        console.warn("No se pudo refrescar el stock:", e);
    }
}

// NUEVA FUNCIÓN: refresca el catálogo del backend y repinta el grid
// respetando el texto que haya en el buscador
async function refrescarCatalogo() {
    try {
        const respuestaCatalogo = await apiFetch('/pos/catalogo/', 'GET');
        catalogo = Array.isArray(respuestaCatalogo) ? respuestaCatalogo : (respuestaCatalogo.results || []);

        // Actualizar también el stock de los items que sigan en el carrito
        carrito.forEach(function(item) {
            const actualizado = catalogo.find(function(c) { return c.id === item.presentacion_id; });
            if (actualizado) {
                item.stock_disponible = parseFloat(actualizado.stock_disponible) || 0;
            }
        });

        // Repintar respetando el filtro activo del buscador
        const texto = document.getElementById('buscador-productos').value.toLowerCase().trim();
        if (texto === '') {
            renderizarCatalogoHTML();
        } else {
            const filtrados = catalogo.filter(function(item) {
                const nombreProd = item.producto.nombre ? item.producto.nombre.toLowerCase() : '';
                const codigoProd = item.producto.codigo_base ? item.producto.codigo_base.toLowerCase() : '';
                const nombrePres = item.nombre_presentacion ? item.nombre_presentacion.toLowerCase() : '';
                return nombreProd.includes(texto) || codigoProd.includes(texto) || nombrePres.includes(texto);
            });
            renderizarCatalogoHTML(filtrados);
        }
    } catch (e) {
        console.warn("No se pudo refrescar el catálogo tras la venta:", e);
    }
}
function agregarLineaPago() {
    const cont = document.getElementById('contenedor-pagos');
    const idx = Date.now() + Math.random().toString(36).substr(2, 5);

    let optionsHTML = '<option value="">-- Seleccione --</option>';
    metodosPagoCache.forEach(m => {
        optionsHTML += '<option value="' + m.id + '" data-moneda="' + m.moneda_referencia + '">' + m.nombre + '</option>';
    });

    const div = document.createElement('div');
    // FIX: fila flex sin wrap para que la equis de eliminar quede SIEMPRE
    // en la misma linea que su metodo de pago (antes un row de columnas
    // fijas desbordaba y la equis saltaba a la linea de abajo).
    div.className = 'd-flex flex-nowrap align-items-center gap-2 mb-2 linea-pago-fila';
    div.id = 'linea-pago-' + idx;
    div.innerHTML = '' +
        '<select class="form-select form-select-sm metodo-pago-select flex-grow-1" style="min-width: 0;" data-prev-moneda="" onchange="alCambiarMetodoPago(this)">' +
            optionsHTML +
        '</select>' +
        '<input type="number" class="form-control form-control-sm monto-pago-input flex-grow-1" style="min-width: 0; max-width: 130px;" placeholder="Monto" step="0.01" value="" onclick="this.select()" oninput="evaluarEstadoPago(); actualizarEquivalenteFila(this.closest(\'.linea-pago-fila\'));">' +
        '<small class="text-muted equiv-pago-display flex-shrink-0" style="display: none; font-size: 0.75em; white-space: nowrap; min-width: 62px;"></small>' +
        '<button type="button" class="btn btn-sm btn-outline-danger flex-shrink-0 d-flex align-items-center justify-content-center px-2" style="width: 32px; height: 32px;" title="Quitar metodo de pago" onclick="eliminarLineaPago(this)"><i class="bi bi-x-lg"></i></button>';
    cont.appendChild(div);

    evaluarEstadoPago();
}

function eliminarLineaPago(btn) {
    const fila = btn.closest('.linea-pago-fila');
    if (fila) fila.remove();
    evaluarEstadoPago();
}

function alCambiarMetodoPago(selectElement) {
    const fila = selectElement.closest('.linea-pago-fila');
    const inputMonto = fila.querySelector('.monto-pago-input');
    const opcionSeleccionada = selectElement.options[selectElement.selectedIndex];

    if (!selectElement.value) {
        selectElement.setAttribute('data-prev-moneda', '');
        evaluarEstadoPago();
        return;
    }

    const nuevaMoneda = opcionSeleccionada.getAttribute('data-moneda') || 'PRINCIPAL';
    const monedaPrevia = selectElement.getAttribute('data-prev-moneda');
    const valorActual = parseFloat(inputMonto.value);

    if (isNaN(valorActual) || valorActual === 0) {
        const totales = calcularTotales();
        const totalUSD = parseFloat(totales.total_usd);
        let sumaUSD = 0;

        document.querySelectorAll('.linea-pago-fila').forEach(otraFila => {
            if (otraFila !== fila) {
                const selOtra = otraFila.querySelector('.metodo-pago-select');
                const opcOtra = selOtra.options[selOtra.selectedIndex];
                const monOtra = opcOtra ? (opcOtra.getAttribute('data-moneda') || 'PRINCIPAL') : 'PRINCIPAL';
                const montOtra = parseFloat(otraFila.querySelector('.monto-pago-input').value) || 0;

                if (monOtra === 'SECUNDARIA') {
                    if (tasaCambio > 0) sumaUSD += montOtra / tasaCambio;
                } else {
                    sumaUSD += montOtra;
                }
            }
        });

        let faltaUSD = totalUSD - sumaUSD;
        if (faltaUSD < 0) faltaUSD = 0;

        let sugerencia = faltaUSD;
        if (nuevaMoneda === 'SECUNDARIA') {
            sugerencia = faltaUSD * tasaCambio;
        }

        inputMonto.value = sugerencia > 0 ? sugerencia.toFixed(2) : '';

    } else if (monedaPrevia && monedaPrevia !== nuevaMoneda) {
        let nuevoValor = valorActual;

        if (monedaPrevia === 'PRINCIPAL' && nuevaMoneda === 'SECUNDARIA') {
            nuevoValor = valorActual * tasaCambio;
            console.log("Conversion POS: $" + valorActual + " USD convertido a Bs " + nuevoValor.toFixed(2));
        } else if (monedaPrevia === 'SECUNDARIA' && nuevaMoneda === 'PRINCIPAL') {
            if (tasaCambio > 0) {
                nuevoValor = valorActual / tasaCambio;
                console.log("Conversion POS: Bs " + valorActual + " convertido a $" + nuevoValor.toFixed(2) + " USD");
            }
        }

        inputMonto.value = nuevoValor.toFixed(2);
    }

    selectElement.setAttribute('data-prev-moneda', nuevaMoneda);
    evaluarEstadoPago();
    actualizarEquivalenteFila(fila);
}

function actualizarEquivalenteFila(fila) {
    if (!fila) return;
    const select = fila.querySelector('.metodo-pago-select');
    const inputMonto = fila.querySelector('.monto-pago-input');
    const display = fila.querySelector('.equiv-pago-display');
    if (!select || !inputMonto || !display) return;

    const opcion = select.options[select.selectedIndex];
    const moneda = opcion ? (opcion.getAttribute('data-moneda') || 'PRINCIPAL') : 'PRINCIPAL';
    const monto = parseFloat(inputMonto.value) || 0;

    if (monto <= 0 || tasaCambio <= 0) {
        display.style.display = 'none';
        return;
    }

    if (moneda === 'SECUNDARIA') {
        const usd = monto / tasaCambio;
        display.textContent = '≈ $ ' + usd.toFixed(2);
        display.style.display = 'inline';
    } else {
        // A1: equivalencia inversa USD → BS
        const bs = monto * tasaCambio;
        display.textContent = '≈ BS ' + bs.toFixed(2);
        display.style.display = 'inline';
    }
}

function evaluarEstadoPago() {
    const totales = calcularTotales();
    const totalUSD = parseFloat(totales.total_usd);
    const tipoVenta = document.querySelector('input[name="tipoVenta"]:checked').value;

    let sumaUSD = 0;
    const filas = document.querySelectorAll('.linea-pago-fila');
    const pagosDetalle = [];

    filas.forEach(fila => {
        const select = fila.querySelector('.metodo-pago-select');
        const opcion = select.options[select.selectedIndex];
        const metodoId = parseInt(select.value);
        const moneda = opcion ? (opcion.getAttribute('data-moneda') || 'PRINCIPAL') : 'PRINCIPAL';
        const nombreMetodo = opcion ? opcion.text : '';
        const monto = parseFloat(fila.querySelector('.monto-pago-input').value) || 0;

        if (metodoId && monto > 0) {
            let montoUSD = monto;
            if (moneda === 'SECUNDARIA') {
                if (tasaCambio > 0) montoUSD = monto / tasaCambio;
            }
            sumaUSD += montoUSD;
            pagosDetalle.push({ nombre: nombreMetodo, monto: monto, moneda: moneda, montoUSD: montoUSD });
        }
    });

    const restante = totalUSD - sumaUSD;
    const restanteEl = document.getElementById('cobro-restante-usd');
    const restanteBsEl = document.getElementById('cobro-restante-bs');
    const btnFacturar = document.getElementById('btn-procesar-factura');

    window._datosPago = { pagos: pagosDetalle, totalPagadoUSD: sumaUSD, restante: restante, tipoVenta: tipoVenta };

    // --- Equivalencia BS del restante (siempre visible si hay tasa) ---
    if (restanteBsEl) {
        if (tasaCambio > 0 && Math.abs(restante) > 0.01) {
            const restanteBS = Math.abs(restante) * tasaCambio;
            restanteBsEl.textContent = '≈ BS ' + restanteBS.toFixed(2);
            restanteBsEl.style.display = 'block';
        } else {
            restanteBsEl.style.display = 'none';
        }
    }

    if (tipoVenta === 'CREDITO') {
        // --- C1: restante contextualizado con deuda y saldo a favor ---
        const cliente = clientesCache.find(c => c.id === clienteSeleccionadoId);
        const deudaCliente = cliente ? (parseFloat(cliente.deuda_total) || 0) : 0;
        const saldoFavor = cliente ? (parseFloat(cliente.saldo_a_favor) || 0) : 0;
        const compromisoTotal = restante + deudaCliente - saldoFavor;

        if (restante < -0.01) {
            restanteEl.innerText = 'SOBRANTE: $ ' + Math.abs(restante).toFixed(2);
            restanteEl.className = 'text-success fw-bold mb-0';
            btnFacturar.disabled = false;
        } else {
            restanteEl.innerText = '$ ' + restante.toFixed(2);
            restanteEl.className = 'text-info fw-bold mb-0';
            btnFacturar.disabled = false;
        }

        // Texto contextual del paréntesis
        if (compromisoTotal > 0.01) {
            if (deudaCliente > 0.01) {
                restanteEl.innerText += ' (PENDIENTE TOTAL: $' + compromisoTotal.toFixed(2) + ' incl. deuda)';
            } else {
                restanteEl.innerText += ' (PENDIENTE: $' + compromisoTotal.toFixed(2) + ')';
            }
            restanteEl.className = 'text-warning fw-bold mb-0';
        } else {
            if (saldoFavor > 0.01 && restante > 0.01) {
                restanteEl.innerText += ' (AL DÍA — cubierto por saldo a favor)';
            } else {
                restanteEl.innerText += ' (AL DÍA)';
            }
            restanteEl.className = 'text-success fw-bold mb-0';
        }

        // --- C2: aviso si excede límite de crédito ---
        const limite = cliente ? (parseFloat(cliente.limite_credito) || 0) : 0;
        if (limite > 0 && compromisoTotal > limite) {
            restanteEl.innerText += ' ⚠ EXCEDE LÍMITE';
            restanteEl.className = 'text-danger fw-bold mb-0';
        }

    } else {
        // CONTADO
        if (restante > 0.01) {
            restanteEl.innerText = '$ ' + restante.toFixed(2);
            restanteEl.className = 'text-warning fw-bold mb-0';
            btnFacturar.disabled = true;
        } else if (restante < -0.01) {
            restanteEl.innerText = 'VUELTO: $ ' + Math.abs(restante).toFixed(2);
            restanteEl.className = 'text-success fw-bold mb-0';
            btnFacturar.disabled = false;
        } else {
            restanteEl.innerText = '$ 0.00';
            restanteEl.className = 'text-success fw-bold mb-0';
            btnFacturar.disabled = false;
        }
    }

    // --- FASE 1.5: panel de distribución del vuelto ---
    const panelVuelto = document.getElementById('panel-vuelto');
    if (panelVuelto) {
        const excedente = Math.max(0, sumaUSD - totalUSD);
        const clienteActual = clientesCache.find(function (c) { return c.id === clienteSeleccionadoId; });
        const deudaCliente = clienteActual ? (parseFloat(clienteActual.deuda_total) || 0) : 0;
        const obligatorioEfectivo = configVuelto.vuelto_obligatorio_efectivo === true;
        const permitidoCxc = configVuelto.permitir_vuelto_a_cxc && deudaCliente > 0.01 && !obligatorioEfectivo;
        const permitidoSaldo = configVuelto.permitir_vuelto_a_saldo_favor && !obligatorioEfectivo;

        if (excedente > 0.01) {
            panelVuelto.style.display = 'block';
            document.getElementById('panel-vuelto-monto').innerText = excedente.toFixed(2);
            document.getElementById('vuelto-deuda-disp').innerText = '$ ' + deudaCliente.toFixed(2);
            document.getElementById('vuelto-op-cxc-wrap').style.display = permitidoCxc ? 'block' : 'none';
            document.getElementById('vuelto-op-saldo-wrap').style.display = permitidoSaldo ? 'block' : 'none';
            document.getElementById('vuelto-op-mixto-wrap').style.display = obligatorioEfectivo ? 'none' : 'block';

            // Selección por defecto solo la primera vez: deudas si hay, si no entregar
            if (!panelVuelto.dataset.inicializado) {
                const destinoDefault = permitidoCxc ? 'CXC' : 'ENTREGAR';
                const radioDefault = document.querySelector('input[name="destinoVuelto"][value="' + destinoDefault + '"]');
                if (radioDefault) radioDefault.checked = true;
                panelVuelto.dataset.inicializado = '1';
            }
            // Si la opción seleccionada quedó oculta (cambió la config/deuda), volver a ENTREGAR
            const seleccionado = document.querySelector('input[name="destinoVuelto"]:checked');
            if (seleccionado) {
                const wrap = seleccionado.closest('.form-check');
                if (wrap && wrap.style.display === 'none') {
                    document.getElementById('vuelto-entregar').checked = true;
                }
            }
            actualizarPanelVuelto();
        } else {
            panelVuelto.style.display = 'none';
            delete panelVuelto.dataset.inicializado;
        }
    }

    // Nunca reactivar el botón mientras una facturación esté en curso
    if (facturandoEnCurso || (tipoVenta === 'CONTADO' && totalUSD > 0 && sumaUSD <= 0)) {
        btnFacturar.disabled = true;
    }
}

// ==============================================================================
// FASE 1.5 (Anexo A): DISTRIBUCIÓN DEL VUELTO
// ==============================================================================
function actualizarPanelVuelto() {
    const panel = document.getElementById('panel-vuelto');
    if (!panel || panel.style.display === 'none') return;
    const excedente = parseFloat(document.getElementById('panel-vuelto-monto').innerText) || 0;
    const mixtoSel = document.getElementById('vuelto-mixto') && document.getElementById('vuelto-mixto').checked;
    document.getElementById('vuelto-mixto-campos').style.display = mixtoSel ? 'block' : 'none';

    if (mixtoSel) {
        const tasa = tasaCambio > 0 ? tasaCambio : 1;
        const eusd = parseFloat(document.getElementById('vuelto-mix-entregar-usd').value) || 0;
        const ebs = parseFloat(document.getElementById('vuelto-mix-entregar-bs').value) || 0;
        const cxc = parseFloat(document.getElementById('vuelto-mix-cxc').value) || 0;
        const saldo = parseFloat(document.getElementById('vuelto-mix-saldo').value) || 0;
        const asignado = eusd + ebs / tasa + cxc + saldo;
        const info = document.getElementById('vuelto-mix-info');
        const dif = excedente - asignado;
        if (asignado > excedente + 0.01) {
            info.innerHTML = '<span class="text-danger fw-bold">⚠ La distribución ($' + asignado.toFixed(2) +
                ') excede el vuelto ($' + excedente.toFixed(2) + '). Corrige antes de facturar.</span>';
        } else if (dif > 0.01) {
            info.innerHTML = '<span class="text-muted">Sin asignar: $' + dif.toFixed(2) +
                ' → se aplicará por defecto a deudas viejas / saldo a favor.</span>';
        } else {
            info.innerHTML = '<span class="text-success">✓ Distribución completa.</span>';
        }
    }
}

function construirVueltoDistribucion() {
    const panel = document.getElementById('panel-vuelto');
    if (!panel || panel.style.display === 'none') return null;
    const excedente = parseFloat(document.getElementById('panel-vuelto-monto').innerText) || 0;
    if (excedente <= 0.01) return null;

    const seleccionado = document.querySelector('input[name="destinoVuelto"]:checked');
    const destino = seleccionado ? seleccionado.value : 'ENTREGAR';

    if (destino === 'CXC') {
        return {
            entregado_principal: '0.00', entregado_secundaria: '0.00',
            aplicado_cxc_principal: excedente.toFixed(2), saldo_favor_principal: '0.00'
        };
    }
    if (destino === 'SALDO') {
        return {
            entregado_principal: '0.00', entregado_secundaria: '0.00',
            aplicado_cxc_principal: '0.00', saldo_favor_principal: excedente.toFixed(2)
        };
    }
    if (destino === 'MIXTO') {
        return {
            entregado_principal: (parseFloat(document.getElementById('vuelto-mix-entregar-usd').value) || 0).toFixed(2),
            entregado_secundaria: (parseFloat(document.getElementById('vuelto-mix-entregar-bs').value) || 0).toFixed(2),
            aplicado_cxc_principal: (parseFloat(document.getElementById('vuelto-mix-cxc').value) || 0).toFixed(2),
            saldo_favor_principal: (parseFloat(document.getElementById('vuelto-mix-saldo').value) || 0).toFixed(2)
        };
    }
    // ENTREGAR (default)
    return {
        entregado_principal: excedente.toFixed(2),
        entregado_secundaria: '0.00',
        aplicado_cxc_principal: '0.00',
        saldo_favor_principal: '0.00'
    };
}

// >>> NUEVO: helper visual para el estado "procesando" del boton <<<
function setBotonFacturando(btn, procesando) {
    if (!btn) return;
    if (procesando) {
        btn.disabled = true;
        btn.dataset.labelOriginal = btn.innerHTML;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>PROCESANDO...';
    } else {
        btn.disabled = false;
        if (btn.dataset.labelOriginal) btn.innerHTML = btn.dataset.labelOriginal;
    }
}

async function ejecutarFacturacionFinal() {
    if (facturandoEnCurso) {
        console.warn("Facturación ya en curso. Ignorando clic duplicado.");
        return;
    }

    const btn = document.getElementById('btn-procesar-factura');
    const modalEl = document.getElementById('modalCobro');

    facturandoEnCurso = true;
    setBotonFacturando(btn, true);

    try {
        const tipoVenta = document.querySelector('input[name="tipoVenta"]:checked').value;
        await procesarFactura(tipoVenta);

        const modalInst = bootstrap.Modal.getInstance(modalEl);
        if (modalInst) modalInst.hide();

    } catch (error) {
        console.error("Error en facturación:", error);

        let mensajeDeError = "Error desconocido al procesar la venta.";
        if (error.error) mensajeDeError = error.error;
        else if (error.messageForUser) mensajeDeError = error.messageForUser;
        else if (error.detail) mensajeDeError = error.detail;

        alert("No se pudo completar la venta:\n\n" + mensajeDeError);

    } finally {
        // >>> FIX: restaurar el botón SIEMPRE, en éxito o en fallo <<<
        facturandoEnCurso = false;
        setBotonFacturando(btn, false);
    }
}

// REEMPLAZAR la función procesarFactura completa
async function procesarFactura(tipoPago) {
    if (carrito.length === 0) { 
        alert("El carrito está vacío"); 
        return; 
    }
    
    const totales = calcularTotales();
    const clientePreVenta = clientesCache.find(function(c) { 
        return c.id === clienteSeleccionadoId; 
    });
    const deudaAnteriorCliente = clientePreVenta ? (parseFloat(clientePreVenta.deuda_total) || 0) : 0;

    const pagos = [];
    document.querySelectorAll('.linea-pago-fila').forEach(function(fila) {
        const select = fila.querySelector('.metodo-pago-select');
        const metodoId = parseInt(select.value);
        const opcion = select.options[select.selectedIndex];
        const moneda = opcion.getAttribute('data-moneda') || 'PRINCIPAL';
        const monto = parseFloat(fila.querySelector('.monto-pago-input').value) || 0;

        if (!metodoId || monto <= 0) return;

        let montoUSD = monto;
        if (moneda === 'SECUNDARIA') {
            montoUSD = monto / tasaCambio;
        }

        pagos.push({
            metodo_id: metodoId,
            monto_pagado: monto.toFixed(2),
            monto_equivalente_principal: montoUSD.toFixed(2),
            tasa_cambio_pago: tasaCambio.toFixed(2),
            referencia: ''
        });
    });

    const payload = {
        cliente_id: clienteSeleccionadoId || CLIENTE_MOSTRADOR_ID,
        almacen_id: ALMACEN_PRINCIPAL_ID,
        tipo: tipoPago,
        tasa_cambio_historica: tasaCambio.toFixed(2),
        subtotal_principal: totales.subtotal,
        total_impuestos_principal: totales.impuestos,
        total_principal: totales.total_usd,
        total_secundaria: totales.total_bs,
        detalles: carrito.map(function(item) {
            return {
                presentacion_id: item.presentacion_id,
                cantidad_presentacion: item.cantidad.toFixed(2),
                precio_unitario_aplicado: item.precio_unitario.toFixed(2),
                porcentaje_impuesto_aplicado: item.impuesto_porcentaje.toFixed(2),
                subtotal: item.subtotal.toFixed(2)
            };
        }),
        pagos: pagos,
        vuelto_distribucion: construirVueltoDistribucion()
    };

    try {
        const respuesta = await apiFetch('/pos/facturar/', 'POST', payload);

        // >>> NUEVO: refrescar stock en pantalla sin recargar la página <<<
        await refrescarCatalogo();

        // Guardar datos del ticket antes de limpiar
        const datosTicket = {
            ventaId: respuesta.venta_id,
            totales: totales,
            carritoFacturado: carrito.slice(),
            tipoPago: tipoPago,
            pagos: pagos,
            infoCredito: {
                deuda_anterior: deudaAnteriorCliente,
                saldo_favor_usado: respuesta.saldo_favor_usado || 0,
                sobrante_abono: respuesta.sobrante_abono || 0,
                saldo_restante_cxc: respuesta.saldo_restante_cxc || 0,
                estado_cxc: respuesta.estado_cxc,
                abonos_cxc_viejas: respuesta.abonos_cxc_viejas || [],
                abono_nueva_cxc: respuesta.abono_nueva_cxc || 0,
                saldo_favor_a_nueva: respuesta.saldo_favor_a_nueva || 0,
                deuda_total_cliente: respuesta.deuda_total_cliente || 0,
                // >>> FASE 1.5: vuelto distribuido <<<
                vuelto_total_principal: respuesta.vuelto_total_principal || 0,
                vuelto_entregado_principal: respuesta.vuelto_entregado_principal || 0,
                vuelto_entregado_secundaria: respuesta.vuelto_entregado_secundaria || 0,
                vuelto_aplicado_cxc_principal: respuesta.vuelto_aplicado_cxc_principal || 0,
                vuelto_a_saldo_favor_principal: respuesta.vuelto_a_saldo_favor_principal || 0
            }
        };

        // Limpiar carrito inmediatamente
        carrito = [];
        calcularTotales();
        renderizarCarritoHTML();
        guardarCarritoEnStorage();

        // Generar ticket (con try-catch independiente)
        try {
            generarEImprimirTicket(
                datosTicket.ventaId,
                datosTicket.totales,
                datosTicket.carritoFacturado,
                datosTicket.tipoPago,
                datosTicket.pagos,
                datosTicket.infoCredito
            );
        } catch (ticketError) {
            console.error("Error al generar ticket:", ticketError);
        }

        // Mostrar mensaje de éxito
        let msg = "✅ Venta Procesada! Factura #" + respuesta.venta_id;
        if (respuesta.tipo === 'CREDITO') {
            msg += "\n\n--- RESUMEN CRÉDITO ---";
            if (respuesta.abonos_cxc_viejas && respuesta.abonos_cxc_viejas.length > 0) {
                msg += "\n\nAbonos a facturas anteriores:";
                respuesta.abonos_cxc_viejas.forEach(function(ab) {
                    var origenTxt = (ab.origen === 'SALDO_A_FAVOR') ? ' (saldo a favor)' : '';
                    msg += "\n  - Fact. #" + (ab.venta_id || 'Inicial') + ": $" + ab.monto_aplicado.toFixed(2) + origenTxt;
                });
            }
            if (respuesta.abono_nueva_cxc > 0) {
                msg += "\nAbono a factura nueva: $" + respuesta.abono_nueva_cxc.toFixed(2);
            }
            if (respuesta.saldo_favor_a_nueva > 0) {
                msg += "\nSaldo a favor usado en nueva: $" + respuesta.saldo_favor_a_nueva.toFixed(2);
            }
            if (respuesta.saldo_restante_cxc > 0) {
                msg += "\nSaldo pendiente nueva: $" + respuesta.saldo_restante_cxc.toFixed(2);
            } else {
                msg += "\nFactura nueva PAGADA";
            }
            if (respuesta.sobrante_abono > 0) {
                msg += "\nSobrante a favor: $" + respuesta.sobrante_abono.toFixed(2);
            }
            if (respuesta.deuda_total_cliente > 0) {
                msg += "\n\nDEUDA TOTAL DEL CLIENTE: $" + respuesta.deuda_total_cliente.toFixed(2);
            } else {
                msg += "\n\nCliente AL DÍA (sin deudas pendientes)";
            }
        }
        if (respuesta.vuelto_total_principal > 0.01) {
            msg += "\n\n--- VUELTO ---";
            msg += "\nTotal: $" + respuesta.vuelto_total_principal.toFixed(2);
            if (respuesta.vuelto_entregado_principal > 0.01 || respuesta.vuelto_entregado_secundaria > 0.01) {
                msg += "\nEntregado en efectivo: $" + respuesta.vuelto_entregado_principal.toFixed(2) +
                    (respuesta.vuelto_entregado_secundaria > 0.01 ? " + BS " + respuesta.vuelto_entregado_secundaria.toFixed(2) : "");
            }
            if (respuesta.vuelto_aplicado_cxc_principal > 0.01) {
                msg += "\nAplicado a deudas: $" + respuesta.vuelto_aplicado_cxc_principal.toFixed(2);
            }
            if (respuesta.vuelto_a_saldo_favor_principal > 0.01) {
                msg += "\nGuardado como saldo a favor: $" + respuesta.vuelto_a_saldo_favor_principal.toFixed(2);
            }
        }
        alert(msg);

        // Refrescar datos (con try-catch independiente)
        try {
            await cargarDatosIniciales();
        } catch (cacheError) {
            console.warn("No se pudo refrescar caché de clientes:", cacheError);
        }

        // Volver a cliente genérico
        try {
            const clienteGenerico = clientesCache.find(function(c) {
                return String(c.documento).toLowerCase() === 'generico';
            });
            if (clienteGenerico) {
                seleccionarCliente(clienteGenerico.id, clienteGenerico.nombre);
            } else {
                seleccionarCliente(CLIENTE_MOSTRADOR_ID, "Cliente Genérico");
            }
        } catch (clienteError) {
            console.warn("No se pudo resetear cliente:", clienteError);
        }

    } catch (error) {
        console.error("Detalle técnico del error:", error);
        throw error;
    }
}

// ==============================================================================
// 8. VISUALES
// ==============================================================================
// REEMPLAZAR la función renderizarCatalogoHTML completa
// ═══════════════════════════════════════════════════════════════════════════
// POS MÓVIL (FASE 1): dispatchers PC / Móvil.
// En PC (>= 768px) se ejecuta EXACTAMENTE el mismo render de siempre
// (renderizarCatalogoPC / renderizarCarritoPC). En móvil se dibuja la vista
// táctil. Ninguna de las dos ramas cambia a la otra: al rotar el teléfono se
// re-renderiza con el resize listener del final del archivo.
// ═══════════════════════════════════════════════════════════════════════════
function esVistaMovilPOS() {
    return window.innerWidth < 768;
}

function renderizarCatalogoHTML(productosAMostrar) {
    if (productosAMostrar === undefined) productosAMostrar = catalogo;

    const listaMobile = document.getElementById('lista-productos-mobile');
    if (esVistaMovilPOS() && listaMobile) {
        let lista = productosAMostrar;
        if (typeof categoriaActiva !== 'undefined' && categoriaActiva && categoriaActiva !== 'todos') {
            lista = productosAMostrar.filter(function(p) {
                return (p.producto.categoria_nombre || 'General') === categoriaActiva;
            });
        }
        renderizarCatalogoMobile(lista, listaMobile);
        return;
    }
    renderizarCatalogoPC(productosAMostrar);
}

function renderizarCatalogoPC(productosAMostrar) {
    const contenedor = document.getElementById('gridProductos');
    contenedor.innerHTML = '';

    if (productosAMostrar.length === 0) {
        contenedor.innerHTML = '<div class="col-12 text-center text-muted mt-5"><h4>No se encontraron productos</h4></div>';
        return;
    }

    const productosAgrupados = {};
    productosAMostrar.forEach(function(presentacion) {
        const idProd = presentacion.producto.id;
        if (!productosAgrupados[idProd]) {
            productosAgrupados[idProd] = { 
                productoBase: presentacion.producto, 
                presentaciones: [] 
            };
        }
        productosAgrupados[idProd].presentaciones.push(presentacion);
    });

    Object.values(productosAgrupados).forEach(function(grupo) {
        const prod = grupo.productoBase;
        const presentaciones = grupo.presentaciones;

        let optionsHTML = '';
        presentaciones.forEach(function(pres) {
            const precioBs = (pres.precio_venta_principal * tasaCambio).toFixed(2);
            const stock = parseFloat(pres.stock_disponible) || 0;
            const stockTexto = stock.toFixed(2);
            
            optionsHTML += '<option value="' + pres.id + '" data-precio="' + pres.precio_venta_principal + '" data-bs="' + precioBs + '" data-stock="' + stock + '">' + 
                pres.nombre_presentacion + ' (Stock: ' + stockTexto + ')</option>';
        });

        const idSelect = 'select-pres-' + prod.id;
        const idPrecioUi = 'precio-ui-' + prod.id;
        const idPrecioBsUi = 'precio-bs-ui-' + prod.id;
        const idStockUi = 'stock-ui-' + prod.id;

        const precioInicialUSD = parseFloat(presentaciones[0].precio_venta_principal).toFixed(2);
        const precioInicialBS = (parseFloat(presentaciones[0].precio_venta_principal) * tasaCambio).toFixed(2);
        const stockInicial = parseFloat(presentaciones[0].stock_disponible) || 0;
        
        const stockClaseInicial = stockInicial <= 0 ? 'text-danger fw-bold' : stockInicial <= 5 ? 'text-warning' : 'text-success';
        const stockIcono = stockInicial <= 0 ? 'bi-x-circle-fill' : stockInicial <= 5 ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill';

        const tarjeta = '' +
            '<div class="col-12 col-sm-6 col-lg-4 mb-3">' +
                '<div class="card h-100 shadow-sm border-primary" style="transition: transform 0.2s;">' +
                    '<div class="card-body d-flex flex-column text-center">' +
                        '<h6 class="card-title fw-bold text-truncate" title="' + prod.nombre + '">' + prod.nombre + '</h6>' +
                        '<div class="mt-auto">' +
                            '<h4 class="text-primary fw-bold mb-0" id="' + idPrecioUi + '">$ ' + precioInicialUSD + '</h4>' +
                            '<small class="text-muted d-block mb-2" id="' + idPrecioBsUi + '">BS ' + precioInicialBS + '</small>' +
                            '<small class="d-block mb-2 ' + stockClaseInicial + '" id="' + idStockUi + '">' +
                                '<i class="bi ' + stockIcono + '"></i> ' +
                                'Stock: ' + stockInicial.toFixed(2) + ' ' + (presentaciones[0].unidad_sigla || 'und') +
                            '</small>' +
                            '<select class="form-select form-select-sm mb-3 border-secondary" id="' + idSelect + '" onchange="actualizarPrecioTarjeta(\'' + idSelect + '\', \'' + idPrecioUi + '\', \'' + idPrecioBsUi + '\', \'' + idStockUi + '\')">' +
                                optionsHTML +
                            '</select>' +
                            '<button class="btn btn-success w-100 fw-bold shadow-sm" onclick="agregarDesdeTarjeta(\'' + idSelect + '\')">Agregar</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        contenedor.innerHTML += tarjeta;
    });
}

// VERSIÓN ÚNICA Y DEFINITIVA de actualizarPrecioTarjeta
function actualizarPrecioTarjeta(idSelect, idPrecioUi, idPrecioBsUi, idStockUi) {
    const select = document.getElementById(idSelect);
    const opcion = select.options[select.selectedIndex];

    document.getElementById(idPrecioUi).innerText = '$ ' + parseFloat(opcion.getAttribute('data-precio')).toFixed(2);
    document.getElementById(idPrecioBsUi).innerText = 'BS ' + parseFloat(opcion.getAttribute('data-bs')).toFixed(2);

    if (idStockUi) {
        const stock = parseFloat(opcion.getAttribute('data-stock')) || 0;
        const stockEl = document.getElementById(idStockUi);

        // Recuperar la unidad de medida del catálogo para no perderla al cambiar
        const presId = parseInt(select.value);
        const catItem = catalogo.find(function(c) { return c.id === presId; });
        const unidad = (catItem && catItem.unidad_sigla) ? catItem.unidad_sigla : 'und';

        const icono = stock <= 0 ? 'bi-x-circle-fill' : stock <= 5 ? 'bi-exclamation-triangle-fill' : 'bi-check-circle-fill';
        stockEl.innerHTML = '<i class="bi ' + icono + '"></i> Stock: ' + stock.toFixed(2) + ' ' + unidad;
        stockEl.className = 'd-block mb-2 ' +
            (stock <= 0 ? 'text-danger fw-bold' : stock <= 5 ? 'text-warning' : 'text-success');
    }
}

function agregarDesdeTarjeta(idSelect) {
    const select = document.getElementById(idSelect);
    agregarAlCarrito(parseInt(select.value));
}

function renderizarCarritoHTML() {
    const listaMobile = document.getElementById('carrito-lista-mobile');
    if (esVistaMovilPOS() && listaMobile) {
        renderizarCarritoMobile(listaMobile);
        return;
    }
    renderizarCarritoPC();
}

function renderizarCarritoPC() {
    const tbody = document.getElementById('tablaCarrito');
    tbody.innerHTML = '';
    if (carrito.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted py-5 text-center"><i class="bi bi-cart-x fs-1 d-block mb-2"></i>El carrito esta vacio</td></tr>';
        return;
    }
    carrito.forEach(function(item) {
        const fila = document.createElement('tr');
        fila.innerHTML = '' +
            '<td class="text-start align-middle"><div class="text-truncate" style="max-width: 140px;" title="' + item.nombre + '">' + item.nombre + '</div></td>' +
            '<td class="align-middle">' +
                '<div class="d-flex justify-content-center align-items-center">' +
                    '<button class="btn btn-sm btn-outline-secondary px-2 py-0" onclick="quitarDelCarrito(' + item.presentacion_id + ')">-</button>' +
                    '<input type="number" class="form-control form-control-sm text-center mx-1 fw-bold" style="width: 80px;" value="' + item.cantidad + '" min="0.001" step="0.001" onclick="this.select()" onchange="actualizarCantidadManual(' + item.presentacion_id + ', this.value)">' +
                    '<button class="btn btn-sm btn-outline-secondary px-2 py-0" onclick="agregarAlCarrito(' + item.presentacion_id + ')">+</button>' +
                '</div>' +
            '</td>' +
            '<td class="align-middle ' + (puedeCambiarPrecio ? 'text-primary text-decoration-underline' : '') + '" style="' + (puedeCambiarPrecio ? 'cursor: pointer;' : '') + '" title="' + (puedeCambiarPrecio ? 'Doble clic para cambiar precio' : 'Precio fijo') + '" ondblclick="ejecutarCambioPrecioItem(' + item.presentacion_id + ')">' +
                '$ ' + item.precio_unitario.toFixed(2) +
            '</td>' +
            '<td class="align-middle fw-bold">$ ' + item.subtotal.toFixed(2) + '</td>' +
            '<td class="align-middle"><button class="btn btn-sm btn-danger px-2 py-0" onclick="eliminarFila(' + item.presentacion_id + ')">X</button></td>';
        tbody.appendChild(fila);
    });
}

// REEMPLAZAR la función actualizarCantidadManual completa
function actualizarCantidadManual(idPresentacion, valor) {
    let nuevaCantidad = parseFloat(valor);
    
    if (isNaN(nuevaCantidad) || nuevaCantidad <= 0) {
        alert("Por favor, ingresa una cantidad válida mayor a cero.");
        renderizarCarritoHTML();
        return;
    }

    const item = carrito.find(function(i) { 
        return i.presentacion_id === idPresentacion; 
    });
    
    if (!item) {
        renderizarCarritoHTML();
        return;
    }
    
    const stockDisponible = parseFloat(item.stock_disponible) || 0;
    
    if (!permitirStockNegativo && stockDisponible <= 0) {
        alert(
            `❌ SIN STOCK\n\n` +
            `Producto: ${item.nombre}\n` +
            `No hay stock disponible para este producto.`
        );
        renderizarCarritoHTML();
        return;
    }
    
    if (!permitirStockNegativo && nuevaCantidad > stockDisponible) {
        const confirmar = confirm(
            `⚠️ STOCK INSUFICIENTE\n\n` +
            `Producto: ${item.nombre}\n` +
            `Disponible: ${stockDisponible.toFixed(2)} ${item.unidad_sigla || 'und'}\n` +
            `Solicitado: ${nuevaCantidad.toFixed(2)}\n\n` +
            `¿Deseas ajustar a la cantidad disponible (${stockDisponible.toFixed(2)})?`
        );
        
        if (!confirmar) {
            renderizarCarritoHTML();
            return;
        }
        
        nuevaCantidad = stockDisponible;
    }
    
    item.cantidad = nuevaCantidad;
    item.subtotal = item.cantidad * item.precio_unitario;
    
    calcularTotales();
    renderizarCarritoHTML();
    guardarCarritoEnStorage();
}

// ==============================================================================
// HELPER: Abrevia la unidad de la presentacion para el ticket
// "UNIDAD (X12)" -> "UND" | "Kilo" -> "KG" | "Litro" -> "LT"
// ==============================================================================
function abreviarUnidad(nombrePresentacion) {
    if (!nombrePresentacion) return '';
    let u = String(nombrePresentacion).toUpperCase().trim();

    // Quitar todo lo que este entre parentesis: "UNIDAD (X12)" -> "UNIDAD"
    u = u.replace(/\(.*?\)/g, '').trim();

    const mapaAbreviaturas = {
        'UNIDAD': 'UND', 'UNIDADES': 'UND',
        'KILO': 'KG', 'KILOS': 'KG', 'KILOGRAMO': 'KG', 'KILOGRAMOS': 'KG',
        'LITRO': 'LT', 'LITROS': 'LT', 'MILILITRO': 'ML', 'MILILITROS': 'ML',
        'GRAMO': 'GR', 'GRAMOS': 'GR',
        'CAJA': 'CAJ', 'CAJAS': 'CAJ',
        'PAQUETE': 'PQT', 'PAQUETES': 'PQT',
        'BOLSA': 'BOL', 'BOLSAS': 'BOL',
        'BOTELLA': 'BOT', 'BOTELLAS': 'BOT',
        'LATA': 'LTA', 'LATAS': 'LTA',
        'SACO': 'SAC', 'SACOS': 'SAC',
        'BARRA': 'BRA', 'BARRAS': 'BRA',
        'FRASCO': 'FRC', 'FRASCOS': 'FRC',
        'POTE': 'PTE', 'POTES': 'PTE',
        'MANOJO': 'MNJ', 'MANOJOS': 'MNJ',
        'DOCENA': 'DOC', 'DOCENAS': 'DOC',
        'GALON': 'GAL', 'GALONES': 'GAL',
        'MEDIDA': 'MED',
        'PORCION': 'POR', 'PORCIONES': 'POR'
    };

    if (mapaAbreviaturas[u]) return mapaAbreviaturas[u];

    // Si no esta en el mapa y sigue largo: usar solo la primera palabra
    if (u.length > 6) {
        u = u.split(/\s+/)[0];
        if (u.length > 6) u = u.substring(0, 6);
    }
    return u;
}

// ==============================================================================
// 9. TICKETS - VERSION 2 LINEAS POR PRODUCTO + BLOQUES DE DEUDA/PAGOS/PENDIENTE
// ==============================================================================
function generarEImprimirTicket(ventaId, totales, carritoFacturado, tipoVenta, pagos, infoCredito, extras) {
    infoCredito = infoCredito || {};
    // extras (opcional): solo lo usa la reimpresion desde el historial
    // para fecha/cliente/cajero/tasa de la factura original.
    // Al facturar una venta nueva no se pasa nada y todo queda igual que antes.
    extras = extras || {};
    const ticket = document.getElementById('ticket-impresion');

    ticket.classList.remove('activo');

    document.getElementById('ticket-id').innerText = ventaId;
    document.getElementById('ticket-fecha').innerText = extras.fechaTexto || new Date().toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    document.getElementById('ticket-cajero').innerText = extras.cajeroTexto || document.getElementById('nombreCajero').innerText;
    document.getElementById('ticket-cliente').innerText = extras.clienteTexto || clienteSeleccionadoNombre;
    document.getElementById('ticket-tipo-venta').innerText = tipoVenta;

    const totalUSD = parseFloat(totales.total_usd);

    // >>> PRODUCTOS: 2 lineas por producto <<<
    // Linea 1: "1.50 KILO X 5.50$/KILO"
    // Linea 2: "QUESO DURO            8.25$"
    const tbody = document.getElementById('ticket-items');
    tbody.innerHTML = '';
    carritoFacturado.forEach(function(item, idx) {
        const catItem = catalogo.find(function(c) { return c.id === item.presentacion_id; });
        let nombreProd = catItem ? catItem.producto.nombre : item.nombre;
        // >>> UNIDAD: prioriza la sigla que viene del server (unidad_sigla) <<<
        let unidad = '';
        if (catItem) {
            unidad = String(catItem.unidad_sigla || '').toUpperCase().trim();
        }
        if (!unidad) {
            unidad = catItem ? abreviarUnidad(catItem.nombre_presentacion) : abreviarUnidad(item.presentacion || '');
        }
        if (nombreProd.length > 24) nombreProd = nombreProd.substring(0, 23) + '…';

        const cantTxt = parseFloat(item.cantidad).toFixed(2) + (unidad ? ' ' + unidad : '');
        const precioTxt = '$' + item.precio_unitario.toFixed(2) + (unidad ? '/' + unidad : '');

        const row1 = document.createElement('tr');
        if (idx > 0) row1.className = 'sep';
        row1.innerHTML = '<td colspan="3" class="cant-precio">' + cantTxt + ' X ' + precioTxt + '</td>';
        tbody.appendChild(row1);

        const row2 = document.createElement('tr');
        row2.innerHTML = '<td colspan="2" style="word-break: break-word;">' + nombreProd + '</td>' +
                         '<td class="der" style="font-weight: 700;">$' + item.subtotal.toFixed(2) + '</td>';
        tbody.appendChild(row2);
    });

    // Totales (igual que antes)
    document.getElementById('ticket-subtotal').innerText = totales.subtotal;
    document.getElementById('ticket-iva').innerText = totales.impuestos;
    document.getElementById('ticket-total-usd').innerText = totales.total_usd;
    document.getElementById('ticket-total-bs').innerText = totales.total_bs;
    document.getElementById('ticket-tasa').innerText = extras.tasaTexto || tasaCambio.toFixed(2);

    const abonosViejos = infoCredito.abonos_cxc_viejas || [];
    const abonoNueva = parseFloat(infoCredito.abono_nueva_cxc) || 0;
    const saldoFavorNueva = parseFloat(infoCredito.saldo_favor_a_nueva) || 0;
    const deudaAnterior = parseFloat(infoCredito.deuda_anterior) || 0;

    // Suma de pagos en USD (para vuelto y pendiente)
    let sumaPagosUSD = 0;
    if (pagos && pagos.length > 0) {
        pagos.forEach(function(pago) {
            sumaPagosUSD += parseFloat(pago.monto_equivalente_principal) || 0;
        });
    }

    // >>> NUEVO: BLOQUE DEUDAS (solo ventas a CREDITO) <<<
    const deudasSection = document.getElementById('ticket-deudas-section');
    const deudasLista = document.getElementById('ticket-deudas-lista');

    if (tipoVenta === 'CREDITO') {
        deudasSection.style.display = 'block';
        deudasLista.innerHTML = '';
        deudasLista.innerHTML += '<div class="ticket-fila"><span>Deuda anterior:</span><span>$ ' + deudaAnterior.toFixed(2) + '</span></div>';
        deudasLista.innerHTML += '<div class="ticket-fila"><span>Fact. #' + ventaId + ':</span><span>$ ' + totalUSD.toFixed(2) + '</span></div>';
        document.getElementById('ticket-deuda-total').innerText = (deudaAnterior + totalUSD).toFixed(2);
    } else {
        deudasSection.style.display = 'none';
    }

    // >>> MEJORADO: BLOQUE PAGOS Y ABONOS (con doble moneda) <<<
    const pagosSection = document.getElementById('ticket-pagos-section');
    const pagosLista = document.getElementById('ticket-pagos-lista');

    let totalPagadoMostrado = 0;

    if ((pagos && pagos.length > 0) || abonosViejos.length > 0 || abonoNueva > 0 || saldoFavorNueva > 0) {
        pagosSection.style.display = 'block';
        pagosLista.innerHTML = '';

        // Metodos de pago: nombre en una linea, monto en la siguiente
        // SECUNDARIA: "200.00 BS (40.00$)" | PRINCIPAL: "40.00$"
        if (pagos && pagos.length > 0) {
            pagos.forEach(function(pago) {
                const metodo = metodosPagoCache.find(function(m) { return m.id === pago.metodo_id; });
                // Fallback para reimpresion: si el metodo ya no esta en cache,
                // se usa el nombre/moneda que trae el propio pago.
                const nombreMetodo = metodo ? metodo.nombre.toUpperCase() : String(pago.metodo_nombre || 'METODO').toUpperCase();
                const esSecundaria = metodo ? metodo.moneda_referencia === 'SECUNDARIA' : (pago.moneda === 'SECUNDARIA');

                let montoTxt;
                if (esSecundaria) {
                    const eqUSD = parseFloat(pago.monto_equivalente_principal) || 0;
                    montoTxt = parseFloat(pago.monto_pagado).toFixed(2) + ' BS (' + eqUSD.toFixed(2) + '$)';
                } else {
                    montoTxt = parseFloat(pago.monto_pagado).toFixed(2) + '$';
                }

                pagosLista.innerHTML += '<div style="font-weight: 700;">' + nombreMetodo + '</div>' +
                                        '<div class="ticket-fila"><span style="padding-left: 3mm;"></span><span>' + montoTxt + '</span></div>';
                totalPagadoMostrado += parseFloat(pago.monto_equivalente_principal) || 0;
            });
        }

        // Abonos aplicados (distribucion del backend, informativos)
        abonosViejos.forEach(function(ab) {
            const monto = parseFloat(ab.monto_aplicado) || 0;
            const nota = ab.origen === 'SALDO_A_FAVOR' ? ' (saldo a favor)' : '';
            pagosLista.innerHTML += '<div class="ticket-fila"><span>Abono Fact. #' + (ab.venta_id || 'N/A') + nota + ':</span><span>$ ' + monto.toFixed(2) + '</span></div>';
        });

        if (abonoNueva > 0) {
            pagosLista.innerHTML += '<div class="ticket-fila"><span>Abono Fact. #' + ventaId + ':</span><span>$ ' + abonoNueva.toFixed(2) + '</span></div>';
        }
        if (saldoFavorNueva > 0) {
            pagosLista.innerHTML += '<div class="ticket-fila"><span>Saldo a favor usado:</span><span>$ ' + saldoFavorNueva.toFixed(2) + '</span></div>';
            totalPagadoMostrado += saldoFavorNueva;
        }

        document.getElementById('ticket-pagos-total').innerText = totalPagadoMostrado.toFixed(2);
    } else {
        pagosSection.style.display = 'none';
    }

    // >>> VUELTO (igual logica que antes) <<<
    const vueltoSection = document.getElementById('ticket-vuelto-section');
    const vuelto = sumaPagosUSD - totalUSD;

    if (vuelto > 0.01) {
        vueltoSection.style.display = 'block';
        document.getElementById('ticket-vuelto').innerText = vuelto.toFixed(2);
        // FASE 1.5: detalle de la distribución del vuelto
        const detalleVueltoEl = document.getElementById('ticket-vuelto-detalle');
        if (detalleVueltoEl) {
            const vEntregado = parseFloat(infoCredito.vuelto_entregado_principal) || 0;
            const vEntregadoBs = parseFloat(infoCredito.vuelto_entregado_secundaria) || 0;
            const vCxc = parseFloat(infoCredito.vuelto_aplicado_cxc_principal) || 0;
            const vSaldo = parseFloat(infoCredito.vuelto_a_saldo_favor_principal) || 0;
            if (vCxc > 0.01 || vSaldo > 0.01 || vEntregadoBs > 0.01) {
                detalleVueltoEl.innerText =
                    'Entregado $' + vEntregado.toFixed(2) +
                    (vEntregadoBs > 0.01 ? ' + BS ' + vEntregadoBs.toFixed(2) : '') +
                    ' · A deudas $' + vCxc.toFixed(2) +
                    ' · Saldo favor $' + vSaldo.toFixed(2);
            } else {
                detalleVueltoEl.innerText = '';
            }
        }
    } else {
        vueltoSection.style.display = 'none';
    }

    // >>> NUEVO: PENDIENTE TOTAL destacado (numero autoritativo del server) <<<
    const pendienteSection = document.getElementById('ticket-pendiente-section');
    const pendienteLinea = document.getElementById('ticket-pendiente-linea');
    const pendienteTitulo = document.getElementById('ticket-pendiente-titulo');
    const pendienteMonto = document.getElementById('ticket-pendiente');
    const pendienteNota = document.getElementById('ticket-pendiente-nota');
    const aFavorLinea = document.getElementById('ticket-a-favor-linea');
    const deudaTotalCliente = parseFloat(infoCredito.deuda_total_cliente) || 0;
    const sobrante = parseFloat(infoCredito.sobrante_abono) || 0;

    if (tipoVenta === 'CREDITO' || deudaTotalCliente > 0.01) {
        pendienteSection.style.display = 'block';

        if (deudaTotalCliente > 0.01) {
            pendienteTitulo.innerText = 'PENDIENTE TOTAL:';
            pendienteMonto.innerText = deudaTotalCliente.toFixed(2);
            pendienteLinea.style.color = '#000';
            pendienteNota.style.display = 'block';
        } else {
            pendienteTitulo.innerText = '✓ PAGADA / AL DÍA';
            pendienteMonto.innerText = '';
            pendienteLinea.style.color = '#006600';
            pendienteNota.style.display = 'none';
        }

        if (sobrante > 0.01) {
            aFavorLinea.style.display = 'block';
            document.getElementById('ticket-a-favor').innerText = sobrante.toFixed(2);
        } else {
            aFavorLinea.style.display = 'none';
        }
    } else {
        pendienteSection.style.display = 'none';
    }

    ticket.classList.add('activo');

    setTimeout(function() {
        window.print();
        setTimeout(function() {
            ticket.classList.remove('activo');
        }, 500);
    }, 100);
}

// ==============================================================================
// 9.5 CIERRE DE CAJA — FASE 1C (arqueo informado + ticket Z + reporte en pantalla)
// ==============================================================================
let _previewCierre = null;
let _datosUltimoCierre = null;

function fmtNum(v) { return Number(v || 0).toFixed(2); }
function fmtSigned(v) {
    const n = Number(v || 0);
    return (n > 0.005 ? '+' : (n < -0.005 ? '-' : '')) + '$ ' + Math.abs(n).toFixed(2);
}
function fmtSignedBs(v) {
    const n = Number(v || 0);
    return (n > 0.005 ? '+' : (n < -0.005 ? '-' : '')) + 'BS ' + Math.abs(n).toFixed(2);
}
function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
}

// Abre el modal de cierre CON el preview del servidor (nunca a ciegas)
async function abrirModalCierreCaja() {
    try {
        const preview = await apiFetch('/caja/cierre/preview/', 'GET');
        _previewCierre = preview;
        renderizarModalCierre(preview);
        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCierreCaja'));
        modal.show();
    } catch (error) {
        alert('No se pudo calcular el cierre: ' + (error.messageForUser || error.detail || error.error || 'Revisa la consola.'));
        console.error(error);
    }
}

function renderizarModalCierre(preview) {
    const ef = preview.efectivo;
    document.getElementById('cierre-r-fondo-usd').innerText = fmtNum(ef.fondo_inicial_principal);
    document.getElementById('cierre-r-fondo-bs').innerText = fmtNum(ef.fondo_inicial_secundaria);
    document.getElementById('cierre-r-cobros-usd').innerText = fmtNum(ef.cobros_efectivo_principal);
    document.getElementById('cierre-r-cobros-bs').innerText = fmtNum(ef.cobros_efectivo_secundaria);
    document.getElementById('cierre-r-egresos-usd').innerText = fmtNum(ef.egresos_principal);
    document.getElementById('cierre-r-egresos-bs').innerText = fmtNum(ef.egresos_secundaria);
    document.getElementById('cierre-r-vueltos-usd').innerText = fmtNum(ef.vuelto_entregado_principal);
    document.getElementById('cierre-r-vueltos-bs').innerText = fmtNum(ef.vuelto_entregado_secundaria);

    // Prefill del declarado con el esperado (el cajero edita con el conteo real)
    document.getElementById('cierre-usd').value = Number(ef.esperado_principal).toFixed(2);
    document.getElementById('cierre-bs').value = Number(ef.esperado_secundaria).toFixed(2);

    // Filas por método
    const tbody = document.getElementById('cierre-por-metodo');
    tbody.innerHTML = '';
    (preview.por_metodo || []).forEach(function (m) {
        const tr = document.createElement('tr');
        const monedaTxt = m.moneda === 'SECUNDARIA' ? 'BS' : 'USD';
        if (m.es_efectivo && m.metodo_id) {
            tr.innerHTML =
                '<td>' + escHtml(m.nombre) + '</td>' +
                '<td>' + monedaTxt + '</td>' +
                '<td class="text-end">' + fmtNum(m.esperado_en_moneda) + '</td>' +
                '<td><input type="number" step="0.01" class="form-control form-control-sm" ' +
                'data-metodo-id="' + m.metodo_id + '" value="' + Number(m.esperado_en_moneda).toFixed(2) + '"></td>';
        } else if (m.es_sin_metodo) {
            tr.innerHTML =
                '<td class="text-warning">' + escHtml(m.nombre) + '</td>' +
                '<td>' + monedaTxt + '</td>' +
                '<td class="text-end">' + fmtNum(m.esperado_en_moneda) + '</td>' +
                '<td class="text-center text-muted">asignar método</td>';
        } else {
            tr.innerHTML =
                '<td>' + escHtml(m.nombre) + '</td>' +
                '<td>' + monedaTxt + '</td>' +
                '<td class="text-end">' + fmtNum(m.esperado_en_moneda) + '</td>' +
                '<td class="text-center text-muted">N/A (banco)</td>';
        }
        tbody.appendChild(tr);
    });
    // Solo se envía declaración por método si el cajero editó el valor (data-dirty)
    tbody.querySelectorAll('input[data-metodo-id]').forEach(function (inp) {
        inp.addEventListener('input', function () { inp.dataset.dirty = '1'; });
    });

    actualizarDescuadreLive();
}

function actualizarDescuadreLive() {
    const preview = _previewCierre;
    const el = document.getElementById('cierre-live-descuadre');
    if (!preview || !el) return;
    const ef = preview.efectivo;
    const usd = parseFloat(document.getElementById('cierre-usd').value) || 0;
    const bs = parseFloat(document.getElementById('cierre-bs').value) || 0;
    const difU = usd - Number(ef.esperado_principal);
    const difB = bs - Number(ef.esperado_secundaria);
    const tasa = Number(preview.tasas.tasa_cierre) || 1;
    const consolidado = difU + difB / tasa;

    el.innerHTML =
        'Descuadre USD: <b>' + fmtSigned(difU) + '</b> &nbsp;|&nbsp; ' +
        'Descuadre BS: <b>' + fmtSignedBs(difB) + '</b> &nbsp;|&nbsp; ' +
        'Consolidado: <b>' + fmtSigned(consolidado) + ' USD</b>';
    el.className = 'alert text-center mb-0 ' + (Math.abs(consolidado) > 0.01 ? 'alert-danger' : 'alert-success');
}

function imprimirCorteZ(datos) {
    const preview = datos.preview;
    const resp = datos.respuesta || {};
    const res = preview.resumen;
    const ef = preview.efectivo;
    const vueltos = preview.vueltos;
    const tasas = preview.tasas;
    const cambio = preview.diferencia_cambiaria;

    const ticketZ = document.getElementById('ticket-z-impresion');
    ticketZ.classList.remove('activo');

    document.getElementById('z-turno').innerText = preview.sesion.id;
    document.getElementById('z-fecha-cierre').innerText = new Date().toLocaleString('es-VE');
    document.getElementById('z-fecha-apertura').innerText = preview.sesion.fecha_apertura;
    document.getElementById('z-cajero').innerText = preview.sesion.cajero || '—';
    document.getElementById('z-tasas').innerText =
        fmtNum(tasas.tasa_apertura) + ' → ' + fmtNum(tasas.tasa_cierre) + ' BS/USD (' + fmtNum(tasas.variacion_pct) + '%)';

    document.getElementById('z-facturado').innerText = fmtNum(res.total_facturado_principal);
    document.getElementById('z-contado').innerText = fmtNum(res.total_contado_principal);
    document.getElementById('z-credito-emitido').innerText = fmtNum(res.total_credito_emitido_principal);
    document.getElementById('z-cobrado').innerText = fmtNum(res.total_cobrado_principal);
    document.getElementById('z-credito-generado').innerText = fmtNum(res.total_credito_generado_principal);
    document.getElementById('z-num-facturas').innerText = res.num_facturas;
    document.getElementById('z-ticket-promedio').innerText = fmtNum(res.ticket_promedio_principal);

    document.getElementById('z-abonos-total').innerText = fmtNum(res.total_abonos_cxc_principal);
    document.getElementById('z-abonos-cant').innerText = res.cantidad_abonos_cxc;

    // --- Desglose por método (esperado | declarado | dif.) ---
    const contMet = document.getElementById('z-por-metodo');
    contMet.innerHTML = '';
    (preview.por_metodo || []).forEach(function (m) {
        let decl = '—';
        let dif = '—';
        if (!m.es_efectivo) {
            decl = 'N/A';
            dif = '(banco)';
        } else if (m.metodo_id && datos.declaradoPorMetodoMap && datos.declaradoPorMetodoMap[m.metodo_id] != null) {
            decl = fmtNum(datos.declaradoPorMetodoMap[m.metodo_id]);
            dif = fmtSigned(datos.declaradoPorMetodoMap[m.metodo_id] - Number(m.esperado_en_moneda));
        }
        contMet.innerHTML += '<div class="fila-total"><span>' + escHtml(m.nombre) +
            ':</span><span>' + fmtNum(m.esperado_en_moneda) + ' | ' + decl + ' | ' + dif + '</span></div>';
    });

    // --- Caja física USD ---
    document.getElementById('z-fondo-usd').innerText = fmtNum(ef.fondo_inicial_principal);
    document.getElementById('z-cobros-usd').innerText = fmtNum(ef.cobros_efectivo_principal);
    document.getElementById('z-egresos-usd').innerText = fmtNum(ef.egresos_principal);
    document.getElementById('z-vueltos-usd').innerText = fmtNum(ef.vuelto_entregado_principal);
    document.getElementById('z-esperado-usd').innerText = fmtNum(ef.esperado_principal);
    document.getElementById('z-declarado-usd').innerText = fmtNum(datos.declaradoP);
    document.getElementById('z-descuadre-usd').innerText = fmtSigned(Number(datos.declaradoP) - Number(ef.esperado_principal));

    // --- Caja física BS ---
    document.getElementById('z-fondo-bs').innerText = fmtNum(ef.fondo_inicial_secundaria);
    document.getElementById('z-cobros-bs').innerText = fmtNum(ef.cobros_efectivo_secundaria);
    document.getElementById('z-egresos-bs').innerText = fmtNum(ef.egresos_secundaria);
    document.getElementById('z-vueltos-bs').innerText = fmtNum(ef.vuelto_entregado_secundaria);
    document.getElementById('z-esperado-bs').innerText = fmtNum(ef.esperado_secundaria);
    document.getElementById('z-declarado-bs').innerText = fmtNum(datos.declaradoS);
    document.getElementById('z-descuadre-bs').innerText = fmtSignedBs(Number(datos.declaradoS) - Number(ef.esperado_secundaria));

    // --- Egresos ---
    const contEg = document.getElementById('z-egresos-detalle');
    contEg.innerHTML = '';
    (preview.egresos.detalle || []).forEach(function (e) {
        const simbolo = e.moneda_extraida === 'SECUNDARIA' ? 'BS ' : '$ ';
        contEg.innerHTML += '<div class="fila-total"><span>' + escHtml(e.fecha) + ' ' + escHtml(e.concepto) +
            ':</span><span>-' + simbolo + fmtNum(e.monto_extraido) + '</span></div>';
    });
    if (!(preview.egresos.detalle || []).length) {
        contEg.innerHTML = '<div class="fila-total"><span>Sin egresos</span><span></span></div>';
    }
    document.getElementById('z-egresos-total').innerText =
        '$ ' + fmtNum(preview.egresos.total_principal) + ' / BS ' + fmtNum(preview.egresos.total_secundaria);

    // --- Créditos otorgados ---
    const contCr = document.getElementById('z-creditos-detalle');
    contCr.innerHTML = '';
    const creditos = (preview.creditos_generados && preview.creditos_generados.detalle) || [];
    creditos.forEach(function (c) {
        contCr.innerHTML += '<div class="fila-total"><span>Fact. #' + c.venta_id + ' ' + escHtml(c.cliente) +
            ':</span><span>$ ' + fmtNum(c.saldo) + '</span></div>';
    });
    if (!creditos.length) {
        contCr.innerHTML = '<div class="fila-total"><span>Sin créditos nuevos</span><span></span></div>';
    }
    document.getElementById('z-creditos-total').innerText = fmtNum(res.total_credito_generado_principal);

    // --- Vueltos ---
    document.getElementById('z-vuelto-entregado').innerText = fmtNum(vueltos.entregado_principal);
    document.getElementById('z-vuelto-aplicado').innerText = fmtNum(vueltos.aplicado_cxc_principal);
    document.getElementById('z-vuelto-saldo').innerText = fmtNum(vueltos.saldo_favor_principal);
    document.getElementById('z-vuelto-total').innerText = fmtNum(vueltos.total_generado_principal);

    // --- Diferencia cambiaria + estado final ---
    document.getElementById('z-impacto-cambio').innerText =
        fmtSigned(cambio.diferencia_principal) + ' USD (tasa ' + fmtNum(tasas.variacion_pct) + '%)';

    const difU = Number(datos.declaradoP) - Number(ef.esperado_principal);
    const difB = Number(datos.declaradoS) - Number(ef.esperado_secundaria);
    const consolidado = (resp.descuadre_total_principal != null)
        ? Number(resp.descuadre_total_principal)
        : difU + difB / (Number(tasas.tasa_cierre) || 1);
    document.getElementById('z-descuadre-consolidado').innerText = fmtSigned(consolidado) + ' USD';
    document.getElementById('z-estado').innerText = resp.requiere_revision ? '⚠ REQUIERE REVISIÓN' : '✓ CUADRE OK';

    ticketZ.classList.add('activo');

    setTimeout(function () {
        window.print();
        setTimeout(function () {
            ticketZ.classList.remove('activo');
        }, 500);
    }, 100);
}

function mostrarReporteCierre(datos) {
    const preview = datos.preview;
    const resp = datos.respuesta || {};
    const res = preview.resumen;
    const ef = preview.efectivo;
    const vueltos = preview.vueltos;
    const tasas = preview.tasas;
    const cambio = preview.diferencia_cambiaria;

    document.getElementById('reporte-cierre-titulo').innerText =
        'Cierre de Caja #' + (resp.cierre_id || preview.sesion.id) + ' — ' + (preview.sesion.cajero || '');

    let html = '';
    html += '<p class="text-muted mb-1">Apertura: ' + escHtml(preview.sesion.fecha_apertura) +
        ' · Tasa: ' + fmtNum(tasas.tasa_apertura) + ' → ' + fmtNum(tasas.tasa_cierre) + ' BS/USD</p>';

    if ((preview.advertencias || []).length) {
        html += '<div class="alert alert-warning py-2">' + preview.advertencias.map(escHtml).join('<br>') + '</div>';
    }

    html += '<h6 class="fw-bold mt-3">Resumen de ventas</h6>' +
        '<table class="table table-sm table-bordered"><tbody>' +
        '<tr><td>Total facturado</td><td class="text-end">$ ' + fmtNum(res.total_facturado_principal) + '</td></tr>' +
        '<tr><td>&nbsp;&nbsp;Contado</td><td class="text-end">$ ' + fmtNum(res.total_contado_principal) + '</td></tr>' +
        '<tr><td>&nbsp;&nbsp;Crédito</td><td class="text-end">$ ' + fmtNum(res.total_credito_emitido_principal) + '</td></tr>' +
        '<tr><td>Total cobrado (real)</td><td class="text-end">$ ' + fmtNum(res.total_cobrado_principal) + '</td></tr>' +
        '<tr><td>Crédito nuevo generado</td><td class="text-end">$ ' + fmtNum(res.total_credito_generado_principal) + '</td></tr>' +
        '<tr><td>Abonos a cuentas viejas</td><td class="text-end">$ ' + fmtNum(res.total_abonos_cxc_principal) + '</td></tr>' +
        '<tr><td>N° facturas / ticket promedio</td><td class="text-end">' + res.num_facturas +
        ' / $ ' + fmtNum(res.ticket_promedio_principal) + '</td></tr>' +
        '</tbody></table>';

    html += '<h6 class="fw-bold mt-3">Desglose por método</h6>' +
        '<table class="table table-sm table-bordered"><thead><tr>' +
        '<th>Método</th><th>Moneda</th><th class="text-end">Esperado</th><th class="text-end">Declarado</th><th class="text-end">Diferencia</th>' +
        '</tr></thead><tbody>';
    (preview.por_metodo || []).forEach(function (m) {
        let decl = 'N/A (banco)';
        let dif = '—';
        if (m.es_efectivo && m.metodo_id && datos.declaradoPorMetodoMap && datos.declaradoPorMetodoMap[m.metodo_id] != null) {
            decl = fmtNum(datos.declaradoPorMetodoMap[m.metodo_id]);
            dif = fmtSigned(datos.declaradoPorMetodoMap[m.metodo_id] - Number(m.esperado_en_moneda));
        }
        html += '<tr><td>' + escHtml(m.nombre) + '</td><td>' + (m.moneda === 'SECUNDARIA' ? 'BS' : 'USD') +
            '</td><td class="text-end">' + fmtNum(m.esperado_en_moneda) +
            '</td><td class="text-end">' + decl + '</td><td class="text-end">' + dif + '</td></tr>';
    });
    html += '</tbody></table>';

    const difU = Number(datos.declaradoP) - Number(ef.esperado_principal);
    const difB = Number(datos.declaradoS) - Number(ef.esperado_secundaria);
    html += '<h6 class="fw-bold mt-3">Caja física</h6>' +
        '<table class="table table-sm table-bordered"><thead><tr><th></th><th class="text-end">USD</th><th class="text-end">BS</th></tr></thead><tbody>' +
        '<tr><td>Fondo inicial</td><td class="text-end">' + fmtNum(ef.fondo_inicial_principal) + '</td><td class="text-end">' + fmtNum(ef.fondo_inicial_secundaria) + '</td></tr>' +
        '<tr><td>(+) Cobros efectivo</td><td class="text-end">' + fmtNum(ef.cobros_efectivo_principal) + '</td><td class="text-end">' + fmtNum(ef.cobros_efectivo_secundaria) + '</td></tr>' +
        '<tr><td>(−) Egresos</td><td class="text-end">' + fmtNum(ef.egresos_principal) + '</td><td class="text-end">' + fmtNum(ef.egresos_secundaria) + '</td></tr>' +
        '<tr><td>(−) Vueltos entregados</td><td class="text-end">' + fmtNum(ef.vuelto_entregado_principal) + '</td><td class="text-end">' + fmtNum(ef.vuelto_entregado_secundaria) + '</td></tr>' +
        '<tr class="table-light fw-bold"><td>= Esperado</td><td class="text-end">' + fmtNum(ef.esperado_principal) + '</td><td class="text-end">' + fmtNum(ef.esperado_secundaria) + '</td></tr>' +
        '<tr><td>= Declarado</td><td class="text-end">' + fmtNum(datos.declaradoP) + '</td><td class="text-end">' + fmtNum(datos.declaradoS) + '</td></tr>' +
        '<tr class="fw-bold"><td>= Descuadre</td><td class="text-end">' + fmtSigned(difU) + '</td><td class="text-end">' + fmtSignedBs(difB) + '</td></tr>' +
        '</tbody></table>';

    html += '<h6 class="fw-bold mt-3">Vueltos del turno</h6>' +
        '<p class="mb-1">Entregados: $ ' + fmtNum(vueltos.entregado_principal) +
        ' · Aplicados a deudas: $ ' + fmtNum(vueltos.aplicado_cxc_principal) +
        ' · Saldo a favor: $ ' + fmtNum(vueltos.saldo_favor_principal) +
        ' · <b>Total: $ ' + fmtNum(vueltos.total_generado_principal) + '</b></p>';
    html += '<p>Diferencia cambiaria estimada: <b>' + fmtSigned(cambio.diferencia_principal) +
        ' USD</b> (tasa varió ' + fmtNum(tasas.variacion_pct) + '%)</p>';

    const estado = resp.requiere_revision ? '⚠ REQUIERE REVISIÓN' : '✓ CUADRE OK';
    html += '<div class="alert ' + (resp.requiere_revision ? 'alert-danger' : 'alert-success') +
        ' fw-bold text-center mb-0">DESCUADRE CONSOLIDADO: ' + fmtSigned(resp.descuadre_total_principal) +
        ' USD — ' + estado + '</div>';

    document.getElementById('reporte-cierre-contenido').innerHTML = html;
    document.getElementById('reporte-cierre-overlay').style.display = 'block';
}

function reimprimirCorteZ() {
    if (_datosUltimoCierre) {
        imprimirCorteZ(_datosUltimoCierre);
    } else {
        alert('No hay un cierre reciente para reimprimir.');
    }
}

function finalizarCierreSesion() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem(POS_CART_KEY);
    localStorage.removeItem(POS_SESION_ID_KEY);
    window.location.href = 'index.html';
}

// ==============================================================================
// 10. APERTURA / CIERRE
// ==============================================================================
async function procesarAperturaCaja() {
    const fondoUSD = parseFloat(document.getElementById('apertura-usd').value) || 0;
    const fondoBS = parseFloat(document.getElementById('apertura-bs').value) || 0;

    const payload = {
        fondo_inicial_principal: fondoUSD.toFixed(2),
        fondo_inicial_secundaria: fondoBS.toFixed(2)
    };

    try {
        await apiFetch('/pos/caja/', 'POST', payload);
        const modalEl = document.getElementById('modalAperturaCaja');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        alert("Turno abierto exitosamente!");
        inicializarPOS();
    } catch (error) {
        const msg = String(error.error || error.detail || error.messageForUser || "");
        if (msg.indexOf("turno") !== -1 && msg.indexOf("abierto") !== -1) {
            const modalEl = document.getElementById('modalAperturaCaja');
            const modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
            inicializarPOS();
            return;
        }
        alert("Error al abrir el turno: " + (error.messageForUser || error.detail || error.error || "Revisa la conexion."));
    }
}

async function procesarCierreCaja() {
    // FASE 1C: cierre informado → POST /caja/cierre/ (snapshot inmutable)
    const declaradoUSD = parseFloat(document.getElementById('cierre-usd').value) || 0;
    const declaradoBS = parseFloat(document.getElementById('cierre-bs').value) || 0;
    const observacion = (document.getElementById('cierre-observacion')?.value || '').trim();

    if (!confirm("¿Estás seguro de cerrar la caja? Esta acción no se puede deshacer.")) return;

    // Solo se envía declaración por método de los campos que el cajero EDITÓ
    const declaradoPorMetodo = [];
    const declaradoPorMetodoMap = {};
    document.querySelectorAll('#cierre-por-metodo input[data-metodo-id][data-dirty="1"]').forEach(function (inp) {
        const monto = (parseFloat(inp.value) || 0);
        declaradoPorMetodo.push({
            metodo_id: parseInt(inp.dataset.metodoId, 10),
            declarado_en_moneda: monto.toFixed(2)
        });
        declaradoPorMetodoMap[parseInt(inp.dataset.metodoId, 10)] = monto;
    });

    try {
        const respuesta = await apiFetch('/caja/cierre/', 'POST', {
            declarado_efectivo_principal: declaradoUSD.toFixed(2),
            declarado_efectivo_secundaria: declaradoBS.toFixed(2),
            declarado_por_metodo: declaradoPorMetodo,
            observacion: observacion
        });

        const datos = {
            preview: _previewCierre,
            declaradoP: declaradoUSD,
            declaradoS: declaradoBS,
            declaradoPorMetodoMap: declaradoPorMetodoMap,
            respuesta: respuesta
        };
        _datosUltimoCierre = datos;

        // Cerrar modal, imprimir ticket Z y mostrar el reporte en pantalla
        const modalEl = document.getElementById('modalCierreCaja');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        imprimirCorteZ(datos);

        localStorage.removeItem(POS_CART_KEY);
        localStorage.removeItem(POS_SESION_ID_KEY);

        setTimeout(function () {
            mostrarReporteCierre(datos);
        }, 2200);
    } catch (error) {
        alert("Error al cerrar la caja: " + (error.messageForUser || error.detail || error.error || "Revisa la consola."));
        console.error(error);
    }
}

async function procesarCierreObligatorio() {
    const usd = document.getElementById('cierre-oblig-usd').value;
    const bs = document.getElementById('cierre-oblig-bs').value;

    try {
        await apiFetch('/pos/caja/', 'PUT', {
            reporte_cierre_principal: usd,
            reporte_cierre_secundaria: bs
        });
        alert("Caja cerrada correctamente! Recargando...");
        window.location.reload();
    } catch (error) {
        alert("Error al cerrar la caja: " + (error.messageForUser || error.detail || error.error || "Revisa la consola."));
        console.error(error);
    }
}

function cerrarSesion() {
    if (confirm("Deseas salir? Tu turno seguira abierto.")) {
        localStorage.removeItem('access_token');
        window.location.href = 'index.html';
    }
}

function cerrarSesionLocal() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = 'index.html';
}

// ==============================================================================
// 11. STORAGE Y BUSCADOR
// ==============================================================================
function guardarCarritoEnStorage() {
    if (sesionCajaId != null) {
        localStorage.setItem(POS_SESION_ID_KEY, String(sesionCajaId));
        localStorage.setItem(POS_CART_KEY, JSON.stringify(carrito));
    }
}

function restaurarCarritoSiHay() {
    const storedSesionId = localStorage.getItem(POS_SESION_ID_KEY);
    const storedCart = localStorage.getItem(POS_CART_KEY);
    if (storedSesionId !== String(sesionCajaId) || !storedCart) return;
    try {
        const parsed = JSON.parse(storedCart);
        if (Array.isArray(parsed) && parsed.length > 0) {
            carrito = parsed;
            calcularTotales();
            renderizarCarritoHTML();
        }
    } catch (e) {
        console.warn("No se pudo restaurar el carrito:", e);
    }
}

function inicializarBuscador() {
    const inputBuscador = document.getElementById('buscador-productos');
    inputBuscador.addEventListener('keyup', function(evento) {
        const textoBuscado = evento.target.value.toLowerCase().trim();

        if (evento.key === 'Enter') {
            const productoEscaneado = catalogo.find(function(item) {
                return item.producto.codigo_base.toLowerCase() === textoBuscado;
            });
            if (productoEscaneado) {
                agregarAlCarrito(productoEscaneado.id);
                evento.target.value = '';
                renderizarCatalogoHTML();
                return;
            } else {
                alert('El codigo "' + textoBuscado + '" no esta registrado.');
                evento.target.value = '';
                renderizarCatalogoHTML();
                return;
            }
        }

        if (textoBuscado === '') {
            renderizarCatalogoHTML();
        } else {
            const filtrados = catalogo.filter(function(item) {
                const nombreProd = item.producto.nombre ? item.producto.nombre.toLowerCase() : '';
                const codigoProd = item.producto.codigo_base ? item.producto.codigo_base.toLowerCase() : '';
                const nombrePres = item.nombre_presentacion ? item.nombre_presentacion.toLowerCase() : '';
                return nombreProd.includes(textoBuscado) || codigoProd.includes(textoBuscado) || nombrePres.includes(textoBuscado);
            });
            renderizarCatalogoHTML(filtrados);
        }
    });
}

// ==============================================================================
// 12. MODULO DE EGRESOS (GASTOS Y DONACIONES)
// ==============================================================================

function llenarSelectsEgresos() {
    let htmlConceptos = '<option value="">-- Seleccione un motivo --</option>';
    conceptosEgresoCache.forEach(function(c) {
        htmlConceptos += '<option value="' + c.id + '">' + c.nombre + ' (' + c.tipo + ')</option>';
    });
    document.querySelectorAll('.select-concepto-egreso').forEach(function(select) { select.innerHTML = htmlConceptos; });

    const selectProd = document.getElementById('egreso-inv-producto');
    let htmlProds = '<option value="">-- Buscar Producto --</option>';
    catalogo.forEach(function(item) {
        htmlProds += '<option value="' + item.id + '" data-costo="' + item.costo + '" data-nombre="' + item.producto.nombre + ' (' + item.nombre_presentacion + ')">' + item.producto.nombre + ' (' + item.nombre_presentacion + ')</option>';
    });
    selectProd.innerHTML = htmlProds;

    document.getElementById('buscador-egreso-inv').addEventListener('input', function(e) {
        const texto = e.target.value.toLowerCase().trim();
        const selectProd = document.getElementById('egreso-inv-producto');

        selectProd.innerHTML = '<option value="">-- Seleccione un producto --</option>';

        const filtrados = catalogo.filter(function(item) {
            const nombreStr = (item.producto.nombre + ' (' + item.nombre_presentacion + ')').toLowerCase();
            return nombreStr.includes(texto);
        });

        filtrados.forEach(function(item) {
            selectProd.innerHTML += '<option value="' + item.id + '" data-costo="' + item.costo + '" data-nombre="' + item.producto.nombre + ' (' + item.nombre_presentacion + ')">' + item.producto.nombre + ' (' + item.nombre_presentacion + ')</option>';
        });
    });
}

async function procesarEgresoCaja() {
    const conceptoId = document.getElementById('egreso-caja-concepto').value;
    const monto = parseFloat(document.getElementById('egreso-caja-monto').value);
    const moneda = document.getElementById('egreso-caja-moneda').value;
    const obs = document.getElementById('egreso-caja-obs').value.trim();

    if (!conceptoId || isNaN(monto) || monto <= 0) {
        alert("Selecciona un concepto e ingresa un monto mayor a 0."); return;
    }

    let equivalenteUSD = monto;
    if (moneda === 'SECUNDARIA') {
        equivalenteUSD = monto / tasaCambio;
    }

    const payload = {
        concepto: parseInt(conceptoId),
        monto_extraido: monto.toFixed(2),
        moneda_extraida: moneda,
        monto_equivalente_principal: equivalenteUSD.toFixed(2),
        tasa_cambio_momento: tasaCambio.toFixed(2),
        observacion: obs
    };

    try {
        await apiFetch('/egresos/caja/', 'POST', payload);
        alert("Egreso de efectivo registrado exitosamente.");
        document.getElementById('egreso-caja-monto').value = '0.00';
        document.getElementById('egreso-caja-obs').value = '';
        bootstrap.Modal.getInstance(document.getElementById('modalEgresos')).hide();
    } catch (error) {
        alert("No se pudo realizar el retiro: " + (error.detail || error[0] || error.messageForUser || "Fondos insuficientes."));
    }
}

function agregarAEgresoInv() {
    const select = document.getElementById('egreso-inv-producto');
    const id = parseInt(select.value);
    const cant = parseFloat(document.getElementById('egreso-inv-cant').value);

    const opcionSeleccionada = select.options[select.selectedIndex];
    const nombre = opcionSeleccionada ? opcionSeleccionada.getAttribute('data-nombre') : '';

    if (!id || isNaN(cant) || cant <= 0) return;

    const costoUnitario = parseFloat(opcionSeleccionada ? opcionSeleccionada.getAttribute('data-costo') : 0) || 0;

    carritoEgresoInv.push({
        presentacion_id: id,
        nombre: nombre,
        cantidad: cant,
        costo_unitario_aplicado: costoUnitario,
        subtotal_costo: cant * costoUnitario
    });

    renderizarCarritoEgreso();
}

function renderizarCarritoEgreso() {
    const tbody = document.getElementById('tabla-egreso-inv');
    tbody.innerHTML = '';
    if (carritoEgresoInv.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-muted small">Agrega productos a la lista</td></tr>';
        return;
    }

    carritoEgresoInv.forEach(function(item, index) {
        tbody.innerHTML += '' +
            '<tr>' +
                '<td class="text-start small">' + item.nombre + '</td>' +
                '<td>' + item.cantidad + '</td>' +
                '<td>$ ' + item.costo_unitario_aplicado.toFixed(2) + '</td>' +
                '<td><button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="carritoEgresoInv.splice(' + index + ', 1); renderizarCarritoEgreso()">X</button></td>' +
            '</tr>';
    });
}

async function procesarEgresoInventario() {
    const conceptoId = document.getElementById('egreso-inv-concepto').value;
    const obs = document.getElementById('egreso-inv-obs').value.trim();

    if (!conceptoId || carritoEgresoInv.length === 0) {
        alert("Selecciona un concepto y agrega al menos un producto."); return;
    }

    const payload = {
        concepto: conceptoId,
        almacen: 1,
        observacion: obs,
        detalles: carritoEgresoInv.map(function(item) {
            return {
                presentacion_id: item.presentacion_id,
                cantidad: item.cantidad.toFixed(2),
                costo_unitario_aplicado: item.costo_unitario_aplicado.toFixed(2),
                subtotal_costo: item.subtotal_costo.toFixed(2)
            };
        })
    };

    const btn = document.querySelector('#inventario-pane .btn-danger');

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = "Procesando...";
        }

        await apiFetch('/egresos/inventario/', 'POST', payload);

        // >>> NUEVO: refrescar stock en pantalla sin recargar la página <<<
        await refrescarCatalogo();

        alert("Stock descontado exitosamente por salida de inventario.");

        carritoEgresoInv = [];
        renderizarCarritoEgreso();
        document.getElementById('egreso-inv-obs').value = '';
        bootstrap.Modal.getInstance(document.getElementById('modalEgresos')).hide();

    } catch (error) {
        alert("Error: " + (error.error || error.detail || error.messageForUser || "Fallo al descontar"));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "DESCONTAR STOCK";
        }
    }
}

function ejecutarCambioPrecioItem(idPresentacion) {
    if (!puedeCambiarPrecio) {
        alert("Accion denegada: Tu rol de usuario no tiene permisos para modificar precios de venta.");
        return;
    }

    const item = carrito.find(function(i) { return i.presentacion_id === idPresentacion; });
    if (!item) return;

    const nuevoPrecioStr = prompt(
        "Modificar precio de venta unitario para:\n" + item.nombre + "\n\nPrecio de lista: $ " + item.precio_unitario.toFixed(2) + "\n\nIngrese el nuevo precio ($):", 
        item.precio_unitario.toFixed(2)
    );

    if (nuevoPrecioStr === null) return;

    let nuevoPrecio = parseFloat(nuevoPrecioStr);
    if (isNaN(nuevoPrecio) || nuevoPrecio < 0) {
        alert("El precio ingresado no es valido.");
        return;
    }

    item.precio_unitario = nuevoPrecio;
    item.subtotal = item.cantidad * item.precio_unitario;

    calcularTotales();
    renderizarCarritoHTML();
    guardarCarritoEnStorage();
}

// ==============================================================================
// MANTENIMIENTO DE SESION (KEEP-ALIVE)
// ==============================================================================
function iniciarKeepAlive() {
    if (keepAliveTimer) clearInterval(keepAliveTimer);

    keepAliveTimer = setInterval(async function() {
        try {
            if (typeof refreshAccessToken === 'function') {
                const nuevoToken = await refreshAccessToken();
                localStorage.setItem('access_token', nuevoToken);
                console.log("Token refrescado en segundo plano (Keep-Alive).");
            }
        } catch (error) {
            console.warn("Fallo el Keep-Alive. La sesion expirara pronto si no hay actividad.");
            clearInterval(keepAliveTimer);
        }
    }, 240000); 
}

// ==============================================================================
// TASA DIARIA
// ==============================================================================

async function verificarTasaDiaria() {
    try {
        const resp = await apiFetch('/config/tasa-status/', 'GET');
        tasaCambio = parseFloat(resp.tasa_cambio_actual) || 0;
        // FASE 1.5: políticas de vuelto
        configVuelto.permitir_vuelto_a_saldo_favor = resp.permitir_vuelto_a_saldo_favor !== false;
        configVuelto.permitir_vuelto_a_cxc = resp.permitir_vuelto_a_cxc !== false;
        configVuelto.vuelto_obligatorio_efectivo = resp.vuelto_obligatorio_efectivo === true;
        // FASE 1.6: configuración de tasas + BCV
        configTasa.usar_tasa_bcv = resp.usar_tasa_bcv === true;
        configTasa.mostrar_diferencia_tasa_en_pos = resp.mostrar_diferencia_tasa_en_pos !== false;
        configTasa.alertar_si_diferencia_tasa_supera = parseFloat(resp.alertar_si_diferencia_tasa_supera) || 0;
        document.getElementById('tasaDisplay').innerText = "TASA Bs " + tasaCambio.toFixed(2);
        document.getElementById('tasa-anterior-display').innerText = tasaCambio.toFixed(2);

        if (resp.requiere_actualizacion === true) {
            // FASE 1.6: renderizar bloque BCV antes de mostrar el modal
            renderizarInfoTasaBCV(resp);
            const modalTasa = new bootstrap.Modal(document.getElementById('modalActualizarTasa'));
            modalTasa.show();
            return false;
        }
        return true;
    } catch (e) {
        console.error("Error verificando tasa:", e);
        alert("No se pudo verificar la tasa del día. Intenta recargar.");
        return false;
    }
}

// ==============================================================================
// FASE 1.6 — Modal de tasa: bloque BCV, diferencia en vivo y alertas
// ==============================================================================

function renderizarInfoTasaBCV(resp) {
    const seccion = document.getElementById('bcv-seccion');
    if (!seccion) return; // por si el HTML no está desplegado todavía

    // Si usar_tasa_bcv=False, el modal se ve exactamente igual que antes
    if (!configTasa.usar_tasa_bcv) {
        seccion.style.display = 'none';
        return;
    }
    seccion.style.display = '';

    const divError = document.getElementById('bcv-error');
    const tasaDisplay = document.getElementById('bcv-tasa-display');
    const fuenteDisplay = document.getElementById('bcv-fuente-display');

    if (resp.tasa_bcv_hoy) {
        tasaBCVReferencia = {
            tasa: parseFloat(resp.tasa_bcv_hoy),
            fuente: resp.tasa_bcv_fuente || '',
            es_manual: resp.tasa_bcv_es_manual === true
        };
        tasaDisplay.innerText = parseFloat(resp.tasa_bcv_hoy).toFixed(2);
        fuenteDisplay.innerText = (resp.tasa_bcv_fuente ? 'fuente: ' + resp.tasa_bcv_fuente : '') +
            (resp.tasa_bcv_es_manual ? ' (manual)' : '');
        divError.style.display = 'none';
    } else {
        // No se pudo consultar: se permite ingreso manual (queda como tasa_bcv_es_manual)
        tasaBCVReferencia = null;
        tasaDisplay.innerText = '--';
        fuenteDisplay.innerText = '';
        divError.style.display = '';
    }

    actualizarDiferenciaTasa();
}

// Tasa BCV de referencia para comparar: la cacheada o la ingresada manual en el modal
function obtenerBCVReferenciaModal() {
    if (tasaBCVReferencia && tasaBCVReferencia.tasa > 0) return tasaBCVReferencia.tasa;
    const manual = parseFloat((document.getElementById('tasa-bcv-manual-input') || {}).value);
    return manual > 0 ? manual : null;
}

function actualizarDiferenciaTasa() {
    const divDif = document.getElementById('tasa-diferencia-display');
    const banner = document.getElementById('tasa-alerta-banner');
    if (!divDif || !banner) return;

    const bcv = obtenerBCVReferenciaModal();
    const nueva = parseFloat(document.getElementById('nueva-tasa-input').value);

    if (!configTasa.usar_tasa_bcv || !configTasa.mostrar_diferencia_tasa_en_pos || !bcv || !(nueva > 0)) {
        divDif.style.display = 'none';
        banner.style.display = 'none';
        return;
    }

    const difPct = ((nueva - bcv) / bcv) * 100;
    divDif.style.display = '';
    divDif.className = 'small mt-1 ' + (Math.abs(difPct) < 1 ? 'text-success' : Math.abs(difPct) < 3 ? 'text-warning' : 'text-danger');
    divDif.innerText = 'Diferencia con BCV: ' + (difPct >= 0 ? '+' : '') + difPct.toFixed(2) + '%';

    const umbral = configTasa.alertar_si_diferencia_tasa_supera;
    if (umbral > 0 && Math.abs(difPct) > umbral) {
        banner.style.display = '';
        banner.innerText = '⚠ Diferencia superior al ' + umbral.toFixed(2) + '% permitido';
    } else {
        banner.style.display = 'none';
    }
}

async function recargarTasaBCV() {
    const btn = document.getElementById('btn-recargar-bcv');
    if (btn) btn.disabled = true;
    try {
        const resp = await apiFetch('/config/tasa-bcv/actual/?force=1', 'GET');
        renderizarInfoTasaBCV({
            tasa_bcv_hoy: resp.tasa_bcv,
            tasa_bcv_fuente: resp.fuente,
            tasa_bcv_es_manual: false
        });
    } catch (e) {
        const divError = document.getElementById('bcv-error');
        if (divError) divError.style.display = '';
        console.warn('No se pudo actualizar la tasa BCV:', e);
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function procesarActualizacionTasa() {
    const nuevaTasa = parseFloat(document.getElementById('nueva-tasa-input').value);
    if (isNaN(nuevaTasa) || nuevaTasa <= 0) {
        alert("Ingresa una tasa válida mayor a 0.");
        return;
    }

    // FASE 1.6: payload ampliado (campos opcionales; el backend los ignora si no aplican)
    const payload = { tasa_cambio_actual: nuevaTasa.toFixed(2) };
    const motivo = (document.getElementById('tasa-motivo-input') || {}).value;
    if (motivo && motivo.trim()) payload.motivo_diferencia = motivo.trim();
    const bcvModal = obtenerBCVReferenciaModal();
    const bcvManual = parseFloat((document.getElementById('tasa-bcv-manual-input') || {}).value);
    if (configTasa.usar_tasa_bcv && bcvManual > 0) payload.tasa_bcv_manual = bcvManual.toFixed(4);

    // FASE 1.6: la alerta de diferencia se valida ANTES de guardar (si se cancela,
    // no se envía nada y el modal queda abierto para corregir la tasa).
    const umbral = configTasa.alertar_si_diferencia_tasa_supera;
    if (configTasa.usar_tasa_bcv && umbral > 0 && bcvModal && bcvModal > 0) {
        const difPct = ((nuevaTasa - bcvModal) / bcvModal) * 100;
        if (Math.abs(difPct) > umbral) {
            const ok = confirm(
                '⚠ La diferencia con la tasa BCV es de ' + difPct.toFixed(2) +
                '% (umbral: ' + umbral.toFixed(2) + '%).\n\n¿Deseas guardar la tasa de todos modos?'
            );
            if (!ok) return;
        }
    }

    try {
        const resp = await apiFetch('/config/actualizar-tasa/', 'PUT', payload);
        tasaCambio = nuevaTasa;
        document.getElementById('tasaDisplay').innerText = "TASA Bs " + tasaCambio.toFixed(2);
        if (resp && resp.bcv && resp.bcv.alerta === true) {
            console.warn('Tasa guardada con diferencia vs BCV:', resp.bcv.diferencia_pct, '%');
        }

        const modalEl = document.getElementById('modalActualizarTasa');
        const modalInst = bootstrap.Modal.getInstance(modalEl);
        if (modalInst) modalInst.hide();

        await continuarInicializacionPOS();
    } catch (e) {
        alert("Error al actualizar tasa: " + (e.detail || e.error || "Error desconocido"));
    }
}

// ==============================================================================
// BORRADORES DE FACTURA
// ==============================================================================

function abrirModalGuardarBorrador() {
    if (carrito.length === 0) {
        alert("El carrito está vacío. No hay nada que guardar.");
        return;
    }
    const totales = calcularTotales();
    document.getElementById('borrador-cliente-nombre').innerText = clienteSeleccionadoNombre;
    document.getElementById('borrador-total-usd').innerText = '$ ' + totales.total_usd;
    document.getElementById('borrador-nombre').value = '';

    const modal = new bootstrap.Modal(document.getElementById('modalGuardarBorrador'));
    modal.show();
}

async function ejecutarGuardarBorrador() {
    const nombre = document.getElementById('borrador-nombre').value.trim();
    const totales = calcularTotales();

    const payload = {
        nombre: nombre,
        carrito_json: carrito,
        cliente: clienteSeleccionadoId,
        total_principal: totales.total_usd,
        total_secundaria: totales.total_bs,
        tasa_cambio: tasaCambio.toFixed(2)
    };

    try {
        await apiFetch('/borradores/', 'POST', payload);
        alert("Borrador guardado correctamente.");

        // Limpiar carrito para atender al siguiente cliente
        carrito = [];
        calcularTotales();
        renderizarCarritoHTML();
        guardarCarritoEnStorage();

        const modalEl = document.getElementById('modalGuardarBorrador');
        const modalInst = bootstrap.Modal.getInstance(modalEl);
        if (modalInst) modalInst.hide();

        // Volver a cliente genérico
        const clienteGenerico = clientesCache.find(c => String(c.documento).toLowerCase() === 'generico');
        if (clienteGenerico) {
            seleccionarCliente(clienteGenerico.id, clienteGenerico.nombre);
        } else {
            seleccionarCliente(CLIENTE_MOSTRADOR_ID, "Cliente Generico");
        }
    } catch (e) {
        alert("Error al guardar borrador: " + (e.detail || e.error || "Error desconocido"));
    }
}

function abrirModalBorradores() {
    cargarListaBorradores();
    const bsModal = new bootstrap.Modal(document.getElementById('modalBorradores'));
    bsModal.show();
}

async function cargarListaBorradores() {
    const cont = document.getElementById('lista-borradores');
    cont.innerHTML = '<div class="list-group-item text-muted text-center">Cargando...</div>';

    try {
        const borradores = await apiFetch('/borradores/', 'GET');
        cont.innerHTML = '';

        if (borradores.length === 0) {
            cont.innerHTML = '<div class="list-group-item text-muted text-center">No hay borradores guardados</div>';
            return;
        }

        borradores.forEach(b => {
            const item = document.createElement('a');
            item.href = '#';
            item.className = 'list-group-item list-group-item-action';
            item.innerHTML = 
                '<div class="d-flex w-100 justify-content-between">' +
                    '<h6 class="mb-1 fw-bold">' + (b.nombre || 'Borrador #' + b.id) + '</h6>' +
                    '<small class="text-muted">' + new Date(b.creado_el).toLocaleString('es-VE') + '</small>' +
                '</div>' +
                '<p class="mb-1">Cliente: <b>' + b.cliente_nombre + '</b> | Total: $' + parseFloat(b.total_principal).toFixed(2) + '</p>' +
                '<small class="text-muted">Guardado por: ' + b.cajero_nombre + '</small>';
            item.onclick = (e) => {
                e.preventDefault();
                if (confirm('¿Cargar este borrador? El carrito actual se reemplazará.')) {
                    ejecutarCargarBorrador(b.id);
                }
            };
            cont.appendChild(item);
        });
    } catch (e) {
        cont.innerHTML = '<div class="list-group-item text-danger text-center">Error al cargar borradores.</div>';
        console.error(e);
    }
}

async function ejecutarCargarBorrador(id) {
    try {
        const resp = await apiFetch('/borradores/' + id + '/cargar/', 'POST');

        carrito = resp.carrito_json || [];
        if (!Array.isArray(carrito)) {
            alert("El borrador tiene datos inválidos.");
            return;
        }

        if (resp.cliente) {
            const cliente = clientesCache.find(c => c.id === resp.cliente);
            if (cliente) {
                seleccionarCliente(cliente.id, cliente.nombre);
            } else {
                clienteSeleccionadoId = resp.cliente;
                clienteSeleccionadoNombre = "Cliente #" + resp.cliente;
                const select = document.getElementById('select-cliente');
                select.innerHTML = '<option value="' + resp.cliente + '">' + clienteSeleccionadoNombre + '</option>';
                select.value = resp.cliente;
            }
        }

        if (resp.tasa_cambio) {
            tasaCambio = parseFloat(resp.tasa_cambio);
            document.getElementById('tasaDisplay').innerText = "TASA Bs " + tasaCambio.toFixed(2);
        }

        calcularTotales();
        renderizarCarritoHTML();
        guardarCarritoEnStorage();

        const modalEl = document.getElementById('modalBorradores');
        const modalInst = bootstrap.Modal.getInstance(modalEl);
        if (modalInst) modalInst.hide();

        alert("Borrador cargado correctamente.");
    } catch (e) {
        alert("Error al cargar borrador: " + (e.detail || e.error || "No encontrado"));
    }
}

// ==============================================================================
// HISTORIAL DE FACTURAS DEL TURNO ACTUAL
// ==============================================================================

function abrirModalHistorial() {
    cargarFacturasTurno();
    const modal = new bootstrap.Modal(document.getElementById('modalHistorialFacturas'));
    modal.show();
}

async function cargarFacturasTurno() {
    const cont = document.getElementById('lista-facturas-turno');
    cont.innerHTML = '<div class="list-group-item text-center text-muted">Cargando facturas...</div>';

    try {
        const facturas = await apiFetch('/pos/ventas-turno/', 'GET');
        renderizarFacturasTurno(facturas);
    } catch (e) {
        cont.innerHTML = '<div class="list-group-item text-center text-danger">Error cargando historial.</div>';
        console.error(e);
    }
}

function renderizarFacturasTurno(facturas) {
    const cont = document.getElementById('lista-facturas-turno');
    cont.innerHTML = '';

    if (!facturas || facturas.length === 0) {
        cont.innerHTML = '<div class="list-group-item text-center text-muted">No hay facturas en este turno</div>';
        return;
    }

    facturas.forEach(function(f) {
        const badgeClass = f.tipo === 'CONTADO' ? 'bg-success' : 'bg-warning text-dark';
        const item = document.createElement('a');
        item.href = '#';
        item.className = 'list-group-item list-group-item-action';
        item.innerHTML = '' +
            '<div class="d-flex w-100 justify-content-between">' +
                '<h6 class="mb-1 fw-bold">Factura #' + f.id + '</h6>' +
                '<small class="text-muted">' + f.fecha + '</small>' +
            '</div>' +
            '<div class="d-flex justify-content-between align-items-center">' +
                '<span>' + (f.cliente || 'N/A') + '</span>' +
                '<span class="badge ' + badgeClass + '">' + f.tipo + '</span>' +
            '</div>' +
            '<div class="mt-1">' +
                '<small class="text-muted">Total: $' + f.total_usd.toFixed(2) + ' | Items: ' + f.items_count + '</small>' +
            '</div>';
        item.onclick = function(e) {
            e.preventDefault();
            verDetalleFactura(f.id);
        };
        cont.appendChild(item);
    });
}

async function verDetalleFactura(id) {
    try {
        const data = await apiFetch('/ventas/' + id + '/detalle/', 'GET');
        mostrarDetalleFacturaModal(data);
    } catch (e) {
        alert("Error cargando detalle: " + (e.detail || e.error || "Desconocido"));
    }
}

function mostrarDetalleFacturaModal(data) {
    // Guardar el detalle para poder reimprimirlo en el mismo formato del ticket
    window._detalleFacturaActual = data;
    document.getElementById('detalle-factura-id').innerText = data.id;
    document.getElementById('detalle-factura-fecha').innerText = new Date(data.fecha).toLocaleString('es-VE');
    document.getElementById('detalle-factura-tipo').innerText = data.tipo;
    document.getElementById('detalle-factura-estado').innerText = data.estado;
    document.getElementById('detalle-factura-subtotal').innerText = parseFloat(data.subtotal_principal).toFixed(2);
    document.getElementById('detalle-factura-impuestos').innerText = parseFloat(data.total_impuestos_principal).toFixed(2);
    document.getElementById('detalle-factura-total').innerText = parseFloat(data.total_principal).toFixed(2);
    document.getElementById('detalle-factura-total-bs').innerText = parseFloat(data.total_secundaria).toFixed(2);
    document.getElementById('detalle-factura-tasa').innerText = parseFloat(data.tasa_cambio).toFixed(2);

    // Productos
    const tbodyProd = document.getElementById('detalle-factura-productos');
    tbodyProd.innerHTML = '';
    if (data.productos && data.productos.length > 0) {
        data.productos.forEach(function(p) {
            tbodyProd.innerHTML += '<tr>' +
                '<td>' + p.producto + '</td>' +
                '<td>' + (p.presentacion || 'N/A') + '</td>' +
                '<td class="text-center">' + parseFloat(p.cantidad).toFixed(2) + '</td>' +
                '<td class="text-end">$' + parseFloat(p.precio_unitario).toFixed(2) + '</td>' +
                '<td class="text-end">$' + parseFloat(p.subtotal).toFixed(2) + '</td>' +
            '</tr>';
        });
    } else {
        tbodyProd.innerHTML = '<tr><td colspan="5" class="text-muted text-center">Sin productos</td></tr>';
    }

    // Pagos
    const tbodyPagos = document.getElementById('detalle-factura-pagos');
    tbodyPagos.innerHTML = '';
    if (data.pagos && data.pagos.length > 0) {
        data.pagos.forEach(function(p) {
            tbodyPagos.innerHTML += '<tr>' +
                '<td>' + p.metodo + '</td>' +
                '<td class="text-end">$' + parseFloat(p.monto_usd).toFixed(2) + '</td>' +
                '<td class="text-end">' + (p.referencia || 'S/R') + '</td>' +
            '</tr>';
        });
    } else {
        tbodyPagos.innerHTML = '<tr><td colspan="3" class="text-muted text-center">Sin pagos registrados</td></tr>';
    }

    const modalLista = bootstrap.Modal.getInstance(document.getElementById('modalHistorialFacturas'));
    if (modalLista) modalLista.hide();

    const modalDetalle = new bootstrap.Modal(document.getElementById('modalDetalleFactura'));
    modalDetalle.show();
}

// ==============================================================================
// REIMPRESION DE FACTURAS (mismo formato del ticket al finalizar la venta)
// ==============================================================================

function reimprimirFactura() {
    const data = window._detalleFacturaActual;
    if (!data) {
        alert("No hay factura cargada para reimprimir.");
        return;
    }

    try {
        // Totales en el mismo formato que devuelve calcularTotales()
        const totales = {
            subtotal: (parseFloat(data.subtotal_principal) || 0).toFixed(2),
            impuestos: (parseFloat(data.total_impuestos_principal) || 0).toFixed(2),
            total_usd: (parseFloat(data.total_principal) || 0).toFixed(2),
            total_bs: (parseFloat(data.total_secundaria) || 0).toFixed(2)
        };
        const totalUSD = parseFloat(data.total_principal) || 0;
        const tasaHist = parseFloat(data.tasa_cambio) || tasaCambio || 0;

        // Productos adaptados al formato del carrito que usa generarEImprimirTicket
        const carritoFacturado = (data.productos || []).map(function(p) {
            return {
                presentacion_id: p.presentacion_id || null,
                nombre: p.producto || 'PRODUCTO',
                presentacion: p.presentacion || '',
                cantidad: parseFloat(p.cantidad) || 0,
                precio_unitario: parseFloat(p.precio_unitario) || 0,
                subtotal: parseFloat(p.subtotal) || 0
            };
        });

        // Pagos adaptados al formato del ticket. Si el backend ya trae
        // monto_pagado/moneda se usan tal cual; si solo trae monto_usd,
        // se reconstruye el monto en la moneda original con la tasa historica.
        const pagos = (data.pagos || []).map(function(p) {
            const metodoCache = p.metodo_id
                ? metodosPagoCache.find(function(m) { return m.id === parseInt(p.metodo_id); })
                : metodosPagoCache.find(function(m) { return m.nombre === p.metodo; });

            const moneda = p.moneda_referencia || p.moneda || (metodoCache ? metodoCache.moneda_referencia : 'PRINCIPAL');
            const montoUSD = parseFloat(p.monto_equivalente_principal != null ? p.monto_equivalente_principal : p.monto_usd) || 0;

            let montoPagado = (p.monto_pagado != null && p.monto_pagado !== '') ? (parseFloat(p.monto_pagado) || 0) : null;
            if (montoPagado === null) {
                montoPagado = montoUSD;
                if (moneda === 'SECUNDARIA' && tasaHist > 0) {
                    montoPagado = Math.round(montoUSD * tasaHist * 100) / 100;
                }
            }

            return {
                metodo_id: p.metodo_id ? parseInt(p.metodo_id) : (metodoCache ? metodoCache.id : null),
                metodo_nombre: p.metodo || (metodoCache ? metodoCache.nombre : 'METODO'),
                moneda: moneda,
                monto_pagado: montoPagado,
                monto_equivalente_principal: montoUSD
            };
        });

        const sumaPagosUSD = pagos.reduce(function(s, p) { return s + p.monto_equivalente_principal; }, 0);

        // Bloques de credito: si el backend trae los datos se usan tal cual;
        // si no, se estima con lo conocido (total - pagos) sin inventar cifras.
        const tipoVenta = String(data.tipo || 'CONTADO').toUpperCase();
        const infoCredito = {
            deuda_anterior: parseFloat(data.deuda_anterior) || 0,
            abonos_cxc_viejas: Array.isArray(data.abonos_cxc_viejas) ? data.abonos_cxc_viejas : [],
            abono_nueva_cxc: parseFloat(data.abono_nueva_cxc) || 0,
            saldo_favor_a_nueva: parseFloat(data.saldo_favor_a_nueva) || 0,
            sobrante_abono: parseFloat(data.sobrante_abono) || 0,
            deuda_total_cliente: parseFloat(data.deuda_total_cliente) || 0
        };
        if (tipoVenta === 'CREDITO' && !(parseFloat(data.deuda_total_cliente) > 0)) {
            if (!(infoCredito.abono_nueva_cxc > 0)) infoCredito.abono_nueva_cxc = sumaPagosUSD;
            infoCredito.deuda_total_cliente = Math.max(0, totalUSD - sumaPagosUSD);
        }

        // Textos de la factura original (cliente/cajero/fecha/tasa)
        let clienteTxt = '';
        if (typeof data.cliente === 'string') {
            clienteTxt = data.cliente;
        } else if (data.cliente && typeof data.cliente === 'object') {
            clienteTxt = data.cliente.nombre || data.cliente.nombre_completo || '';
        }
        clienteTxt = clienteTxt || data.cliente_nombre || data.cliente_nombre_completo || 'Cliente Mostrador';

        const nombreCajeroEl = document.getElementById('nombreCajero');
        const cajeroTxt = data.cajero || data.cajero_nombre || (nombreCajeroEl ? nombreCajeroEl.innerText : 'Admin');

        const fechaTxt = data.fecha ? new Date(data.fecha).toLocaleString('es-VE', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        }) : '';

        const tasaTxt = (tasaHist > 0 ? tasaHist : tasaCambio).toFixed(2);

        generarEImprimirTicket(
            data.id,
            totales,
            carritoFacturado,
            tipoVenta,
            pagos,
            infoCredito,
            { fechaTexto: fechaTxt, clienteTexto: clienteTxt, cajeroTexto: cajeroTxt, tasaTexto: tasaTxt }
        );
    } catch (e) {
        console.error("Error al reimprimir factura:", e);
        alert("No se pudo generar la reimpresion de la factura.");
    }
}

// ==============================================================================
// ARRANQUE
// ==============================================================================

// >>> NUEVO: atajo F12 para cobrar + bloqueo durante facturacion <<<
document.addEventListener('keydown', function(e) {
    if (e.key === 'F12') {
        e.preventDefault();
        if (facturandoEnCurso) return;
        const modalCobroEl = document.getElementById('modalCobro');
        if (modalCobroEl && !modalCobroEl.classList.contains('show')) {
            abrirModalCobro();
        }
    }
});

inicializarPOS();


// ═══════════════════════════════════════════════════════════════════════════
//  POS MÓVIL — módulo táctil (solo actúa por debajo de 768px)
//  Nada de esto cambia el comportamiento en PC.
// ═══════════════════════════════════════════════════════════════════════════

// ¿Cerrar el panel de productos al agregar un ítem?
// El plan original lo cerraba; para facturas con varios productos resulta más
// rápido dejarlo abierto (el total del header se actualiza igual).
const CERRAR_SIDEBAR_AL_AGREGAR = false;

var categoriaActiva = 'todos';

// ── Panel lateral (off-canvas) ──────────────────────────────────────────────
function abrirPanelProductos() {
    const sidebar = document.getElementById('sidebar-productos');
    const overlay = document.getElementById('productos-overlay');
    if (!sidebar) return;
    sidebar.classList.add('open');
    if (overlay) overlay.classList.add('open');
    setTimeout(function() {
        const input = document.getElementById('buscador-productos');
        if (input) input.focus();
    }, 300);
}

function cerrarPanelProductos() {
    const sidebar = document.getElementById('sidebar-productos');
    const overlay = document.getElementById('productos-overlay');
    if (sidebar) sidebar.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
}

function toggleProductosPanel() {
    const sidebar = document.getElementById('sidebar-productos');
    if (!sidebar) return;
    if (sidebar.classList.contains('open')) {
        cerrarPanelProductos();
    } else {
        abrirPanelProductos();
    }
}

// ── Catálogo táctil ─────────────────────────────────────────────────────────
function iconoCategoria(prod) {
    const mapa = {
        'carnes': '\uD83E\uDD69', 'carne': '\uD83E\uDD69',
        'bebidas': '\uD83E\uDD64', 'bebida': '\uD83E\uDD64',
        'lacteos': '\uD83E\uDD5B', 'lacteo': '\uD83E\uDD5B',
        'abarrotes': '\uD83C\uDF5E', 'alimentos': '\uD83C\uDF5E',
        'limpieza': '\uD83E\uDDF9', 'higiene': '\uD83E\uDDD1'
    };
    const cat = ((prod && prod.categoria_nombre) || 'general').toLowerCase();
    return mapa[cat] || '\uD83D\uDCE6';
}

function renderizarCatalogoMobile(productos, contenedor) {
    renderizarCategoriasChips();
    contenedor.innerHTML = '';

    if (!productos || productos.length === 0) {
        contenedor.innerHTML = '<div class="text-center text-muted py-5">' +
            '<i class="bi bi-search fs-1 d-block mb-2"></i>No se encontraron productos</div>';
        return;
    }

    // Agrupar presentaciones por producto base (misma lógica que el PC)
    const grupos = {};
    productos.forEach(function(pres) {
        const idProd = pres.producto.id;
        if (!grupos[idProd]) {
            grupos[idProd] = { productoBase: pres.producto, presentaciones: [] };
        }
        grupos[idProd].presentaciones.push(pres);
    });

    Object.values(grupos).forEach(function(grupo) {
        const prod = grupo.productoBase;
        const presList = grupo.presentaciones;
        const presDefault = presList[0];

        const stock = parseFloat(presDefault.stock_disponible) || 0;
        const unidad = presDefault.unidad_sigla || 'und';
        const precioUSD = parseFloat(presDefault.precio_venta_principal) || 0;
        const precioBS = (precioUSD * (tasaCambio || 0)).toFixed(2);
        const stockClase = stock <= 0 ? 'text-danger fw-bold' : (stock <= 5 ? 'text-warning' : 'text-success');

        const item = document.createElement('div');
        item.className = 'producto-tactil';
        item.innerHTML = '' +
            '<div class="prod-icono">' + iconoCategoria(prod) + '</div>' +
            '<div class="prod-info">' +
                '<div class="prod-nombre">' + escHtml(prod.nombre) + '</div>' +
                '<div class="prod-meta">' + escHtml(presDefault.nombre_presentacion) +
                    ' · <span class="' + stockClase + '">Stock: ' + stock.toFixed(2) + ' ' + unidad + '</span></div>' +
                '<div class="prod-precio">$ ' + precioUSD.toFixed(2) +
                    ' <small class="text-muted">BS ' + precioBS + '</small></div>' +
            '</div>' +
            '<button type="button" class="btn-agregar" aria-label="Agregar">+</button>';

        function alAgregar() {
            if (presList.length > 1) {
                mostrarSelectorPresentacion(presList);
                return;
            }
            agregarAlCarrito(presDefault.id);
            if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) {} }
            if (CERRAR_SIDEBAR_AL_AGREGAR) cerrarPanelProductos();
        }

        item.querySelector('.btn-agregar').addEventListener('click', function(ev) {
            ev.stopPropagation();
            alAgregar();
        });
        item.addEventListener('click', alAgregar);

        contenedor.appendChild(item);
    });
}

// ── Chips de categoría (solo móvil) ─────────────────────────────────────────
function renderizarCategoriasChips() {
    const cont = document.getElementById('categorias-chips');
    if (!cont) return;

    const cats = {};
    catalogo.forEach(function(p) {
        const nombre = (p.producto && p.producto.categoria_nombre) || 'General';
        cats[nombre] = true;
    });
    const lista = Object.keys(cats).sort();

    cont.innerHTML = '';
    const todos = document.createElement('button');
    todos.type = 'button';
    todos.className = 'chip-cat' + (categoriaActiva === 'todos' ? ' activo' : '');
    todos.innerText = 'Todos';
    todos.addEventListener('click', function() { filtrarCategoria('todos'); });
    cont.appendChild(todos);

    lista.forEach(function(cat) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip-cat' + (categoriaActiva === cat ? ' activo' : '');
        btn.innerText = cat;
        btn.addEventListener('click', function() { filtrarCategoria(cat); });
        cont.appendChild(btn);
    });
}

function filtrarCategoria(categoria) {
    categoriaActiva = categoria;

    // Respetar también el texto del buscador
    const input = document.getElementById('buscador-productos');
    const texto = input ? input.value.toLowerCase().trim() : '';
    let lista = catalogo;
    if (texto) {
        lista = catalogo.filter(function(item) {
            const nombreProd = item.producto.nombre ? item.producto.nombre.toLowerCase() : '';
            const codigoProd = item.producto.codigo_base ? item.producto.codigo_base.toLowerCase() : '';
            const nombrePres = item.nombre_presentacion ? item.nombre_presentacion.toLowerCase() : '';
            return nombreProd.includes(texto) || codigoProd.includes(texto) || nombrePres.includes(texto);
        });
    }
    renderizarCatalogoHTML(lista);
}

// ── Selector de presentaciones (bottom sheet) ───────────────────────────────
function mostrarSelectorPresentacion(presentaciones) {
    cerrarBottomSheet(true);

    const backdrop = document.createElement('div');
    backdrop.id = 'bottom-sheet-backdrop';
    backdrop.className = 'bottom-sheet-backdrop';
    backdrop.addEventListener('click', cerrarBottomSheet);

    const sheet = document.createElement('div');
    sheet.id = 'bottom-sheet-presentacion';
    sheet.className = 'bottom-sheet';

    let html = '<div class="bs-grab"></div>' +
        '<h6 class="fw-bold mb-3 px-2">Seleccionar presentación</h6>' +
        '<div class="list-group list-group-flush">';
    presentaciones.forEach(function(p) {
        const stock = parseFloat(p.stock_disponible) || 0;
        const unidad = p.unidad_sigla || 'und';
        html += '<button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center py-3" data-pres-id="' + p.id + '">' +
            '<span class="text-start">' +
                '<span class="fw-semibold d-block">' + escHtml(p.nombre_presentacion) + '</span>' +
                '<small class="' + (stock <= 0 ? 'text-danger' : 'text-muted') + '">Stock: ' + stock.toFixed(2) + ' ' + unidad + '</small>' +
            '</span>' +
            '<span class="fw-bold text-success">$ ' + (parseFloat(p.precio_venta_principal) || 0).toFixed(2) + '</span>' +
        '</button>';
    });
    html += '</div>' +
        '<button type="button" class="btn btn-outline-secondary w-100 mt-3" id="bs-cancelar">Cancelar</button>';
    sheet.innerHTML = html;

    sheet.querySelectorAll('[data-pres-id]').forEach(function(btn) {
        btn.addEventListener('click', function() {
            const idPres = parseInt(btn.getAttribute('data-pres-id'));
            agregarAlCarrito(idPres);
            if (navigator.vibrate) { try { navigator.vibrate(35); } catch (e) {} }
            cerrarBottomSheet();
            if (CERRAR_SIDEBAR_AL_AGREGAR) cerrarPanelProductos();
        });
    });
    sheet.querySelector('#bs-cancelar').addEventListener('click', cerrarBottomSheet);

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    requestAnimationFrame(function() {
        backdrop.classList.add('open');
        sheet.classList.add('open');
    });
}

function cerrarBottomSheet(inmediato) {
    const sheet = document.getElementById('bottom-sheet-presentacion');
    const backdrop = document.getElementById('bottom-sheet-backdrop');
    if (sheet) sheet.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    if (inmediato === true) {
        if (sheet) sheet.remove();
        if (backdrop) backdrop.remove();
        return;
    }
    setTimeout(function() {
        const s = document.getElementById('bottom-sheet-presentacion');
        const b = document.getElementById('bottom-sheet-backdrop');
        if (s) s.remove();
        if (b) b.remove();
    }, 280);
}

// ── Carrito táctil ──────────────────────────────────────────────────────────
function renderizarCarritoMobile(contenedor) {
    contenedor.innerHTML = '';

    if (carrito.length === 0) {
        contenedor.innerHTML = '<div class="text-center text-muted py-5">' +
            '<i class="bi bi-cart-x fs-1 d-block mb-2"></i>El carrito está vacío</div>';
        return;
    }

    carrito.forEach(function(item) {
        const div = document.createElement('div');
        div.className = 'carrito-item-mobile';
        div.innerHTML = '' +
            '<div class="item-info">' +
                '<div class="item-nombre">' + escHtml(item.nombre) + '</div>' +
                '<div class="item-precio-unit' + (puedeCambiarPrecio ? ' precio-editable' : '') + '">' +
                    '$ ' + item.precio_unitario.toFixed(2) + ' c/u' +
                    (puedeCambiarPrecio ? ' · <i class="bi bi-pencil-square"></i>' : '') +
                '</div>' +
            '</div>' +
            '<div class="cantidad-control">' +
                '<button type="button" class="btn-cant" aria-label="Restar">-</button>' +
                '<input type="number" class="input-cant" inputmode="decimal" min="0.001" step="0.001" value="' + item.cantidad + '">' +
                '<button type="button" class="btn-cant" aria-label="Sumar">+</button>' +
            '</div>' +
            '<div class="item-subtotal">$ ' + item.subtotal.toFixed(2) + '</div>' +
            '<button type="button" class="btn-eliminar" aria-label="Quitar"><i class="bi bi-trash"></i></button>';

        const botones = div.querySelectorAll('.btn-cant');
        botones[0].addEventListener('click', function() { quitarDelCarrito(item.presentacion_id); });
        botones[1].addEventListener('click', function() { agregarAlCarrito(item.presentacion_id); });

        const input = div.querySelector('.input-cant');
        input.addEventListener('click', function() { this.select(); });
        input.addEventListener('change', function() {
            actualizarCantidadManual(item.presentacion_id, this.value);
        });

        div.querySelector('.btn-eliminar').addEventListener('click', function() {
            eliminarFila(item.presentacion_id);
        });

        const precioEl = div.querySelector('.item-precio-unit');
        if (puedeCambiarPrecio) {
            precioEl.addEventListener('click', function() {
                ejecutarCambioPrecioItem(item.presentacion_id);
            });
        }

        contenedor.appendChild(div);
    });
}

// ── Altura real (barra de direcciones dinámica de Android) ──────────────────
function ajustarAlturaPOS() {
    const nav = document.querySelector('#erp-navbar nav');
    const headerMovil = document.getElementById('header-movil');
    const altoNav = nav ? nav.offsetHeight : 56;
    const altoHeader = (headerMovil && headerMovil.offsetParent !== null) ? headerMovil.offsetHeight : 0;
    document.documentElement.style.setProperty('--pos-navbar-h', altoNav + 'px');
    document.documentElement.style.setProperty('--pos-header-movil-h', altoHeader + 'px');
}

// ── Init del módulo móvil ───────────────────────────────────────────────────
(function initPosMovil() {
    // El teclado virtual no debe abrirse solo al cargar (el sidebar arranca cerrado)
    if (esVistaMovilPOS()) {
        const input = document.getElementById('buscador-productos');
        if (input && document.activeElement === input) input.blur();
    }

    ajustarAlturaPOS();
    window.addEventListener('load', ajustarAlturaPOS);

    // Cambiar entre vista PC y vista móvil al rotar / redimensionar
    var vistaMovilActual = esVistaMovilPOS();
    var resizeTimer = null;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            ajustarAlturaPOS();
            const movil = esVistaMovilPOS();
            if (movil !== vistaMovilActual) {
                vistaMovilActual = movil;
                if (!movil) cerrarPanelProductos();
                renderizarCatalogoHTML();
                renderizarCarritoHTML();
            }
        }, 200);
    });

    // Android puede matar la pestaña del POS por falta de RAM: refuerzo del
    // guardado del carrito cada 5 segundos (además del guardado por acción).
    setInterval(function() {
        if (typeof carrito !== 'undefined' && carrito.length > 0) {
            guardarCarritoEnStorage();
        }
    }, 5000);
})();
