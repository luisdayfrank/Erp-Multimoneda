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
let carritoEgresoInv = []; // El mini-carrito para donaciones/consumo
let puedeCambiarPrecio = false;

const POS_CART_KEY = 'pos_cart';
const POS_SESION_ID_KEY = 'pos_sesion_id';
const CLIENTE_MOSTRADOR_ID = 1;
const ALMACEN_PRINCIPAL_ID = 1;

// ==============================================================================
// 2. INICIALIZACIÓN
// ==============================================================================
// ==============================================================================
// 2. INICIALIZACIÓN
// ==============================================================================
async function inicializarPOS() {
    // >>> NUEVA BARRERA DE SEGURIDAD: Expulsar inmediatamente si no hay token <<<
    if (!localStorage.getItem('access_token')) {
        alert("No has iniciado sesión. Serás redirigido al login.");
        window.location.href = 'index.html';
        return; // Detenemos la ejecución aquí mismo
    }

    try {
        // 1. PRIMERO cargamos los datos base (Clientes, Métodos, Conceptos)
        await cargarDatosIniciales();

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
            
            console.log(`??? Permiso de cambio de precio activo: ${puedeCambiarPrecio}`);
            document.getElementById('nombreCajero').innerText = sesion.cajero || 'Admin';
            iniciarKeepAlive();

        } catch (cajaError) {
            // >>> 1. IMPRIMIMOS EL ERROR REAL EN CONSOLA PARA SABER QUÉ LÍNEA FALLÓ <<<
            console.error("? ERROR REAL DETECTADO DENTRO DEL BLOQUE DE CAJA:", cajaError);
            
            // Si es un error de ejecución de JavaScript (ej. una función no existe o el DOM falló),
            // detenemos el flujo para que no abra el modal de apertura por error.
            if (cajaError instanceof TypeError || cajaError instanceof ReferenceError) {
                alert("Error de código en el POS: " + cajaError.message + ". Revisa la consola.");
                return;
            }

            const msg = String(cajaError?.messageForUser || cajaError?.detail || cajaError?.error || cajaError?.mensaje || '');
            
            const tokenProblem =
                cajaError?.code === 'token_not_valid' ||
                msg.toLowerCase().includes('token') ||
                msg.toLowerCase().includes('sesión') ||
                msg.toLowerCase().includes('sesion') ||
                msg.toLowerCase().includes('expired') ||
                msg.toLowerCase().includes('authentication') || 
                msg.toLowerCase().includes('credentials');

            if (tokenProblem) {
                alert(msg || 'Tu sesión expiró o es inválida. Inicia sesión nuevamente.');
                window.location.href = 'index.html';
                return;
            }

            // Ahora el modal SOLO se abrirá si realmente la API respondió con un error de "Caja no encontrada"
            console.warn("No se encontró caja abierta. Solicitando apertura...");
            const modalApertura = new bootstrap.Modal(document.getElementById('modalAperturaCaja'));
            modalApertura.show();
            return;
        }
        
        // 2. LUEGO buscamos al cliente
        const clienteGenerico = clientesCache.find(c => String(c.documento).toLowerCase() === 'generico');
        if (clienteGenerico) {
            seleccionarCliente(clienteGenerico.id, clienteGenerico.nombre);
            console.log(`? Cliente por defecto asignado: ${clienteGenerico.nombre} (ID: ${clienteGenerico.id})`);
        } else {
            console.warn("?? No se encontró un cliente con documento 'generico'. Usando ID fallback.");
            seleccionarCliente(CLIENTE_MOSTRADOR_ID, "Cliente Generico");
        }

        // 3. FINALMENTE cargamos el catálogo y la tasa
        const respuestaCatalogo = await apiFetch('/pos/catalogo/', 'GET');
        catalogo = Array.isArray(respuestaCatalogo) ? respuestaCatalogo : (respuestaCatalogo.results || []);

        tasaCambio = parseFloat(sesion.tasa_cambio_actual) || 0;
        console.log("Tasa cargada:", tasaCambio.toFixed(2));
        document.getElementById('tasaDisplay').innerText = "TASA Bs " + tasaCambio.toFixed(2);

        renderizarCatalogoHTML();
        restaurarCarritoSiHay();
        inicializarBuscador();
        inicializarModalClientes();

    } catch (error) {
        console.error("Error crítico al iniciar el POS:", error);
        alert("Error crítico al iniciar el sistema. Revisa la consola.");
    }
}
// ==============================================================================
// 3. DATOS INICIALES (Clientes + Métodos de Pago)
// ==============================================================================
async function cargarDatosIniciales() {
    try {
        // >>> CORREGIDO: sin /api/v1/ <<<
        const resp = await apiFetch('/pos/datos-iniciales/', 'GET');
        clientesCache = resp.clientes || [];
        metodosPagoCache = resp.metodos_pago || [];
        console.log("Datos iniciales cargados. Clientes:", clientesCache.length, "Métodos:", metodosPagoCache.length);
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
        const item = document.createElement('a');
        item.href = '#';
        item.className = 'list-group-item list-group-item-action cliente-item';
        item.innerHTML = `<div class="d-flex w-100 justify-content-between"><h6 class="mb-1 fw-bold">${c.nombre}</h6><small class="text-muted">${doc}</small></div>`;
        item.onclick = (e) => { e.preventDefault(); seleccionarCliente(c.id, c.nombre); };
        cont.appendChild(item);
    });
}

function seleccionarCliente(id, nombre) {
    clienteSeleccionadoId = id;
    clienteSeleccionadoNombre = nombre;
    const select = document.getElementById('select-cliente');
    select.innerHTML = `<option value="${id}">${nombre}</option>`;
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
        // >>> CORREGIDO: sin /api/v1/ <<<
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
        alert(`Cliente "${nombre}" guardado. Búscalo en la lista y selecciónalo.`);
    } catch (e) {
        alert("Error al guardar cliente: " + (e.messageForUser || e.detail || e.error || "Error desconocido"));
    }
}

// ==============================================================================
// 5. CARRITO
// ==============================================================================
function agregarAlCarrito(idPresentacion) {
    if (!sessionCajaAbierta) { alert("Abre la caja primero."); return; }

    const itemCatalogo = catalogo.find(p => p.id === idPresentacion);
    if (!itemCatalogo) return;

    const itemEnCarrito = carrito.find(item => item.presentacion_id === idPresentacion);

    if (itemEnCarrito) {
        itemEnCarrito.cantidad += 1;
        itemEnCarrito.subtotal = itemEnCarrito.cantidad * itemEnCarrito.precio_unitario;
    } else {
        const precio = parseFloat(itemCatalogo.precio_venta_principal);
        const impuesto = parseFloat(itemCatalogo.producto.impuesto_porcentaje);
        carrito.push({
            presentacion_id: itemCatalogo.id,
            nombre: `${itemCatalogo.producto.nombre} (${itemCatalogo.nombre_presentacion})`,
            cantidad: 1,
            precio_unitario: precio,
            impuesto_porcentaje: impuesto,
            subtotal: precio
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
    if (confirm("¿Estás seguro de cancelar esta factura?")) {
        carrito = [];
        calcularTotales();
        renderizarCarritoHTML();
        guardarCarritoEnStorage();
    }
}

// ==============================================================================
// 6. MATEMÁTICAS
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
    document.getElementById('ui-subtotal').innerText = `$ ${totales.subtotal}`;
    document.getElementById('ui-impuestos').innerText = `$ ${totales.impuestos}`;
    document.getElementById('ui-total-usd').innerText = `$ ${totales.total_usd}`;
    document.getElementById('ui-total-bs').innerText = `BS ${totales.total_bs}`;
}

// ==============================================================================
// 7. COBRO Y FACTURACIÓN
// ==============================================================================
function abrirModalCobro() {
    if (carrito.length === 0) { alert("El carrito está vacío"); return; }
    const totales = calcularTotales();
    document.getElementById('cobro-total-usd').innerText = '$ ' + totales.total_usd;
    document.getElementById('cobro-total-bs').innerText = 'BS ' + totales.total_bs;

    document.getElementById('contenedor-pagos').innerHTML = '';
    agregarLineaPago();

    document.getElementById('btn-contado').checked = true;
    evaluarEstadoPago();

    const modal = new bootstrap.Modal(document.getElementById('modalCobro'));
    modal.show();
}

function agregarLineaPago() {
    const cont = document.getElementById('contenedor-pagos');
    const idx = Date.now() + Math.random().toString(36).substr(2, 5);

    let optionsHTML = '<option value="">-- Seleccione --</option>';
    metodosPagoCache.forEach(m => {
        optionsHTML += `<option value="${m.id}" data-moneda="${m.moneda_referencia}">${m.nombre}</option>`;
    });

    const div = document.createElement('div');
    div.className = 'row g-2 mb-2 align-items-center linea-pago-fila';
    div.id = `linea-pago-${idx}`;
    div.innerHTML = `
        <div class="col-5">
            <select class="form-select form-select-sm metodo-pago-select" onchange="alCambiarMetodoPago(this)">
                ${optionsHTML}
            </select>
        </div>
        <div class="col-5">
            <input type="number" class="form-control form-control-sm monto-pago-input" placeholder="Monto" step="0.01" value="" onclick="this.select()" oninput="evaluarEstadoPago()">
        </div>
        <div class="col-2">
            <button class="btn btn-sm btn-outline-danger w-100" onclick="this.closest('.linea-pago-fila').remove(); evaluarEstadoPago();">X</button>
        </div>
    `;
    cont.appendChild(div);
    
    evaluarEstadoPago();
}

// === NUEVA FUNCIÓN: AUTO-COMPLETA SEGÚN LA MONEDA SELECCIONADA ===
function agregarLineaPago() {
    const cont = document.getElementById('contenedor-pagos');
    const idx = Date.now() + Math.random().toString(36).substr(2, 5);

    let optionsHTML = '<option value="">-- Seleccione --</option>';
    metodosPagoCache.forEach(m => {
        optionsHTML += `<option value="${m.id}" data-moneda="${m.moneda_referencia}">${m.nombre}</option>`;
    });

    const div = document.createElement('div');
    div.className = 'row g-2 mb-2 align-items-center linea-pago-fila';
    div.id = `linea-pago-${idx}`;
    div.innerHTML = `
        <div class="col-5">
            <select class="form-select form-select-sm metodo-pago-select" data-prev-moneda="" onchange="alCambiarMetodoPago(this)">
                ${optionsHTML}
            </select>
        </div>
        <div class="col-5">
            <input type="number" class="form-control form-control-sm monto-pago-input" placeholder="Monto" step="0.01" value="" onclick="this.select()" oninput="evaluarEstadoPago()">
        </div>
        <div class="col-2">
            <button class="btn btn-sm btn-outline-danger w-100" onclick="this.closest('.linea-pago-fila').remove(); evaluarEstadoPago();">X</button>
        </div>
    `;
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

    // CASO 1: El campo está vacío o es cero -> Sugerimos el faltante completo en la moneda del método
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
        // CASO 2: Ya había un monto escrito y el cajero CAMBIÓ el método de pago a otra moneda
        // Convertimos el número actual automáticamente aplicando la tasa
        let nuevoValor = valorActual;

        if (monedaPrevia === 'PRINCIPAL' && nuevaMoneda === 'SECUNDARIA') {
            // De Dólares a Bolívares -> Multiplicamos por la tasa
            nuevoValor = valorActual * tasaCambio;
            console.log(`?? Conversión POS: $${valorActual} USD convertido a Bs ${nuevoValor.toFixed(2)}`);
        } else if (monedaPrevia === 'SECUNDARIA' && nuevaMoneda === 'PRINCIPAL') {
            // De Bolívares a Dólares -> Dividimos entre la tasa
            if (tasaCambio > 0) {
                nuevoValor = valorActual / tasaCambio;
                console.log(`?? Conversión POS: Bs ${valorActual} convertido a $${nuevoValor.toFixed(2)} USD`);
            }
        }
        
        inputMonto.value = nuevoValor.toFixed(2);
    }

    // Registramos la moneda actual para que sirva de referencia en el próximo cambio
    selectElement.setAttribute('data-prev-moneda', nuevaMoneda);

    evaluarEstadoPago();
}
function evaluarEstadoPago() {
    const totales = calcularTotales();
    const totalUSD = parseFloat(totales.total_usd);
    const tipoVenta = document.querySelector('input[name="tipoVenta"]:checked').value;

    let sumaUSD = 0;
    const filas = document.querySelectorAll('.linea-pago-fila');

    filas.forEach(fila => {
        const select = fila.querySelector('.metodo-pago-select');
        const opcion = select.options[select.selectedIndex];
        // Prevenir errores si el select está en "-- Seleccione --"
        const moneda = opcion ? (opcion.getAttribute('data-moneda') || 'PRINCIPAL') : 'PRINCIPAL';
        const monto = parseFloat(fila.querySelector('.monto-pago-input').value) || 0;

        if (moneda === 'SECUNDARIA') {
            if (tasaCambio > 0) sumaUSD += monto / tasaCambio;
        } else {
            sumaUSD += monto;
        }
    });

    const restante = totalUSD - sumaUSD;
    const restanteEl = document.getElementById('cobro-restante-usd');
    const btnFacturar = document.getElementById('btn-procesar-factura');

    if (tipoVenta === 'CREDITO') {
        // --- LÓGICA DE CRÉDITO ---
        if (restante < -0.01) {
            // Si intenta abonar más de lo que cuesta la factura, lo bloqueamos
            restanteEl.innerText = '¡ABONO SUPERA DEUDA!';
            restanteEl.className = 'text-danger fw-bold mb-0';
            btnFacturar.disabled = true;
        } else {
            // Muestra lo que quedará pendiente en el módulo de Cuentas por Cobrar
            restanteEl.innerText = `$ ${restante.toFixed(2)} (PENDIENTE)`;
            restanteEl.className = 'text-info fw-bold mb-0';
            btnFacturar.disabled = false;
        }
    } else {
        // --- LÓGICA DE CONTADO ---
        if (restante > 0.01) {
            // Falta dinero
            restanteEl.innerText = '$ ' + restante.toFixed(2);
            restanteEl.className = 'text-warning fw-bold mb-0';
            btnFacturar.disabled = true;
        } else if (restante < -0.01) {
            // VUELTO (Pagó de más)
            restanteEl.innerText = 'VUELTO: $ ' + Math.abs(restante).toFixed(2);
            restanteEl.className = 'text-success fw-bold mb-0';
            btnFacturar.disabled = false;
        } else {
            // Pago exacto
            restanteEl.innerText = '$ 0.00';
            restanteEl.className = 'text-success fw-bold mb-0';
            btnFacturar.disabled = false;
        }
    }

    // Seguridad extra: Si es contado, el total es mayor a cero y no han puesto dinero, bloquear.
    if (tipoVenta === 'CONTADO' && totalUSD > 0 && sumaUSD <= 0) {
        btnFacturar.disabled = true;
    }
}

async function ejecutarFacturacionFinal() {
    const tipoVenta = document.querySelector('input[name="tipoVenta"]:checked').value;
    await procesarFactura(tipoVenta);

    const modalEl = document.getElementById('modalCobro');
    const modalInst = bootstrap.Modal.getInstance(modalEl);
    if (modalInst) modalInst.hide();
}

async function procesarFactura(tipoPago = 'CONTADO') {
    if (carrito.length === 0) { alert("El carrito está vacío"); return; }
    const totales = calcularTotales();

    const pagos = [];
    document.querySelectorAll('.linea-pago-fila').forEach(fila => {
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
        detalles: carrito.map(item => ({
            presentacion_id: item.presentacion_id,
            cantidad_presentacion: item.cantidad.toFixed(2),
            precio_unitario_aplicado: item.precio_unitario.toFixed(2),
            porcentaje_impuesto_aplicado: item.impuesto_porcentaje.toFixed(2),
            subtotal: item.subtotal.toFixed(2)
        })),
        pagos: pagos
    };

    try {
        const respuesta = await apiFetch('/pos/facturar/', 'POST', payload);
        generarEImprimirTicket(respuesta.venta_id, totales, [...carrito]);

        alert(`¡Venta Procesada! Factura #${respuesta.venta_id}`);

        // RESET DEL POS
        carrito = [];
        calcularTotales();
        renderizarCarritoHTML();
        guardarCarritoEnStorage();
        
        // >>> CORRECCIÓN: Restablecer al cliente genérico real de la BD automáticamente
        const clienteGenerico = clientesCache.find(c => String(c.documento).toLowerCase() === 'generico');
        if (clienteGenerico) {
            seleccionarCliente(clienteGenerico.id, clienteGenerico.nombre);
        } else {
            seleccionarCliente(CLIENTE_MOSTRADOR_ID, "Cliente Generico");
        }
    } catch (error) {
        // EXTRAEMOS EL MENSAJE REAL DEL BACKEND
        let mensajeDeError = "Error desconocido al procesar la venta.";
        
        if (error.error) {
            // Captura los ValueError del backend (Ej: "Stock insuficiente...")
            mensajeDeError = error.error; 
        } else if (error.messageForUser) {
            // Captura los errores de la función apiFetch
            mensajeDeError = error.messageForUser;
        } else if (error.detail) {
            // Captura errores de permisos o de DRF
            mensajeDeError = error.detail;
        }

        // Mostramos el error real al cajero
        alert("? No se pudo completar la venta:\n\n" + mensajeDeError);
        console.error("Detalle técnico del error:", error);
    }
}

// ==============================================================================
// 8. VISUALES
// ==============================================================================
function renderizarCatalogoHTML(productosAMostrar = catalogo) {
    const contenedor = document.getElementById('gridProductos');
    contenedor.innerHTML = '';

    if (productosAMostrar.length === 0) {
        contenedor.innerHTML = '<div class="col-12 text-center text-muted mt-5"><h4>No se encontraron productos</h4></div>';
        return;
    }

    const productosAgrupados = {};
    productosAMostrar.forEach(presentacion => {
        const idProd = presentacion.producto.id;
        if (!productosAgrupados[idProd]) {
            productosAgrupados[idProd] = { productoBase: presentacion.producto, presentaciones: [] };
        }
        productosAgrupados[idProd].presentaciones.push(presentacion);
    });

    Object.values(productosAgrupados).forEach(grupo => {
        const prod = grupo.productoBase;
        const presentaciones = grupo.presentaciones;

        let optionsHTML = '';
        presentaciones.forEach((pres) => {
            const precioBs = (pres.precio_venta_principal * tasaCambio).toFixed(2);
            optionsHTML += `<option value="${pres.id}" data-precio="${pres.precio_venta_principal}" data-bs="${precioBs}">${pres.nombre_presentacion}</option>`;
        });

        const idSelect = `select-pres-${prod.id}`;
        const idPrecioUi = `precio-ui-${prod.id}`;
        const idPrecioBsUi = `precio-bs-ui-${prod.id}`;

        const precioInicialUSD = presentaciones[0].precio_venta_principal;
        const precioInicialBS = (precioInicialUSD * tasaCambio).toFixed(2);

        const tarjeta = `
            <div class="col-12 col-sm-6 col-lg-4 mb-3">
                <div class="card h-100 shadow-sm border-primary" style="transition: transform 0.2s;">
                    <div class="card-body d-flex flex-column text-center">
                        <h6 class="card-title fw-bold text-truncate" title="${prod.nombre}">${prod.nombre}</h6>
                        <div class="mt-auto">
                            <h4 class="text-primary fw-bold mb-0" id="${idPrecioUi}">$ ${precioInicialUSD}</h4>
                            <small class="text-muted d-block mb-3" id="${idPrecioBsUi}">BS ${precioInicialBS}</small>
                            <select class="form-select form-select-sm mb-3 border-secondary" id="${idSelect}" onchange="actualizarPrecioTarjeta('${idSelect}', '${idPrecioUi}', '${idPrecioBsUi}')">
                                ${optionsHTML}
                            </select>
                            <button class="btn btn-success w-100 fw-bold shadow-sm" onclick="agregarDesdeTarjeta('${idSelect}')">? Agregar</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        contenedor.innerHTML += tarjeta;
    });
}

function actualizarPrecioTarjeta(idSelect, idPrecioUi, idPrecioBsUi) {
    const select = document.getElementById(idSelect);
    const opcion = select.options[select.selectedIndex];
    document.getElementById(idPrecioUi).innerText = '$ ' + opcion.getAttribute('data-precio');
    document.getElementById(idPrecioBsUi).innerText = 'BS ' + opcion.getAttribute('data-bs');
}

function agregarDesdeTarjeta(idSelect) {
    const select = document.getElementById(idSelect);
    agregarAlCarrito(parseInt(select.value));
}

function renderizarCarritoHTML() {
    const tbody = document.getElementById('tablaCarrito');
    tbody.innerHTML = '';
    if (carrito.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-muted py-5 text-center"><i class="bi bi-cart-x fs-1 d-block mb-2"></i>El carrito está vacío</td></tr>';
        return;
    }
    carrito.forEach(item => {
        const fila = document.createElement('tr');
        fila.innerHTML = `
            <td class="text-start align-middle"><div class="text-truncate" style="max-width: 140px;" title="${item.nombre}">${item.nombre}</div></td>
            <td class="align-middle">
                <div class="d-flex justify-content-center align-items-center">
                    <button class="btn btn-sm btn-outline-secondary px-2 py-0" onclick="quitarDelCarrito(${item.presentacion_id})">-</button>
                    
                    <input type="number" class="form-control form-control-sm text-center mx-1 fw-bold" 
                           style="width: 80px;" value="${item.cantidad}" min="0.001" step="0.001"
                           onclick="this.select()" 
                           onchange="actualizarCantidadManual(${item.presentacion_id}, this.value)">
                    
                    <button class="btn btn-sm btn-outline-secondary px-2 py-0" onclick="agregarAlCarrito(${item.presentacion_id})">+</button>
                </div>
            </td>
            <td class="align-middle ${puedeCambiarPrecio ? 'text-primary text-decoration-underline' : ''}" 
                    style="${puedeCambiarPrecio ? 'cursor: pointer;' : ''}"
                    title="${puedeCambiarPrecio ? 'Doble clic para cambiar precio' : 'Precio fijo'}"
                    ondblclick="ejecutarCambioPrecioItem(${item.presentacion_id})">
                    $ ${item.precio_unitario.toFixed(2)}
                </td>
            <td class="align-middle fw-bold">$ ${item.subtotal.toFixed(2)}</td>
            <td class="align-middle"><button class="btn btn-sm btn-danger px-2 py-0" onclick="eliminarFila(${item.presentacion_id})">X</button></td>
        `;
        tbody.appendChild(fila);
    });
}

function actualizarCantidadManual(idPresentacion, valor) {
    let nuevaCantidad = parseFloat(valor);
    if (isNaN(nuevaCantidad) || nuevaCantidad <= 0) {
        alert("Por favor, ingresa una cantidad o peso válido mayor a cero.");
        renderizarCarritoHTML();
        return;
    }

    const item = carrito.find(i => i.presentacion_id === idPresentacion);
    if (item) {
        item.cantidad = nuevaCantidad;
        item.subtotal = item.cantidad * item.precio_unitario;
        calcularTotales();
        renderizarCarritoHTML();
        guardarCarritoEnStorage();
    }
}

// ==============================================================================
// 9. TICKETS
// ==============================================================================
function generarEImprimirTicket(ventaId, totales, carritoFacturado) {
    document.getElementById('ticket-id').innerText = ventaId;
    document.getElementById('ticket-fecha').innerText = new Date().toLocaleString();
    document.getElementById('ticket-tasa').innerText = tasaCambio.toFixed(2);
    document.getElementById('ticket-cajero').innerText = document.getElementById('nombreCajero').innerText;

    const tbody = document.getElementById('ticket-items');
    tbody.innerHTML = '';
    carritoFacturado.forEach(item => {
        tbody.innerHTML += `
            <tr>
                <td style="vertical-align: top;">${item.cantidad}</td>
                <td style="vertical-align: top;">${item.nombre}<br><small>$${item.precio_unitario.toFixed(2)} c/u</small></td>
                <td style="vertical-align: top; text-align: right;">$${item.subtotal.toFixed(2)}</td>
            </tr>`;
    });

    document.getElementById('ticket-subtotal').innerText = totales.subtotal;
    document.getElementById('ticket-iva').innerText = totales.impuestos;
    document.getElementById('ticket-total-usd').innerText = totales.total_usd;
    document.getElementById('ticket-total-bs').innerText = totales.total_bs;

    window.print();
}

function imprimirCorteZ(datosCaja) {
    document.getElementById('z-fecha-cierre').innerText = new Date(datosCaja.fecha_cierre).toLocaleString();
    document.getElementById('z-cajero').innerText = document.getElementById('nombreCajero').innerText;
    document.getElementById('z-fondo').innerText = parseFloat(datosCaja.fondo_inicial_principal).toFixed(2);
    document.getElementById('z-ventas').innerText = parseFloat(datosCaja.total_ventas_principal).toFixed(2);

    // ACTUALIZAR EL ESPERADO:
    // 1. Calculamos los gastos (NUEVO)
    const gastos = parseFloat(datosCaja.total_egresos_caja_principal || 0);
    document.getElementById('z-gastos').innerText = gastos.toFixed(2);

    // 2. Calculamos el ESPERADO UNA SOLA VEZ restando los gastos
    const esperado = parseFloat(datosCaja.fondo_inicial_principal) + parseFloat(datosCaja.total_ventas_principal) - gastos;
    document.getElementById('z-esperado').innerText = esperado.toFixed(2);

    document.getElementById('z-declarado-usd').innerText = parseFloat(datosCaja.reporte_cierre_principal).toFixed(2);
    document.getElementById('z-declarado-bs').innerText = parseFloat(datosCaja.reporte_cierre_secundaria).toFixed(2);

    const descuadre = parseFloat(datosCaja.descuadre_principal);
    const spanDescuadre = document.getElementById('z-descuadre');

    if (descuadre < 0) spanDescuadre.innerText = `FALTANTE $ ${Math.abs(descuadre).toFixed(2)}`;
    else if (descuadre > 0) spanDescuadre.innerText = `SOBRANTE $ ${descuadre.toFixed(2)}`;
    else spanDescuadre.innerText = `CUADRE PERFECTO`;

    const style = document.createElement('style');
    style.innerHTML = `
        @media print {
            #ticket-impresion { display: none !important; }
            #ticket-z-impresion { display: block !important; position: absolute; left: 0; top: 0; width: 80mm; padding: 5px; font-family: monospace; }
        }
    `;
    document.head.appendChild(style);
    window.print();
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
        // >>> CORREGIDO: sin /api/v1/ <<<
        await apiFetch('/pos/caja/', 'POST', payload);
        const modalEl = document.getElementById('modalAperturaCaja');
        const modalInstance = bootstrap.Modal.getInstance(modalEl);
        if (modalInstance) modalInstance.hide();

        alert("¡Turno abierto exitosamente!");
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
        alert("Error al abrir el turno: " + (error.messageForUser || error.detail || error.error || "Revisa la conexión."));
    }
}

async function procesarCierreCaja() {
    const declaradoUSD = parseFloat(document.getElementById('cierre-usd').value) || 0;
    const declaradoBS = parseFloat(document.getElementById('cierre-bs').value) || 0;

    if (confirm("¿Estás seguro de cerrar la caja? Esta acción no se puede deshacer.")) {
        try {
            const payload = {
                reporte_cierre_principal: declaradoUSD.toFixed(2),
                reporte_cierre_secundaria: declaradoBS.toFixed(2)
            };
            // >>> CORREGIDO: sin /api/v1/ <<<
            const respuesta = await apiFetch('/pos/caja/', 'PUT', payload);
            imprimirCorteZ(respuesta);

            localStorage.removeItem('access_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem(POS_CART_KEY);
            localStorage.removeItem(POS_SESION_ID_KEY);

            setTimeout(() => {
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
        // >>> CORREGIDO: sin /api/v1/ <<<
        await apiFetch('/pos/caja/', 'PUT', {
            reporte_cierre_principal: usd,
            reporte_cierre_secundaria: bs
        });
        alert("¡Caja cerrada correctamente! Recargando...");
        window.location.reload();
    } catch (error) {
        alert("Error al cerrar la caja: " + (error.messageForUser || error.detail || error.error || "Revisa la consola."));
        console.error(error);
    }
}

function cerrarSesion() {
    if (confirm("¿Deseas salir? Tu turno seguirá abierto.")) {
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
            const productoEscaneado = catalogo.find(
                item => item.producto.codigo_base.toLowerCase() === textoBuscado
            );
            if (productoEscaneado) {
                agregarAlCarrito(productoEscaneado.id);
                evento.target.value = '';
                renderizarCatalogoHTML();
                return;
            } else {
                alert(`El código "${textoBuscado}" no está registrado.`);
                evento.target.value = '';
                renderizarCatalogoHTML();
                return;
            }
        }

        if (textoBuscado === '') {
            renderizarCatalogoHTML();
        } else {
            const filtrados = catalogo.filter(item => {
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
// 12. MÓDULO DE EGRESOS (GASTOS Y DONACIONES)
// ==============================================================================

function llenarSelectsEgresos() {
    // 1. Llenar los conceptos
    let htmlConceptos = '<option value="">-- Seleccione un motivo --</option>';
    conceptosEgresoCache.forEach(c => {
        htmlConceptos += `<option value="${c.id}">${c.nombre} (${c.tipo})</option>`;
    });
    document.querySelectorAll('.select-concepto-egreso').forEach(select => select.innerHTML = htmlConceptos);

    // 2. Llenar los productos en el select de inventario
    const selectProd = document.getElementById('egreso-inv-producto');
    let htmlProds = '<option value="">-- Buscar Producto --</option>';
    catalogo.forEach(item => {
        // >>> data-costo AGREGADO <<<
        htmlProds += `<option value="${item.id}" data-costo="${item.costo}" data-nombre="${item.producto.nombre} (${item.nombre_presentacion})">${item.producto.nombre} (${item.nombre_presentacion})</option>`;
    });
    selectProd.innerHTML = htmlProds;
    
    document.getElementById('buscador-egreso-inv').addEventListener('input', function(e) {
        const texto = e.target.value.toLowerCase().trim();
        const selectProd = document.getElementById('egreso-inv-producto');
        
        selectProd.innerHTML = '<option value="">-- Seleccione un producto --</option>';
        
        const filtrados = catalogo.filter(item => {
            const nombreStr = `${item.producto.nombre} (${item.nombre_presentacion})`.toLowerCase();
            return nombreStr.includes(texto);
        });

        filtrados.forEach(item => {
            // >>> data-costo AGREGADO TAMBIÉN EN EL FILTRADO <<<
            selectProd.innerHTML += `<option value="${item.id}" data-costo="${item.costo}" data-nombre="${item.producto.nombre} (${item.nombre_presentacion})">${item.producto.nombre} (${item.nombre_presentacion})</option>`;
        });
    });
}

// --- TAB 1: CAJA ---
// En assets/js/pos.js
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
        // Al estar corregido el backend, ahora sí entrará aquí como un JSON de error limpio (status 400)
        alert("No se pudo realizar el retiro: " + (error.detail || error[0] || error.messageForUser || "Fondos insuficientes."));
    }
}

// --- TAB 2: INVENTARIO ---
function agregarAEgresoInv() {
    const select = document.getElementById('egreso-inv-producto');
    const id = parseInt(select.value);
    const cant = parseFloat(document.getElementById('egreso-inv-cant').value);
    
    // Capturamos la opción exacta que se seleccionó
    const opcionSeleccionada = select.options[select.selectedIndex];
    const nombre = opcionSeleccionada?.getAttribute('data-nombre');

    if (!id || isNaN(cant) || cant <= 0) return;

    // >>> EXTRAEMOS EL COSTO REAL DEL DATASET <<<
    const costoUnitario = parseFloat(opcionSeleccionada?.getAttribute('data-costo')) || 0;
    
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

    carritoEgresoInv.forEach((item, index) => {
        tbody.innerHTML += `
            <tr>
                <td class="text-start small">${item.nombre}</td>
                <td>${item.cantidad}</td>
                <td>$ ${item.costo_unitario_aplicado.toFixed(2)}</td>
                <td><button class="btn btn-sm btn-outline-danger py-0 px-2" onclick="carritoEgresoInv.splice(${index}, 1); renderizarCarritoEgreso()">X</button></td>
            </tr>
        `;
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
        almacen: 1, // Almacén principal
        observacion: obs,
        detalles: carritoEgresoInv.map(item => ({
            presentacion_id: item.presentacion_id,
            cantidad: item.cantidad.toFixed(2),
            costo_unitario_aplicado: item.costo_unitario_aplicado.toFixed(2),
            subtotal_costo: item.subtotal_costo.toFixed(2)
        }))
    };

    // SOLUCIÓN: Buscamos el botón directamente en el DOM en lugar de usar event.target
    const btn = document.querySelector('#inventario-pane .btn-danger');

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = "Procesando...";
        }

        await apiFetch('/egresos/inventario/', 'POST', payload);
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
        alert("?? Acción denegada: Tu rol de usuario no tiene permisos para modificar precios de venta.");
        return;
    }

    const item = carrito.find(i => i.presentacion_id === idPresentacion);
    if (!item) return;

    // Abrimos un prompt de captura rápido y limpio para el operador
    const nuevoPrecioStr = prompt(
        `Modificar precio de venta unitario para:\n${item.nombre}\n\nPrecio de lista: $ ${item.precio_unitario.toFixed(2)}\n\nIngrese el nuevo precio ($):`, 
        item.precio_unitario.toFixed(2)
    );

    // Si el usuario cancela el prompt, salimos limpiamente
    if (nuevoPrecioStr === null) return;

    let nuevoPrecio = parseFloat(nuevoPrecioStr);
    if (isNaN(nuevoPrecio) || nuevoPrecio < 0) {
        alert("El precio ingresado no es válido.");
        return;
    }

    // Impactamos la fila del carrito en memoria y recalculamos
    item.precio_unitario = nuevoPrecio;
    item.subtotal = item.cantidad * item.precio_unitario;
    
    calcularTotales();
    renderizarCarritoHTML();
    guardarCarritoEnStorage();
}

// ==============================================================================
// MANTENIMIENTO DE SESIÓN (KEEP-ALIVE)
// ==============================================================================
function iniciarKeepAlive() {
    // Si ya hay un temporizador corriendo, lo limpiamos para no duplicar
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    
    // Cada 4 minutos (240000 milisegundos) renovamos el token silenciosamente
    keepAliveTimer = setInterval(async () => {
        try {
            // refreshAccessToken está definida en tu api.js
            if (typeof refreshAccessToken === 'function') {
                const nuevoToken = await refreshAccessToken();
                localStorage.setItem('access_token', nuevoToken);
                console.log("?? Token refrescado en segundo plano (Keep-Alive).");
            }
        } catch (error) {
            console.warn("?? Falló el Keep-Alive. La sesión expirará pronto si no hay actividad.");
            clearInterval(keepAliveTimer);
        }
    }, 240000); 
}

// ==============================================================================
// ARRANQUE
// ==============================================================================
inicializarPOS();