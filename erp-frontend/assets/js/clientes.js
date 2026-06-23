// assets/js/clientes.js

let clientesData = [];
let datosFichaActual = null; 
let metodosPagoCache = [];
let tasaCambioActual = 0;
let ordenActual = { columna: 'nombre', ascendente: true };
let vistaOrigenDetalle = 'facturas';

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
    cargarClientes();
    cargarMetodosPagoYConfig();

    // Buscador
    document.getElementById('buscador-clientes').addEventListener('input', (e) => {
        aplicarFiltrosYOrden();
    });
});

// ==============================================================================
// CARGA DE DATOS INICIALES (Métodos de pago + Tasa)
// ==============================================================================
async function cargarMetodosPagoYConfig() {
    try {
        const resp = await apiFetch('/pos/datos-iniciales/', 'GET');
        metodosPagoCache = resp.metodos_pago || [];
        console.log("Métodos de pago cargados:", metodosPagoCache.length);
    } catch (e) {
        console.warn("No se pudieron cargar métodos de pago:", e);
        metodosPagoCache = [];
    }

    try {
        const config = await apiFetch('/pos/caja/', 'GET');
        tasaCambioActual = parseFloat(config.tasa_cambio_actual) || 0;
    } catch (e) {
        console.warn("No se pudo cargar tasa desde caja, usando 1.00");
        tasaCambioActual = 1.00;
    }
}

// ==============================================================================
// CLIENTES - LISTADO
// ==============================================================================
async function cargarClientes() {
    try {
        clientesData = await apiFetch('/clientes/', 'GET');
        aplicarFiltrosYOrden();
    } catch (error) {
        console.error("Error al cargar clientes:", error);
    }
}

// ==============================================================================
// ORDENAMIENTO
// ==============================================================================
function ordenarTabla(columna, thElement) {
    if (ordenActual.columna === columna) {
        ordenActual.ascendente = !ordenActual.ascendente;
    } else {
        ordenActual.columna = columna;
        ordenActual.ascendente = true;
    }

    document.querySelectorAll('.sortable-header').forEach(th => th.classList.remove('active'));
    thElement.classList.add('active');

    const icon = thElement.querySelector('.sort-icon');
    icon.className = ordenActual.ascendente ? 'bi bi-arrow-up sort-icon' : 'bi bi-arrow-down sort-icon';

    clientesData.sort((a, b) => {
        let valA = a[columna] || '';
        let valB = b[columna] || '';

        if (columna === 'deuda_total' || columna === 'limite_credito') {
            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;
        } else {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
        }

        if (valA < valB) return ordenActual.ascendente ? -1 : 1;
        if (valA > valB) return ordenActual.ascendente ? 1 : -1;
        return 0;
    });

    aplicarFiltrosYOrden();
}

function aplicarFiltrosYOrden() {
    const busqueda = document.getElementById('buscador-clientes').value.toLowerCase().trim();
    const filtrados = clientesData.filter(c => 
        (c.nombre || '').toLowerCase().includes(busqueda) || 
        (c.documento || '').toLowerCase().includes(busqueda)
    );
    renderizarTabla(filtrados);
}

function renderizarTabla(lista) {
    const tbody = document.getElementById('tabla-clientes');
    tbody.innerHTML = '';

    if (lista.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-muted py-4">No se encontraron clientes</td></tr>';
        return;
    }

    lista.forEach(c => {
        const deuda = parseFloat(c.deuda_total || 0);
        const saldoFavor = parseFloat(c.saldo_a_favor || 0);

        let htmlDeuda = `<span class="text-muted">$ 0.00</span>`;
        if (deuda > 0) {
            htmlDeuda = `<span class="fw-bold text-danger">$ ${deuda.toFixed(2)}</span>`;
        }
        if (saldoFavor > 0) {
            htmlDeuda += `<br><small class="text-success">+Saldo: $${saldoFavor.toFixed(2)}</small>`;
        }

        const fila = `
            <tr>
                <td class="text-start ps-4 fw-bold text-dark">${c.nombre}</td>
                <td>${c.documento || 'S/D'}</td>
                <td>${c.telefono || '-'}</td>
                <td>${htmlDeuda}</td>
                <td>${formatLimite(c.limite_credito)}</td>
                <td>
                    <button class="btn btn-sm btn-primary shadow-sm" onclick="verFichaCliente(${c.id})">
                        <i class="bi bi-person-vcard"></i> Ficha
                    </button>
                </td>
            </tr>
        `;
        tbody.innerHTML += fila;
    });
}

function formatLimite(valor) {
    const v = parseFloat(valor);
    if (v === -1) return '<span class="badge bg-danger">Bloqueado</span>';
    if (v === 0) return '<span class="badge bg-info text-dark">Ilimitado</span>';
    return `<span class="badge bg-success">$ ${v.toFixed(2)}</span>`;
}

// ==============================================================================
// CREACIÓN Y EDICIÓN DE CLIENTES
// ==============================================================================
function editarClienteDesdeFicha() {
    if(!datosFichaActual) return;
    const c = datosFichaActual.cliente;

    document.getElementById('form-cliente-id').value = c.id;
    document.getElementById('form-cliente-nombre').value = c.nombre;
    document.getElementById('form-cliente-doc').value = c.documento;
    document.getElementById('form-cliente-tlf').value = c.telefono;
    document.getElementById('form-cliente-limite').value = c.limite_credito;

    document.getElementById('modalClienteTitulo').innerHTML = '<i class="bi bi-pencil-square me-2"></i>Editar Cliente';

    bootstrap.Modal.getInstance(document.getElementById('modalEstadoCuenta')).hide();
    new bootstrap.Modal(document.getElementById('modalClienteForm')).show();
}

document.getElementById('modalClienteForm').addEventListener('show.bs.modal', function (event) {
    if (event.relatedTarget) { 
        document.getElementById('form-cliente-id').value = '';
        document.getElementById('form-cliente-nombre').value = '';
        document.getElementById('form-cliente-doc').value = '';
        document.getElementById('form-cliente-tlf').value = '';
        document.getElementById('form-cliente-limite').value = '0.00';
        document.getElementById('modalClienteTitulo').innerHTML = '<i class="bi bi-person-plus-fill me-2"></i>Nuevo Cliente';
    }
});

async function guardarCliente() {
    const id = document.getElementById('form-cliente-id').value;
    const payload = {
        nombre: document.getElementById('form-cliente-nombre').value.trim(),
        documento: document.getElementById('form-cliente-doc').value.trim(),
        telefono: document.getElementById('form-cliente-tlf').value.trim(),
        limite_credito: document.getElementById('form-cliente-limite').value || "0.00"
    };

    if (!payload.nombre) { alert("El nombre es obligatorio"); return; }

    try {
        if (id) {
            await apiFetch(`/clientes/${id}/editar/`, 'PUT', payload);
            alert("Cliente actualizado correctamente.");
        } else {
            await apiFetch('/clientes/', 'POST', payload);
            alert("Cliente registrado correctamente.");
        }

        bootstrap.Modal.getInstance(document.getElementById('modalClienteForm')).hide();
        cargarClientes(); 
        if (id && datosFichaActual) verFichaCliente(id); 

    } catch (error) {
        alert("Error al guardar: " + (error.detail || error.messageForUser || "Revisa la consola."));
    }
}

// ==============================================================================
// FICHA DE CLIENTE - NAVEGACIÓN ENTRE VISTAS
// ==============================================================================
function toggleVistasFicha(vista, origen = 'facturas') {
    const vistaFacturas = document.getElementById('vista-facturas');
    const vistaHistorial = document.getElementById('vista-historial');
    const vistaDetalle = document.getElementById('vista-factura-detalle');
    const footerFacturas = document.getElementById('footer-facturas');

    vistaFacturas.classList.add('d-none');
    vistaHistorial.classList.add('d-none');
    vistaDetalle.classList.add('d-none');
    footerFacturas.classList.add('d-none');

    if (vista === 'historial') {
        vistaHistorial.classList.remove('d-none');
    } else if (vista === 'detalle') {
        vistaOrigenDetalle = origen;
        vistaDetalle.classList.remove('d-none');
    } else {
        vistaFacturas.classList.remove('d-none');
        footerFacturas.classList.remove('d-none');
    }
}

async function verFichaCliente(id) {
    try {
        const data = await apiFetch(`/clientes/${id}/historial/`, 'GET');
        datosFichaActual = data; 

        // 1. Llenar cabecera superior
        document.getElementById('ec-cliente-nombre').innerText = data.cliente.nombre;
        document.getElementById('ec-cliente-doc').innerText = data.cliente.documento || 'S/N';
        document.getElementById('ec-cliente-tlf').innerText = data.cliente.telefono || 'S/N';

        document.getElementById('ec-deuda-total').innerText = `$ ${data.deuda_total.toFixed(2)}`;
        document.getElementById('ec-limite').innerText = data.limite_credito <= 0 ? 'N/A' : `$ ${data.limite_credito.toFixed(2)}`;

        // >>> NUEVO: Mostrar saldo a favor si existe <<<
        const saldoFavorEl = document.getElementById('ec-saldo-favor');
        if (saldoFavorEl) {
            if (data.saldo_a_favor > 0) {
                saldoFavorEl.innerHTML = `<span class="badge bg-success">Saldo a favor: $${data.saldo_a_favor.toFixed(2)}</span>`;
            } else {
                saldoFavorEl.innerHTML = '';
            }
        }

        // 2. Renderizar Pantalla Principal (Facturas Pendientes)
        renderizarFacturasPendientes(data.facturas_pendientes);

        // 3. Renderizar Pantalla Oculta (Historial Completo)
        renderizarMovimientos(data.ventas, data.pagos);

        // 4. Asegurarnos que siempre abra en la vista de facturas
        toggleVistasFicha('facturas');

        const modal = new bootstrap.Modal(document.getElementById('modalEstadoCuenta'));
        modal.show();
    } catch (error) {
        alert("No se pudo cargar la información del cliente.");
    }
}

// ==============================================================================
// RENDERIZADO DE FACTURAS PENDIENTES
// ==============================================================================
function renderizarFacturasPendientes(facturas) {
    const contenedor = document.getElementById('contenedor-facturas-pendientes');
    contenedor.innerHTML = '';

    if (!facturas || facturas.length === 0) {
        contenedor.innerHTML = `
            <div class="p-5 text-center text-success">
                <i class="bi bi-check-circle-fill fs-1 d-block mb-3"></i>
                <h5 class="fw-bold">El cliente está al día.</h5>
                <p class="text-muted">No tiene facturas pendientes por pagar.</p>
            </div>
        `;
        return;
    }

    facturas.forEach(f => {
        const fechaVenta = new Date(f.fecha).toLocaleDateString();
        const horaVenta = new Date(f.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        // >>> NUEVO: Badge de tipo de venta <<<
        const badgeTipo = f.tipo_venta === 'CREDITO' 
            ? '<span class="badge bg-warning text-dark ms-1">CRÉDITO</span>' 
            : '<span class="badge bg-success ms-1">CONTADO</span>';

        const html = `
            <div class="d-flex align-items-center p-3 border-bottom bg-white">
                <div class="me-3 fs-3 text-danger"><i class="bi bi-file-earmark-text"></i></div>
                <div class="flex-grow-1 text-dark">
                    <div class="fw-bold text-primary fs-5" style="cursor:pointer; text-decoration:underline;" 
                         onclick="verDetalleFactura(${f.venta_id}, 'facturas')" 
                         title="Haga clic para ver los artículos comprados">
                        Factura #${f.venta_id} ${badgeTipo}
                    </div>
                    <div class="small text-muted mt-1">
                        <i class="bi bi-calendar3 me-1"></i> <b>Emisión:</b> ${fechaVenta} - ${horaVenta} <br>
                        <i class="bi bi-currency-dollar me-1"></i> <b>Monto Original:</b> $ ${f.monto_total.toFixed(2)}
                    </div>
                </div>
                <div class="text-end">
                    <span class="badge bg-danger rounded-pill mb-1">Deuda Pendiente</span>
                    <h4 class="mb-0 fw-bold text-danger">$ ${f.saldo_pendiente.toFixed(2)}</h4>
                </div>
            </div>
        `;
        contenedor.innerHTML += html;
    });
}

// ==============================================================================
// RENDERIZADO DE HISTORIAL DE MOVIMIENTOS (CON TIPO DE VENTA)
// ==============================================================================
function renderizarMovimientos(ventas, pagos) {
    const contenedor = document.getElementById('contenedor-movimientos');
    contenedor.innerHTML = '';

    let movimientos = [
        ...ventas.map(v => ({...v, clase: 'VENTA', icon: 'bi-cart-fill', color: 'text-dark'})),
        ...pagos.map(p => ({...p, clase: 'ABONO', icon: 'bi-cash-coin', color: 'text-success'}))
    ].sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    if (movimientos.length === 0) {
        contenedor.innerHTML = '<div class="p-4 text-center text-muted">Sin movimientos registrados</div>';
        return;
    }

    movimientos.forEach(m => {
        const fecha = new Date(m.fecha).toLocaleDateString();
        const hora = new Date(m.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        // >>> NUEVO: Badge de tipo en el historial <<<
        let badgeTipo = '';
        if (m.clase === 'VENTA') {
            badgeTipo = m.tipo === 'CREDITO' 
                ? '<span class="badge bg-warning text-dark ms-1">CRÉDITO</span>' 
                : '<span class="badge bg-success ms-1">CONTADO</span>';
        }

        let tituloCelda = m.clase === 'VENTA'
            ? `<div class="fw-bold text-primary" style="cursor:pointer; text-decoration:underline;" onclick="verDetalleFactura(${m.id}, 'historial')" title="Ver detalles de esta venta">Compra de Mercancía (Factura #${m.id}) ${badgeTipo}</div>`
            : `<div class="fw-bold text-dark">Abono: ${m.referencia}</div>`;

        const html = `
            <div class="d-flex align-items-center p-3 border-bottom bg-white text-dark">
                <div class="me-3 fs-4 ${m.color}"><i class="bi ${m.icon}"></i></div>
                <div class="flex-grow-1">
                    <div class="fw-bold text-uppercase small text-muted">${m.clase} ${m.clase === 'ABONO' ? '(A Fact. #'+m.factura_id+')' : '#'+m.id}</div>
                    ${tituloCelda}
                    <div class="small text-muted">${fecha} - ${hora}</div>
                </div>
                <div class="text-end">
                    <h5 class="mb-0 fw-bold ${m.clase === 'VENTA' ? 'text-dark' : 'text-success'}">
                        ${m.clase === 'VENTA' ? '-' : '+'}$ ${m.monto.toFixed(2)}
                    </h5>
                </div>
            </div>
        `;
        contenedor.innerHTML += html;
    });
}

// ==============================================================================
// DETALLE DE FACTURA
// ==============================================================================
async function verDetalleFactura(ventaId, origen) {
    try {
        const f = await apiFetch(`/ventas/${ventaId}/detalle/`, 'GET');

        document.getElementById('titulo-detalle-factura').innerHTML = `<i class="bi bi-file-earmark-spreadsheet me-2"></i>DETALLE DE FACTURA #${f.id}`;

        document.getElementById('fd-fecha').innerText = new Date(f.fecha).toLocaleString();
        document.getElementById('fd-tipo').innerText = f.tipo;
        document.getElementById('fd-estado').innerText = f.estado;
        document.getElementById('fd-tasa').innerText = `${f.tasa_cambio.toFixed(2)} Bs/$`;

        const tbody = document.getElementById('fd-tabla-productos');
        tbody.innerHTML = '';
        f.productos.forEach(p => {
            tbody.innerHTML += `
                <tr>
                    <td class="text-start ps-2"><b>${p.producto}</b><br><small class="text-muted">${p.presentacion}</small></td>
                    <td>${p.cantidad}</td>
                    <td>$ ${p.precio_unitario.toFixed(2)}</td>
                    <td>$ ${p.subtotal.toFixed(2)}</td>
                </tr>
            `;
        });

        document.getElementById('fd-subtotal').innerText = `$ ${f.subtotal_principal.toFixed(2)}`;
        document.getElementById('fd-impuestos').innerText = `$ ${f.total_impuestos_principal.toFixed(2)}`;
        document.getElementById('fd-total').innerText = `$ ${f.total_principal.toFixed(2)}`;
        document.getElementById('fd-total-bs').innerText = `Bs. ${f.total_secundaria.toFixed(2)}`;

        const contPagos = document.getElementById('fd-contenedor-pagos');
        contPagos.innerHTML = '';
        if (!f.pagos || f.pagos.length === 0) {
            contPagos.innerHTML = '<div class="text-muted border p-2 rounded bg-white small">No se registraron pagos iniciales (Venta procesada enteramente a crédito).</div>';
        } else {
            f.pagos.forEach(p => {
                contPagos.innerHTML += `
                    <div class="p-2 border rounded bg-white mb-1 d-flex justify-content-between align-items-center small text-dark">
                        <div>
                            <span class="badge bg-success">${p.metodo}</span>
                            <span class="text-muted ms-2">Ref: ${p.referencia}</span>
                        </div>
                        <div class="fw-bold text-success">
                            $ ${p.monto_usd.toFixed(2)} <small class="text-muted">(${p.monto_pagado.toFixed(2)})</small>
                        </div>
                    </div>
                `;
            });
        }

        document.getElementById('btn-volver-detalle-factura').onclick = () => {
            toggleVistasFicha(origen);
        };

        toggleVistasFicha('detalle', origen);
    } catch (error) {
        alert("No se pudieron cargar los componentes internos de la factura seleccionada.");
        console.error(error);
    }
}

// ==============================================================================
// NUEVO SISTEMA DE ABONOS - MÚLTIPLES MÉTODOS DE PAGO
// ==============================================================================
function abrirModalNuevoAbono() {
    if (!datosFichaActual) return;

    // Preparar el modal
    document.getElementById('abono-cliente-nombre').innerText = datosFichaActual.cliente.nombre;
    document.getElementById('abono-deuda-total').innerText = datosFichaActual.deuda_total.toFixed(2);

    // >>> NUEVO: Mostrar saldo a favor si existe <<<
    const saldoFavor = parseFloat(datosFichaActual.saldo_a_favor || 0);
    const saldoFavorEl = document.getElementById('abono-saldo-favor');
    if (saldoFavor > 0) {
        saldoFavorEl.innerHTML = `<span class="badge bg-success">Tiene $${saldoFavor.toFixed(2)} de saldo a favor (se aplicará automáticamente)</span>`;
    } else {
        saldoFavorEl.innerHTML = '';
    }

    // Tasa editable
    document.getElementById('abono-tasa-cambio').value = tasaCambioActual.toFixed(2);

    // Limpiar y preparar líneas de pago
    document.getElementById('abono-contenedor-pagos').innerHTML = '';
    agregarLineaPagoAbono();

    // Limpiar referencia
    document.getElementById('abono-referencia-global').value = '';

    // Ocultar modal de ficha y mostrar modal de abono
    bootstrap.Modal.getInstance(document.getElementById('modalEstadoCuenta')).hide();
    new bootstrap.Modal(document.getElementById('modalNuevoAbono')).show();
}

function agregarLineaPagoAbono() {
    const cont = document.getElementById('abono-contenedor-pagos');
    const idx = Date.now() + Math.random().toString(36).substr(2, 5);

    let optionsHTML = '<option value="">-- Seleccione --</option>';
    metodosPagoCache.forEach(m => {
        optionsHTML += `<option value="${m.id}" data-moneda="${m.moneda_referencia}">${m.nombre} (${m.moneda_referencia === 'PRINCIPAL' ? 'USD' : 'BS'})</option>`;
    });

    const div = document.createElement('div');
    div.className = 'row g-2 mb-2 align-items-center linea-pago-abono';
    div.id = `linea-abono-${idx}`;
    div.innerHTML = `
        <div class="col-5">
            <select class="form-select form-select-sm metodo-abono-select" data-prev-moneda="" onchange="alCambiarMetodoAbono(this)">
                ${optionsHTML}
            </select>
        </div>
        <div class="col-5">
            <input type="number" class="form-control form-control-sm monto-abono-input" placeholder="Monto" step="0.01" value="" onclick="this.select()" oninput="evaluarEstadoAbono()">
        </div>
        <div class="col-2">
            <button class="btn btn-sm btn-outline-danger w-100" onclick="this.closest('.linea-pago-abono').remove(); evaluarEstadoAbono();">X</button>
        </div>
    `;
    cont.appendChild(div);

    evaluarEstadoAbono();
}

function alCambiarMetodoAbono(selectElement) {
    const fila = selectElement.closest('.linea-pago-abono');
    const inputMonto = fila.querySelector('.monto-abono-input');
    const opcionSeleccionada = selectElement.options[selectElement.selectedIndex];

    if (!selectElement.value) {
        selectElement.setAttribute('data-prev-moneda', '');
        evaluarEstadoAbono();
        return;
    }

    const nuevaMoneda = opcionSeleccionada.getAttribute('data-moneda') || 'PRINCIPAL';
    const monedaPrevia = selectElement.getAttribute('data-prev-moneda');
    const valorActual = parseFloat(inputMonto.value);

    // CASO 1: El campo está vacío o es cero -> Sugerimos el faltante completo
    if (isNaN(valorActual) || valorActual === 0) {
        const deudaTotal = parseFloat(datosFichaActual.deuda_total || 0);
        let sumaUSD = 0;

        document.querySelectorAll('.linea-pago-abono').forEach(otraFila => {
            if (otraFila !== fila) {
                const selOtra = otraFila.querySelector('.metodo-abono-select');
                const opcOtra = selOtra.options[selOtra.selectedIndex];
                const monOtra = opcOtra ? (opcOtra.getAttribute('data-moneda') || 'PRINCIPAL') : 'PRINCIPAL';
                const montOtra = parseFloat(otraFila.querySelector('.monto-abono-input').value) || 0;

                const tasa = parseFloat(document.getElementById('abono-tasa-cambio').value) || 1;
                if (monOtra === 'SECUNDARIA') {
                    if (tasa > 0) sumaUSD += montOtra / tasa;
                } else {
                    sumaUSD += montOtra;
                }
            }
        });

        let faltaUSD = deudaTotal - sumaUSD;
        if (faltaUSD < 0) faltaUSD = 0;

        let sugerencia = faltaUSD;
        if (nuevaMoneda === 'SECUNDARIA') {
            const tasa = parseFloat(document.getElementById('abono-tasa-cambio').value) || 1;
            sugerencia = faltaUSD * tasa;
        }

        inputMonto.value = sugerencia > 0 ? sugerencia.toFixed(2) : '';

    } else if (monedaPrevia && monedaPrevia !== nuevaMoneda) {
        // CASO 2: Conversión automática al cambiar moneda
        const tasa = parseFloat(document.getElementById('abono-tasa-cambio').value) || 1;
        let nuevoValor = valorActual;

        if (monedaPrevia === 'PRINCIPAL' && nuevaMoneda === 'SECUNDARIA') {
            nuevoValor = valorActual * tasa;
        } else if (monedaPrevia === 'SECUNDARIA' && nuevaMoneda === 'PRINCIPAL') {
            if (tasa > 0) nuevoValor = valorActual / tasa;
        }

        inputMonto.value = nuevoValor.toFixed(2);
    }

    selectElement.setAttribute('data-prev-moneda', nuevaMoneda);
    evaluarEstadoAbono();
}

function evaluarEstadoAbono() {
    const deudaTotal = parseFloat(datosFichaActual.deuda_total || 0);
    const tasa = parseFloat(document.getElementById('abono-tasa-cambio').value) || 1;

    let sumaUSD = 0;
    const filas = document.querySelectorAll('.linea-pago-abono');

    filas.forEach(fila => {
        const select = fila.querySelector('.metodo-abono-select');
        const opcion = select.options[select.selectedIndex];
        const moneda = opcion ? (opcion.getAttribute('data-moneda') || 'PRINCIPAL') : 'PRINCIPAL';
        const monto = parseFloat(fila.querySelector('.monto-abono-input').value) || 0;

        if (moneda === 'SECUNDARIA') {
            if (tasa > 0) sumaUSD += monto / tasa;
        } else {
            sumaUSD += monto;
        }
    });

    const restante = deudaTotal - sumaUSD;
    const restanteEl = document.getElementById('abono-restante-usd');
    const btnConfirmar = document.getElementById('btn-confirmar-abono');
    const alertaSobrante = document.getElementById('abono-alerta-sobrante');

    if (sumaUSD <= 0) {
        restanteEl.innerText = '$ ' + deudaTotal.toFixed(2);
        restanteEl.className = 'text-warning fw-bold mb-0';
        btnConfirmar.disabled = true;
        alertaSobrante.classList.add('d-none');
    } else if (restante > 0.01) {
        // Abono parcial
        restanteEl.innerText = '$ ' + restante.toFixed(2) + ' (PENDIENTE)';
        restanteEl.className = 'text-info fw-bold mb-0';
        btnConfirmar.disabled = false;
        alertaSobrante.classList.add('d-none');
    } else if (restante < -0.01) {
        // Sobrante - mostrar alerta
        restanteEl.innerText = 'SOBRANTE: $ ' + Math.abs(restante).toFixed(2);
        restanteEl.className = 'text-success fw-bold mb-0';
        btnConfirmar.disabled = false;
        alertaSobrante.classList.remove('d-none');
        document.getElementById('abono-monto-sobrante').innerText = Math.abs(restante).toFixed(2);
    } else {
        // Pago exacto
        restanteEl.innerText = '$ 0.00';
        restanteEl.className = 'text-success fw-bold mb-0';
        btnConfirmar.disabled = false;
        alertaSobrante.classList.add('d-none');
    }
}

async function procesarAbono() {
    const tasa = parseFloat(document.getElementById('abono-tasa-cambio').value) || 1;
    const referencia = document.getElementById('abono-referencia-global').value.trim();

    // Recolectar pagos
    const pagos = [];
    document.querySelectorAll('.linea-pago-abono').forEach(fila => {
        const select = fila.querySelector('.metodo-abono-select');
        const metodoId = parseInt(select.value);
        const monto = parseFloat(fila.querySelector('.monto-abono-input').value) || 0;

        if (metodoId && monto > 0) {
            pagos.push({
                metodo_id: metodoId,
                monto_pagado: monto.toFixed(2)
            });
        }
    });

    if (pagos.length === 0) {
        alert("Debes agregar al menos un método de pago con monto mayor a 0.");
        return;
    }

    // Calcular si hay sobrante
    let sumaUSD = 0;
    pagos.forEach(p => {
        const metodo = metodosPagoCache.find(m => m.id === p.metodo_id);
        const monto = parseFloat(p.monto_pagado);
        if (metodo && metodo.moneda_referencia === 'SECUNDARIA' && tasa > 0) {
            sumaUSD += monto / tasa;
        } else {
            sumaUSD += monto;
        }
    });

    const deudaTotal = parseFloat(datosFichaActual.deuda_total || 0);
    const sobrante = sumaUSD - deudaTotal;

    let guardarSaldoFavor = false;
    if (sobrante > 0.01) {
        const confirmar = confirm(
            `El abono ($${sumaUSD.toFixed(2)}) supera la deuda total ($${deudaTotal.toFixed(2)}).\\n\\n` +
            `¿Deseas guardar $${sobrante.toFixed(2)} como saldo a favor para futuras compras a crédito?\\n\\n` +
            `Presiona ACEPTAR para guardar el saldo.\\nPresiona CANCELAR para ajustar el monto.`
        );
        if (!confirmar) return;
        guardarSaldoFavor = true;
    }

    const payload = {
        cliente_id: datosFichaActual.cliente.id,
        tasa_cambio: tasa.toFixed(2),
        guardar_saldo_favor: guardarSaldoFavor,
        pagos: pagos
    };

    try {
        const respuesta = await apiFetch('/cxc/abonar-masivo/', 'POST', payload);

        let mensaje = "Abono procesado exitosamente.\\n\\n";
        if (respuesta.facturas_afectadas && respuesta.facturas_afectadas.length > 0) {
            mensaje += "Facturas pagadas/actualizadas:\\n";
            respuesta.facturas_afectadas.forEach(f => {
                mensaje += `  - Factura #${f.venta_id}: $${f.monto_aplicado.toFixed(2)} aplicado\\n`;
            });
        }
        if (respuesta.saldo_sobrante_guardado > 0) {
            mensaje += `\\nSaldo a favor guardado: $${respuesta.saldo_sobrante_guardado.toFixed(2)}`;
        }
        if (respuesta.saldo_a_favor > 0) {
            mensaje += `\\nSaldo a favor total del cliente: $${respuesta.saldo_a_favor.toFixed(2)}`;
        }

        alert(mensaje);

        bootstrap.Modal.getInstance(document.getElementById('modalNuevoAbono')).hide();
        cargarClientes();
        verFichaCliente(datosFichaActual.cliente.id);

    } catch (error) {
        if (error.requiere_confirmacion_saldo) {
            const confirmar = confirm(
                `El monto ($${error.monto_sobrante.toFixed(2)}) supera la deuda total.\\n\\n` +
                `¿Deseas guardar el excedente como saldo a favor?`
            );
            if (confirmar) {
                // Reintentar con guardar_saldo_favor = true
                payload.guardar_saldo_favor = true;
                try {
                    const respuesta = await apiFetch('/cxc/abonar-masivo/', 'POST', payload);
                    alert("Abono y saldo a favor procesados exitosamente.");
                    bootstrap.Modal.getInstance(document.getElementById('modalNuevoAbono')).hide();
                    cargarClientes();
                    verFichaCliente(datosFichaActual.cliente.id);
                } catch (e2) {
                    alert("Error al procesar: " + (e2.error || e2.detail || "Error desconocido"));
                }
            }
        } else {
            alert("Error al procesar el abono: " + (error.error || error.detail || error.messageForUser || "Error desconocido."));
        }
    }
}