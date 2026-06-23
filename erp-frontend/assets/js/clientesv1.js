// assets/js/clientes.js

let clientesData = [];
let datosFichaActual = null; 
// Control de ordenamiento
let ordenActual = { columna: 'nombre', ascendente: true };
let vistaOrigenDetalle = 'facturas';

document.addEventListener('DOMContentLoaded', () => {
    cargarClientes();
    
    // Buscador
    document.getElementById('buscador-clientes').addEventListener('input', (e) => {
        aplicarFiltrosYOrden();
    });
});

async function cargarClientes() {
    try {
        clientesData = await apiFetch('/clientes/', 'GET');
        aplicarFiltrosYOrden(); // Usamos la nueva función combinada
    } catch (error) {
        console.error("Error al cargar clientes:", error);
    }
}

// =======================================================
// LÓGICA DE ORDENAMIENTO (NUEVO)
// =======================================================
function ordenarTabla(columna, thElement) {
    // 1. Cambiar estado de orden
    if (ordenActual.columna === columna) {
        ordenActual.ascendente = !ordenActual.ascendente;
    } else {
        ordenActual.columna = columna;
        ordenActual.ascendente = true;
    }

    // 2. Estilos visuales en los headers
    document.querySelectorAll('.sortable-header').forEach(th => th.classList.remove('active'));
    thElement.classList.add('active');
    
    const icon = thElement.querySelector('.sort-icon');
    if (ordenActual.ascendente) {
        icon.className = 'bi bi-arrow-up sort-icon';
    } else {
        icon.className = 'bi bi-arrow-down sort-icon';
    }

    // 3. Ejecutar algoritmo de orden
    clientesData.sort((a, b) => {
        let valA = a[columna] || '';
        let valB = b[columna] || '';

        // Si son campos numéricos (deuda o límite), convertirlos para ordenar bien
        if (columna === 'deuda_total' || columna === 'limite_credito') {
            valA = parseFloat(valA) || 0;
            valB = parseFloat(valB) || 0;
        } else {
            // Si es texto, pasarlo a minúsculas
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
        // --- LÓGICA VISUAL DE LA DEUDA ---
        const deuda = parseFloat(c.deuda_total || 0);
        const htmlDeuda = deuda > 0 
            ? `<span class="fw-bold text-danger">$ ${deuda.toFixed(2)}</span>` 
            : `<span class="text-muted">$ 0.00</span>`;

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

// =======================================================
// CREACIÓN Y EDICIÓN DE CLIENTES
// =======================================================
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

// =======================================================
// FICHA DE CLIENTE Y MANEJO DE "VENTANAS INTERNAS"
// =======================================================

// Función para cambiar entre Facturas Pendientes e Historial Completo
function toggleVistasFicha(vista, origen = 'facturas') {
    const vistaFacturas = document.getElementById('vista-facturas');
    const vistaHistorial = document.getElementById('vista-historial');
    const vistaDetalle = document.getElementById('vista-factura-detalle');
    const footerFacturas = document.getElementById('footer-facturas');

    // Ocultamos todas las capas por seguridad antes de activar la requerida
    vistaFacturas.classList.add('d-none');
    vistaHistorial.classList.add('d-none');
    vistaDetalle.classList.add('d-none');
    footerFacturas.classList.add('d-none');

    if (vista === 'historial') {
        vistaHistorial.classList.remove('d-none');
    } else if (vista === 'detalle') {
        vistaOrigenDetalle = origen; // Guardamos si venimos de 'facturas' o 'historial'
        vistaDetalle.classList.remove('d-none');
    } else {
        // Por defecto: Vista Facturas Pendientes
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

// =======================================================
// RENDERIZADO DE LAS FACTURAS PENDIENTES (AJUSTADO)
// =======================================================
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
        // Formateo elegante de la fecha recibida
        const fechaVenta = new Date(f.fecha).toLocaleDateString();
        const horaVenta = new Date(f.fecha).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        const html = `
            <div class="d-flex align-items-center p-3 border-bottom bg-white">
                <div class="me-3 fs-3 text-danger"><i class="bi bi-file-earmark-text"></i></div>
                <div class="flex-grow-1 text-dark">
                    <div class="fw-bold text-primary fs-5" style="cursor:pointer; text-decoration:underline;" 
                         onclick="verDetalleFactura(${f.venta_id}, 'facturas')" 
                         title="Haga clic para ver los artículos comprados">
                        Factura #${f.venta_id}
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

// =======================================================
// RENDERIZADO DE HISTORIAL DE MOVIMIENTOS (AJUSTADO)
// =======================================================
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
        
        // Si el movimiento es una VENTA, hacemos que su título sea clickable para auditarla
        let tituloCelda = m.clase === 'VENTA'
            ? `<div class="fw-bold text-primary" style="cursor:pointer; text-decoration:underline;" onclick="verDetalleFactura(${m.id}, 'historial')" title="Ver detalles de esta venta">Compra de Mercancía (Factura #${m.id})</div>`
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

// =======================================================
// NUEVA FUNCIÓN: EXTRACTOR Y MAQUETADOR DE DETALLES DE VENTA
// =======================================================
async function verDetalleFactura(ventaId, origen) {
    try {
        // Consultamos al nuevo endpoint de auditoría
        const f = await apiFetch(`/ventas/${ventaId}/detalle/`, 'GET');
        
        document.getElementById('titulo-detalle-factura').innerHTML = `<i class="bi bi-file-earmark-spreadsheet me-2"></i>DETALLE DE FACTURA #${f.id}`;
        
        // Llenar información de cabecera
        document.getElementById('fd-fecha').innerText = new Date(f.fecha).toLocaleString();
        document.getElementById('fd-tipo').innerText = f.tipo;
        document.getElementById('fd-estado').innerText = f.estado;
        document.getElementById('fd-tasa').innerText = `${f.tasa_cambio.toFixed(2)} Bs/$`;
        
        // Listar los artículos vendidos
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
        
        // Establecer totales monetarios
        document.getElementById('fd-subtotal').innerText = `$ ${f.subtotal_principal.toFixed(2)}`;
        document.getElementById('fd-impuestos').innerText = `$ ${f.total_impuestos_principal.toFixed(2)}`;
        document.getElementById('fd-total').innerText = `$ ${f.total_principal.toFixed(2)}`;
        document.getElementById('fd-total-bs').innerText = `Bs. ${f.total_secundaria.toFixed(2)}`;
        
        // Renderizar los pagos iniciales registrados en caja
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
        
        // Configurar dinámicamente la acción del botón de regreso según de dónde venga el usuario
        document.getElementById('btn-volver-detalle-factura').onclick = () => {
            toggleVistasFicha(origen);
        };
        
        // Cambiar la vista interna del modal hacia la ficha extendida de la factura
        toggleVistasFicha('detalle', origen);
    } catch (error) {
        alert("No se pudieron cargar los componentes internos de la factura seleccionada.");
        console.error(error);
    }
}

function abrirModalNuevoAbono() {
    if (!datosFichaActual || datosFichaActual.facturas_pendientes.length === 0) {
        alert("Este cliente no tiene deudas pendientes.");
        return;
    }

    const select = document.getElementById('abono-factura');
    select.innerHTML = '';
    datosFichaActual.facturas_pendientes.forEach(f => {
        select.innerHTML += `<option value="${f.cxc_id}">Factura #${f.venta_id} (Deuda: $${f.saldo_pendiente.toFixed(2)})</option>`;
    });

    document.getElementById('abono-monto').value = '';
    document.getElementById('abono-referencia').value = '';

    bootstrap.Modal.getInstance(document.getElementById('modalEstadoCuenta')).hide();
    new bootstrap.Modal(document.getElementById('modalNuevoAbono')).show();
}

async function procesarAbono() {
    const cxc_id = document.getElementById('abono-factura').value;
    const monto = parseFloat(document.getElementById('abono-monto').value);
    const referencia = document.getElementById('abono-referencia').value.trim();

    if (!monto || monto <= 0) { alert("Ingresa un monto válido."); return; }

    const payload = {
        cuenta: cxc_id,
        monto_abono_principal: monto.toFixed(2),
        monto_entregado_secundaria: "0.00", 
        tasa_cambio_pago: datosFichaActual.tasa_actual.toFixed(2),
        referencia: referencia || "Abono manual"
    };

    try {
        await apiFetch('/cxc/abonar/', 'POST', payload);
        alert("Abono procesado con éxito.");
        
        bootstrap.Modal.getInstance(document.getElementById('modalNuevoAbono')).hide();
        cargarClientes(); // Refrescar tabla general y actualizar deuda
        verFichaCliente(datosFichaActual.cliente.id); // Reabrir la ficha actualizada
        
    } catch (error) {
        alert("Error al procesar el abono: " + (error.detail || error.messageForUser || error.error || "Monto inválido."));
    }
}