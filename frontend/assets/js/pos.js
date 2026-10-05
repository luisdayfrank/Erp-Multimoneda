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

// Función para cargar configuración (agregar después de cargarDatosIniciales)
async function cargarConfiguracionStock() {
    try {
        const config = await apiFetch('/config/tasa-status/', 'GET');
        permitirStockNegativo = config.permitir_stock_negativo || false;
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
    div.className = 'row g-2 mb-2 align-items-center linea-pago-fila';
    div.id = 'linea-pago-' + idx;
    div.innerHTML = '' +
        '<div class="col-5">' +
            '<select class="form-select form-select-sm metodo-pago-select" data-prev-moneda="" onchange="alCambiarMetodoPago(this)">' +
                optionsHTML +
            '</select>' +
        '</div>' +
        '<div class="col-5">' +
            '<input type="number" class="form-control form-control-sm monto-pago-input" placeholder="Monto" step="0.01" value="" onclick="this.select()" oninput="evaluarEstadoPago()">' +
        '</div>' +
        '<div class="col-2">' +
            '<button class="btn btn-sm btn-outline-danger w-100" onclick="this.closest(\'.linea-pago-fila\').remove(); evaluarEstadoPago();">X</button>' +
        '</div>';
    cont.appendChild(div);

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
    const btnFacturar = document.getElementById('btn-procesar-factura');

    window._datosPago = { pagos: pagosDetalle, totalPagadoUSD: sumaUSD, restante: restante, tipoVenta: tipoVenta };

    if (tipoVenta === 'CREDITO') {
        if (restante < -0.01) {
            // Sobrante: el backend lo guardará como saldo a favor
            restanteEl.innerText = 'SOBRANTE: $ ' + Math.abs(restante).toFixed(2) + ' (a favor)';
            restanteEl.className = 'text-success fw-bold mb-0';
            btnFacturar.disabled = false;
        } else {
            restanteEl.innerText = '$ ' + restante.toFixed(2) + ' (PENDIENTE)';
            restanteEl.className = 'text-info fw-bold mb-0';
            btnFacturar.disabled = false;
        }
    } else {
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

    // >>> NUEVO: nunca reactivar el boton mientras una facturacion este en curso <<<
    if (facturandoEnCurso || (tipoVenta === 'CONTADO' && totalUSD > 0 && sumaUSD <= 0)) {
        btnFacturar.disabled = true;
    }
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
        pagos: pagos
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
                deuda_total_cliente: respuesta.deuda_total_cliente || 0
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
function renderizarCatalogoHTML(productosAMostrar) {
    if (productosAMostrar === undefined) productosAMostrar = catalogo;
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
// >>> NUEVO: funcion central que SOLO pinta el ticket (sin imprimir) <<<
// La usan tanto la facturacion en vivo como la reimpresion desde el historial
function pintarTicket(ventaId, totales, carritoFacturado, tipoVenta, pagos, infoCredito, nombreCliente) {
    infoCredito = infoCredito || {};
    const ticket = document.getElementById('ticket-impresion');

    ticket.classList.remove('activo');

    document.getElementById('ticket-id').innerText = ventaId;
    document.getElementById('ticket-fecha').innerText = new Date().toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    document.getElementById('ticket-cajero').innerText = document.getElementById('nombreCajero').innerText;
    // >>> FIX: nombre del cliente pasado por parametro (en reimpresion no es
    //     el cliente seleccionado actual) <<<
    document.getElementById('ticket-cliente').innerText = nombreCliente || 'Cliente Mostrador';
    document.getElementById('ticket-tipo-venta').innerText = tipoVenta;

    const totalUSD = parseFloat(totales.total_usd);

    // >>> PRODUCTOS: 2 lineas por producto <<<
    const tbody = document.getElementById('ticket-items');
    tbody.innerHTML = '';
    carritoFacturado.forEach(function(item, idx) {
        const catItem = catalogo.find(function(c) { return c.id === item.presentacion_id; });
        let nombreProd = catItem ? catItem.producto.nombre : item.nombre;
        // >>> FIX: fallback al nombre guardado en el item (reimpresion) <<<
        if (!nombreProd && item.nombre) nombreProd = String(item.nombre).split(' (')[0];
        let unidad = '';
        if (catItem) {
            unidad = String(catItem.unidad_sigla || '').toUpperCase().trim();
        }
        if (!unidad && catItem) {
            unidad = abreviarUnidad(catItem.nombre_presentacion);
        }
        if (nombreProd.length > 24) nombreProd = nombreProd.substring(0, 23) + '…';

        const cantTxt = parseFloat(item.cantidad).toFixed(2) + (unidad ? ' ' + unidad : '');
        const precioTxt = '$' + parseFloat(item.precio_unitario).toFixed(2) + (unidad ? '/' + unidad : '');

        const row1 = document.createElement('tr');
        if (idx > 0) row1.className = 'sep';
        row1.innerHTML = '<td colspan="3" class="cant-precio">' + cantTxt + ' X ' + precioTxt + '</td>';
        tbody.appendChild(row1);

        const row2 = document.createElement('tr');
        row2.innerHTML = '<td colspan="2" style="word-break: break-word;">' + nombreProd + '</td>' +
                         '<td class="der" style="font-weight: 700;">$' + parseFloat(item.subtotal).toFixed(2) + '</td>';
        tbody.appendChild(row2);
    });

    // Totales
    document.getElementById('ticket-subtotal').innerText = totales.subtotal;
    document.getElementById('ticket-iva').innerText = totales.impuestos;
    document.getElementById('ticket-total-usd').innerText = totales.total_usd;
    document.getElementById('ticket-total-bs').innerText = totales.total_bs;
    document.getElementById('ticket-tasa').innerText = tasaCambio.toFixed(2);

    const abonosViejos = infoCredito.abonos_cxc_viejas || [];
    const abonoNueva = parseFloat(infoCredito.abono_nueva_cxc) || 0;
    const saldoFavorNueva = parseFloat(infoCredito.saldo_favor_a_nueva) || 0;
    const deudaAnterior = parseFloat(infoCredito.deuda_anterior) || 0;

    let sumaPagosUSD = 0;
    if (pagos && pagos.length > 0) {
        pagos.forEach(function(pago) {
            sumaPagosUSD += parseFloat(pago.monto_equivalente_principal) || 0;
        });
    }

    // >>> BLOQUE DEUDAS (solo CREDITO) <<<
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

    // >>> BLOQUE PAGOS Y ABONOS <<<
    const pagosSection = document.getElementById('ticket-pagos-section');
    const pagosLista = document.getElementById('ticket-pagos-lista');

    let totalPagadoMostrado = 0;

    if ((pagos && pagos.length > 0) || abonosViejos.length > 0 || abonoNueva > 0 || saldoFavorNueva > 0) {
        pagosSection.style.display = 'block';
        pagosLista.innerHTML = '';

        if (pagos && pagos.length > 0) {
            pagos.forEach(function(pago) {
                // >>> FIX: si no hay metodo_id (reimpresion), usa metodo_nombre <<<
                let metodo = null;
                if (pago.metodo_id) {
                    metodo = metodosPagoCache.find(function(m) { return m.id === pago.metodo_id; });
                }
                if (!metodo && pago.metodo_nombre) {
                    metodo = { nombre: pago.metodo_nombre, moneda_referencia: 'PRINCIPAL' };
                }
                const nombreMetodo = (metodo ? metodo.nombre : 'METODO').toUpperCase();
                const esSecundaria = metodo && metodo.moneda_referencia === 'SECUNDARIA';

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

    // >>> VUELTO <<<
    const vueltoSection = document.getElementById('ticket-vuelto-section');
    const vuelto = sumaPagosUSD - totalUSD;

    if (vuelto > 0.01) {
        vueltoSection.style.display = 'block';
        document.getElementById('ticket-vuelto').innerText = vuelto.toFixed(2);
    } else {
        vueltoSection.style.display = 'none';
    }

    // >>> PENDIENTE TOTAL <<<
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
}

// Igual que antes, pero delega el pintado en pintarTicket()
function generarEImprimirTicket(ventaId, totales, carritoFacturado, tipoVenta, pagos, infoCredito) {
    pintarTicket(data.id, totales, carritoFacturado, data.tipo, pagos, infoCredito, data.cliente || 'Cliente Mostrador');

        // >>> NUEVO: reimpresion simplificada — solo datos de la venta.
        //     Se ocultan los bloques de deuda y pendiente (el estado actual
        //     del cliente puede haber cambiado desde que se hizo la venta) <<<
    document.getElementById('ticket-deudas-section').style.display = 'none';
    document.getElementById('ticket-pendiente-section').style.display = 'none';

    const ticket = document.getElementById('ticket-impresion');
    ticket.classList.add('activo');

    setTimeout(function() {
        window.print();
        setTimeout(function() {
            ticket.classList.remove('activo');
        }, 500);
    }, 100);
}

// >>> NUEVO: reimprimir una factura desde el historial del turno <<<
async function reimprimirFactura(id) {
    try {
        const data = await apiFetch('/ventas/' + id + '/detalle/', 'GET');

        // Cerrar el modal de detalle: si queda abierto, Bootstrap lo oculta con
        // display:none tras el fade, pero el foco/backdrop puede interferir con el dialogo de impresion
        const modalDetalle = bootstrap.Modal.getInstance(document.getElementById('modalDetalleFactura'));
        if (modalDetalle) modalDetalle.hide();

        // 1) Totales en el formato que espera pintarTicket
        const totales = {
            subtotal: parseFloat(data.subtotal_principal).toFixed(2),
            impuestos: parseFloat(data.total_impuestos_principal).toFixed(2),
            total_usd: parseFloat(data.total_principal).toFixed(2),
            total_bs: parseFloat(data.total_secundaria).toFixed(2)
        };

        // 2) Productos -> formato de item del carrito
        const carritoFacturado = (data.productos || []).map(function(p) {
            return {
                presentacion_id: p.presentacion_id || 0, // si el detalle no lo trae, pintarTicket usa p.nombre
                nombre: p.producto,
                cantidad: parseFloat(p.cantidad),
                precio_unitario: parseFloat(p.precio_unitario),
                subtotal: parseFloat(p.subtotal)
            };
        });

        // 3) Pagos -> formato que espera pintarTicket (monetario en USD;
        //    en reimpresion no se recupera el monto original en BS)
        const pagos = (data.pagos || []).map(function(p) {
            const montoUSD = parseFloat(p.monto_usd) || 0;
            return {
                metodo_id: null,
                metodo_nombre: p.metodo || 'PAGO',
                monto_pagado: montoUSD.toFixed(2),
                monto_equivalente_principal: montoUSD.toFixed(2)
            };
        });

        // 4) Info credito: si el backend no la devuelve, quedan en 0 y el
        //    ticket mostrara "PAGADA / AL DIA" (no inventa deudas)
        const infoCredito = {
            deuda_anterior: parseFloat(data.deuda_anterior) || 0,
            abonos_cxc_viejas: data.abonos_cxc_viejas || [],
            abono_nueva_cxc: parseFloat(data.abono_nueva_cxc) || 0,
            saldo_favor_a_nueva: parseFloat(data.saldo_favor_a_nueva) || 0,
            saldo_restante_cxc: parseFloat(data.saldo_restante_cxc) || 0,
            sobrante_abono: parseFloat(data.sobrante_abono) || 0,
            deuda_total_cliente: parseFloat(data.deuda_total_cliente) || 0
        };

        // 5) Tasa historica de la factura (para que TOTAL BS y linea "Tasa:" coincidan con la venta original)
        if (data.tasa_cambio && parseFloat(data.tasa_cambio) > 0) {
            tasaCambio = parseFloat(data.tasa_cambio);
        }

        pintarTicket(data.id, totales, carritoFacturado, data.tipo, pagos, infoCredito, data.cliente || 'Cliente Mostrador');

        const ticket = document.getElementById('ticket-impresion');
        ticket.classList.add('activo');

        setTimeout(function() {
            window.print();
            setTimeout(function() {
                ticket.classList.remove('activo');
            }, 500);
        }, 100);

    } catch (e) {
        alert('No se pudo reimprimir la factura: ' + (e.detail || e.error || 'Error desconocido'));
        console.error(e);
    }
}
function imprimirCorteZ(datosCaja) {
    const ticketZ = document.getElementById('ticket-z-impresion');

    ticketZ.classList.remove('activo');

    document.getElementById('z-fecha-cierre').innerText = new Date(datosCaja.fecha_cierre).toLocaleString('es-VE');
    document.getElementById('z-cajero').innerText = document.getElementById('nombreCajero').innerText;
    document.getElementById('z-fondo').innerText = parseFloat(datosCaja.fondo_inicial_principal).toFixed(2);
    document.getElementById('z-ventas').innerText = parseFloat(datosCaja.total_ventas_principal).toFixed(2);

    const gastos = parseFloat(datosCaja.total_egresos_caja_principal || 0);
    document.getElementById('z-gastos').innerText = gastos.toFixed(2);

    const esperado = parseFloat(datosCaja.fondo_inicial_principal) + parseFloat(datosCaja.total_ventas_principal) - gastos;
    document.getElementById('z-esperado').innerText = esperado.toFixed(2);

    document.getElementById('z-declarado-usd').innerText = parseFloat(datosCaja.reporte_cierre_principal).toFixed(2);
    document.getElementById('z-declarado-bs').innerText = parseFloat(datosCaja.reporte_cierre_secundaria).toFixed(2);

    const descuadre = parseFloat(datosCaja.descuadre_principal);
    const spanDescuadre = document.getElementById('z-descuadre');

    if (descuadre < 0) spanDescuadre.innerText = 'FALTANTE $ ' + Math.abs(descuadre).toFixed(2);
    else if (descuadre > 0) spanDescuadre.innerText = 'SOBRANTE $ ' + descuadre.toFixed(2);
    else spanDescuadre.innerText = 'CUADRE PERFECTO';

    ticketZ.classList.add('activo');

    setTimeout(function() {
        window.print();
        setTimeout(function() {
            ticketZ.classList.remove('activo');
        }, 500);
    }, 100);
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
    const declaradoUSD = parseFloat(document.getElementById('cierre-usd').value) || 0;
    const declaradoBS = parseFloat(document.getElementById('cierre-bs').value) || 0;

    if (confirm("Estas seguro de cerrar la caja? Esta accion no se puede deshacer.")) {
        try {
            const payload = {
                reporte_cierre_principal: declaradoUSD.toFixed(2),
                reporte_cierre_secundaria: declaradoBS.toFixed(2)
            };
            const respuesta = await apiFetch('/pos/caja/', 'PUT', payload);
            imprimirCorteZ(respuesta);

            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem(POS_CART_KEY);
            localStorage.removeItem(POS_SESION_ID_KEY);

            setTimeout(function() {
                alert("Turno cerrado exitosamente.");
                window.location.href = 'index.html';
            }, 2000);
        } catch (error) {
            alert("Error al cerrar la caja.");
            console.error(error);
        }
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
        document.getElementById('tasaDisplay').innerText = "TASA Bs " + tasaCambio.toFixed(2);
        document.getElementById('tasa-anterior-display').innerText = tasaCambio.toFixed(2);

        if (resp.requiere_actualizacion === true) {
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

async function procesarActualizacionTasa() {
    const nuevaTasa = parseFloat(document.getElementById('nueva-tasa-input').value);
    if (isNaN(nuevaTasa) || nuevaTasa <= 0) {
        alert("Ingresa una tasa válida mayor a 0.");
        return;
    }

    try {
        await apiFetch('/config/actualizar-tasa/', 'PUT', { tasa_cambio_actual: nuevaTasa.toFixed(2) });
        tasaCambio = nuevaTasa;
        document.getElementById('tasaDisplay').innerText = "TASA Bs " + tasaCambio.toFixed(2);

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
