// assets/js/clientes.js

let clientesData = [];
let datosFichaActual = null; 
let metodosPagoCache = [];
let tasaCambioActual = 0;
let ordenActual = { columna: 'nombre', ascendente: true };
let vistaOrigenDetalle = 'facturas';
// Evita que un doble clic con internet lento registre el abono varias veces.
let abonoEnCurso = false;
// Clave única por intento de abono: el backend la usa para no duplicar.
let abonoIdempotencyKey = null;
let cierreAbonoPermitido = false;
// Evita que el doble clic cree dos clientes.
let clienteEnCurso = false;
// Evita abrir dos veces la misma ficha mientras la primera sigue cargando.
const fichasEnCurso = new Set();
let fichaSecuencia = 0;

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
document.addEventListener('DOMContentLoaded', () => {
    cargarClientes();
    cargarMetodosPagoYConfig();

    // Evita cerrar el modal con la X, el fondo o Escape mientras el abono
    // está en vuelo: cerrar y reabrir permitía reenviar el mismo abono.
    const modalAbonoEl = document.getElementById('modalNuevoAbono');
    if (modalAbonoEl) {
        modalAbonoEl.addEventListener('hide.bs.modal', (e) => {
            if (abonoEnCurso && !cierreAbonoPermitido) {
                e.preventDefault();
                console.warn('Abono en proceso: espera la respuesta antes de cerrar.');
            }
        });
    }

    // Buscador
    document.getElementById('buscador-clientes').addEventListener('input', (e) => {
        aplicarFiltrosYOrden();
    });
});

// ==============================================================================
// FECHAS: parseo seguro
// Evita que un 'YYYY-MM-DD' se muestre como el día anterior (se interpretaba en UTC)
// ==============================================================================
function parseFechaLocal(valor) {
    if (!valor) return null;
    const s = String(valor).trim();
    const soloFecha = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (soloFecha) {
        // Fecha sin hora: se interpreta en hora LOCAL, no en UTC
        return new Date(Number(soloFecha[1]), Number(soloFecha[2]) - 1, Number(soloFecha[3]));
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
}

function fmtFecha(valor) {
    const d = parseFechaLocal(valor);
    return d ? d.toLocaleDateString() : '—';
}

function fmtHora(valor) {
    const d = parseFechaLocal(valor);
    return d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

// Escapa texto que viene del usuario (referencias, nombres) antes de inyectarlo
// en HTML, para no romper el historial con caracteres como < o &.
function escaparHtml(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function fmtMontoPago(monto, moneda) {
    const n = parseFloat(monto) || 0;
    if (moneda === 'SECUNDARIA') return `Bs ${n.toFixed(2)}`;
    if (moneda === 'SALDO_FAVOR') return `Saldo a favor $${n.toFixed(2)}`;
    return `$ ${n.toFixed(2)}`;
}

// Indicador visible mientras se carga la ficha (internet lento).
function mostrarIndicadorFicha(texto) {
    const el = document.getElementById('indicador-carga-ficha');
    const txt = document.getElementById('indicador-carga-ficha-texto');
    if (txt) txt.textContent = texto || 'Cargando ficha del cliente...';
    if (el) el.classList.remove('d-none');
}

function ocultarIndicadorFicha() {
    const el = document.getElementById('indicador-carga-ficha');
    if (el) el.classList.add('d-none');
}

function generarClaveIdempotencia() {
    try {
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return window.crypto.randomUUID();
        }
    } catch (e) { /* fallback abajo */ }
    return `abono-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

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
                    <button class="btn btn-sm btn-primary shadow-sm btn-ficha-cliente" id="btn-ficha-${c.id}"
                            onclick="verFichaCliente(${c.id}, this)">
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

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEstadoCuenta')).hide();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalClienteForm')).show();
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

async function guardarCliente(btn) {
    if (clienteEnCurso) {
        console.warn('Guardado de cliente ya en curso. Se ignora el clic duplicado.');
        return;
    }

    const id = document.getElementById('form-cliente-id').value;
    const payload = {
        nombre: document.getElementById('form-cliente-nombre').value.trim(),
        documento: document.getElementById('form-cliente-doc').value.trim(),
        telefono: document.getElementById('form-cliente-tlf').value.trim(),
        limite_credito: document.getElementById('form-cliente-limite').value || "0.00"
    };

    if (!payload.nombre) { alert("El nombre es obligatorio"); return; }

    const boton = btn || document.getElementById('btn-guardar-cliente');
    try {
        clienteEnCurso = true;
        setBotonProcesando(boton, true, 'GUARDANDO...');

        if (id) {
            await apiFetch(`/clientes/${id}/editar/`, 'PUT', payload);
            alert("Cliente actualizado correctamente.");
        } else {
            await apiFetch('/clientes/', 'POST', payload);
            alert("Cliente registrado correctamente.");
        }

        const modalForm = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalClienteForm'));
        modalForm.hide();
        cargarClientes(); 
        if (id && datosFichaActual) verFichaCliente(id); 

    } catch (error) {
        alert("Error al guardar: " + (error.detail || error.messageForUser || error.error || "Revisa la consola."));
    } finally {
        clienteEnCurso = false;
        setBotonProcesando(boton, false);
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

async function verFichaCliente(id, btn) {
    if (fichasEnCurso.has(id)) {
        console.warn('La ficha de este cliente ya se está cargando. Se ignora el clic duplicado.');
        return;
    }

    fichasEnCurso.add(id);
    const secuencia = ++fichaSecuencia;
    const boton = btn || document.getElementById(`btn-ficha-${id}`);
    setBotonProcesando(boton, true, 'CARGANDO...');
    mostrarIndicadorFicha('Cargando ficha del cliente...');

    try {
        const data = await apiFetch(`/clientes/${id}/historial/`, 'GET');

        // Si mientras cargaba se pidió otra ficha, no mostramos una respuesta vieja.
        if (secuencia !== fichaSecuencia) return;

        datosFichaActual = data; 

        // 1. Llenar cabecera superior
        document.getElementById('ec-cliente-nombre').innerText = data.cliente.nombre;
        document.getElementById('ec-cliente-doc').innerText = data.cliente.documento || 'S/N';
        document.getElementById('ec-cliente-tlf').innerText = data.cliente.telefono || 'S/N';

        const deudaUsd = parseFloat(data.deuda_total || 0);
        const tasaMostrar = parseFloat(data.tasa_actual) || tasaCambioActual || 1;
        document.getElementById('ec-deuda-total').innerText = `$ ${deudaUsd.toFixed(2)}`;
        // La ficha muestra la deuda pendiente convertida a moneda secundaria.
        document.getElementById('ec-limite').innerText = `Bs ${(deudaUsd * tasaMostrar).toFixed(2)}`;

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
        renderizarMovimientos(data.ventas, data.recibos);

        // 4. Asegurarnos que siempre abra en la vista de facturas
        toggleVistasFicha('facturas');

        const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEstadoCuenta'));
        modal.show();
    } catch (error) {
        if (secuencia === fichaSecuencia) {
            const detalle = error && (error.detail || error.messageForUser || error.error);
            alert("No se pudo cargar la información del cliente." + (detalle ? "\n\n" + detalle : ""));
        }
    } finally {
        fichasEnCurso.delete(id);
        if (secuencia === fichaSecuencia) {
            ocultarIndicadorFicha();
        }
        setBotonProcesando(boton, false);
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
        const fechaVenta = fmtFecha(f.fecha);
        const horaVenta = fmtHora(f.fecha);

        // >>> NUEVO: origen real del documento (venta / deuda inicial / crédito de ruta) <<<
        const esVenta = !!f.venta_id;
        let tituloDoc;
        if (esVenta) {
            const badgeTipo = f.estado === 'ANULADA'
                ? '<span class="badge bg-danger ms-1">ANULADA</span>'
                : (f.tipo_venta === 'CREDITO'
                    ? '<span class="badge bg-warning text-dark ms-1">CRÉDITO</span>'
                    : '<span class="badge bg-success ms-1">CONTADO</span>');
            tituloDoc = `<div class="fw-bold text-primary fs-5" style="cursor:pointer; text-decoration:underline;"
                         onclick="verDetalleFactura(${f.venta_id}, 'facturas')"
                         title="Haga clic para ver los artículos comprados">
                        Factura #${f.venta_id} ${badgeTipo}
                    </div>`;
        } else {
            const esDeudaInicial = f.tipo_origen !== 'CREDITO_RUTA';
            const etiqueta = esDeudaInicial ? 'Deuda Inicial' : 'Crédito de Ruta';
            const badgeOrigen = esDeudaInicial
                ? '<span class="badge bg-secondary ms-1">DEUDA INICIAL</span>'
                : '<span class="badge bg-info text-dark ms-1">CRÉDITO DE RUTA</span>';
            tituloDoc = `<div class="fw-bold text-primary fs-5">${etiqueta} (Registro #${f.cxc_id}) ${badgeOrigen}</div>`;
        }

        const html = `
            <div class="d-flex align-items-center p-3 border-bottom bg-white">
                <div class="me-3 fs-3 text-danger"><i class="bi bi-file-earmark-text"></i></div>
                <div class="flex-grow-1 text-dark">
                    ${tituloDoc}
                    <div class="small text-muted mt-1">
                        <i class="bi bi-calendar3 me-1"></i> <b>Emisión:</b> ${fechaVenta}${horaVenta ? ' - ' + horaVenta : ''} <br>
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
function renderizarMovimientos(ventas, recibos) {
    const contenedor = document.getElementById('contenedor-movimientos');
    contenedor.innerHTML = '';

    let movimientos = [
        ...ventas.map(v => ({...v, clase: 'VENTA', icon: 'bi-cart-fill', color: 'text-dark'})),
        ...(recibos || []).map(r => ({...r, clase: 'RECIBO', icon: 'bi-receipt-cutoff', color: 'text-success'}))
    ].sort((a, b) => (parseFechaLocal(b.fecha)?.getTime() || 0) - (parseFechaLocal(a.fecha)?.getTime() || 0));

    if (movimientos.length === 0) {
        contenedor.innerHTML = '<div class="p-4 text-center text-muted">Sin movimientos registrados</div>';
        return;
    }

    movimientos.forEach(m => {
        const fecha = fmtFecha(m.fecha);
        const hora = fmtHora(m.fecha);

        // Badge de tipo / estado
        // Prioridad: si la factura está ANULADA, ese es el estado real y no
        // debe mostrarse como CONTADO o CRÉDITO.
        let badgeTipo = '';
        const esAnulada = m.clase === 'VENTA' && m.estado === 'ANULADA';
        if (m.clase === 'VENTA') {
            if (esAnulada) {
                badgeTipo = '<span class="badge bg-danger ms-1">ANULADA</span>';
            } else if (m.tipo === 'DEUDA_INICIAL') {
                badgeTipo = '<span class="badge bg-secondary ms-1">DEUDA INICIAL</span>';
            } else if (m.tipo === 'CREDITO_RUTA') {
                badgeTipo = '<span class="badge bg-info text-dark ms-1">CRÉDITO DE RUTA</span>';
            } else if (m.tipo === 'CREDITO') {
                badgeTipo = '<span class="badge bg-warning text-dark ms-1">CRÉDITO</span>';
            } else {
                badgeTipo = '<span class="badge bg-success ms-1">CONTADO</span>';
            }
        } else if (m.clase === 'RECIBO') {
            badgeTipo = `<span class="badge bg-info text-dark ms-1">RECIBO #${m.id}</span>`;
        }

        // Título de la fila
        let tituloCelda;
        if (m.clase === 'VENTA') {
            if (m.id) {
                tituloCelda = `<div class="fw-bold text-primary" style="cursor:pointer; text-decoration:underline;" onclick="verDetalleFactura(${m.id}, 'historial')" title="Ver detalles de esta venta">Compra de Mercancía (Factura #${m.id}) ${badgeTipo}</div>`;
            } else {
                // Deuda inicial o crédito de ruta: no tienen factura que abrir
                const etiqueta = m.tipo === 'CREDITO_RUTA' ? 'Crédito de Ruta' : 'Deuda Inicial';
                tituloCelda = `<div class="fw-bold text-primary">${etiqueta} (Registro #${m.cxc_id}) ${badgeTipo}</div>`;
            }
        } else {
            const refTitulo = m.referencia
                ? `<br><small class="text-muted"><i class="bi bi-bookmark me-1"></i>${escaparHtml(m.referencia)}</small>`
                : '';
            tituloCelda = `<div class="fw-bold text-dark">Recibo de Abono ${badgeTipo}${refTitulo}</div>`;
        }

        // Subtítulo: métodos de pago, referencias y datos del recibo
        let subtitulo = '';
        if (m.clase === 'RECIBO') {
            const desglose = Array.isArray(m.desglose_metodos) ? m.desglose_metodos : [];
            let metodosHTML;
            if (desglose.length > 0) {
                metodosHTML = desglose.map(d => {
                    const nombre = d.metodo_nombre
                        || (d.metodo_id ? `Método #${d.metodo_id}` : (d.moneda === 'SALDO_FAVOR' ? 'Saldo a favor' : 'Método no registrado'));
                    const montoTxt = fmtMontoPago(d.monto_pagado, d.moneda);
                    const equivalente = parseFloat(d.monto_equivalente_usd);
                    const eqTxt = (!isNaN(equivalente) && d.moneda === 'SECUNDARIA')
                        ? ` (\u2248 $${equivalente.toFixed(2)})`
                        : '';
                    const refTxt = d.referencia ? ` \u00b7 Ref: ${escaparHtml(d.referencia)}` : '';
                    return `<span class="badge bg-light text-dark border fw-normal me-1 mb-1"><i class="bi bi-credit-card-2-back me-1"></i>${escaparHtml(nombre)}: ${montoTxt}${eqTxt}${refTxt}</span>`;
                }).join('');
            } else {
                metodosHTML = '<span class="text-muted"><i class="bi bi-exclamation-circle me-1"></i>Método de pago no registrado</span>';
            }

            const usuarioTxt = m.usuario ? ` \u00b7 Registrado por: ${escaparHtml(m.usuario)}` : '';
            subtitulo = `
                <div class="small text-muted mt-1">
                    <div class="d-flex flex-wrap align-items-center">${metodosHTML}</div>
                    <div class="mt-1">
                        <i class="bi bi-check-circle me-1"></i>${m.facturas_afectadas || 0} facturas pagadas${usuarioTxt}
                    </div>
                </div>
            `;
        }

        // Monto y signo
        const esNegativo = m.clase === 'VENTA';
        const montoDisplay = esNegativo 
            ? `-${esAnulada ? '<s>' : ''}$ ${m.monto.toFixed(2)}${esAnulada ? '</s>' : ''}` 
            : `+$ ${(m.monto_total_entregado || m.monto).toFixed(2)}`;

        const html = `
            <div class="d-flex align-items-center p-3 border-bottom bg-white text-dark ${esAnulada ? 'opacity-75' : ''}">
                <div class="me-3 fs-4 ${esAnulada ? 'text-danger' : m.color}"><i class="bi ${m.icon}"></i></div>
                <div class="flex-grow-1">
                    <div class="fw-bold text-uppercase small text-muted">${m.clase} ${m.clase === 'RECIBO' ? `#${m.id}` : ''}</div>
                    ${tituloCelda}
                    ${subtitulo}
                    <div class="small text-muted">${fecha} - ${hora}</div>
                </div>
                <div class="text-end">
                    <h5 class="mb-0 fw-bold ${esAnulada ? 'text-danger text-decoration-line-through' : (esNegativo ? 'text-dark' : 'text-success')}">
                        ${montoDisplay}
                    </h5>
                    ${m.sobrante_a_favor > 0 ? `<small class="text-success">+Saldo: $${m.sobrante_a_favor.toFixed(2)}</small>` : ''}
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
    // Las deudas iniciales y los créditos de ruta no tienen factura que abrir
    if (!ventaId) {
        alert('Este registro no tiene factura asociada (es una deuda inicial o un crédito de ruta).');
        return;
    }
    try {
        const f = await apiFetch(`/ventas/${ventaId}/detalle/`, 'GET');

        document.getElementById('titulo-detalle-factura').innerHTML = `<i class="bi bi-file-earmark-spreadsheet me-2"></i>DETALLE DE FACTURA #${f.id}`;

        document.getElementById('fd-fecha').innerText = (() => {
            const d = parseFechaLocal(f.fecha);
            return d ? d.toLocaleString() : '—';
        })();
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

    // Nuevo intento de abono: clave nueva para que el backend pueda
    // distinguir un reintento del mismo envío de un abono nuevo.
    abonoEnCurso = false;
    cierreAbonoPermitido = false;
    abonoIdempotencyKey = generarClaveIdempotencia();

    // Restaurar el botón por si una operación anterior lo dejó bloqueado.
    const btnConfirmar = document.getElementById('btn-confirmar-abono');
    if (btnConfirmar) setBotonProcesando(btnConfirmar, false);
    const btnCerrarReset = document.getElementById('btn-cerrar-abono');
    const btnCancelarReset = document.getElementById('btn-cancelar-abono');
    if (btnCerrarReset) btnCerrarReset.disabled = false;
    if (btnCancelarReset) btnCancelarReset.disabled = false;

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

    // Fecha del abono: por defecto hoy; máximo hoy (no se permiten futuras).
    const hoy = new Date();
    const fechaISO = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    const inputFecha = document.getElementById('abono-fecha');
    if (inputFecha) {
        inputFecha.value = fechaISO;
        inputFecha.max = fechaISO;
    }

    // Limpiar y preparar líneas de pago
    document.getElementById('abono-contenedor-pagos').innerHTML = '';
    agregarLineaPagoAbono();

    // Limpiar referencia
    document.getElementById('abono-referencia-global').value = '';

    // Ocultar modal de ficha y mostrar modal de abono
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalEstadoCuenta')).hide();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNuevoAbono')).show();
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
        <div class="col-4">
            <select class="form-select form-select-sm metodo-abono-select" data-prev-moneda="" onchange="alCambiarMetodoAbono(this)">
                ${optionsHTML}
            </select>
        </div>
        <div class="col-3">
            <input type="number" class="form-control form-control-sm monto-abono-input" placeholder="Monto" step="0.01" value="" onclick="this.select()" oninput="evaluarEstadoAbono(); actualizarEquivalenteAbono(this.closest('.linea-pago-abono'));">
        </div>
        <div class="col-4">
            <input type="text" class="form-control form-control-sm referencia-abono-input" maxlength="100" placeholder="Ref. (opcional)">
        </div>
        <div class="col-1">
            <button class="btn btn-sm btn-outline-danger w-100" title="Quitar método" onclick="this.closest('.linea-pago-abono').remove(); evaluarEstadoAbono();">X</button>
        </div>
        <div class="col-12 text-end">
            <small class="text-muted equiv-abono-display" style="display: none; font-size: 0.75em; white-space: nowrap;"></small>
        </div>
    `;
    cont.appendChild(div);

    evaluarEstadoAbono();
}

// ==============================================================================
// EQUIVALENCIA EN VIVO DE CADA LÍNEA DE PAGO (USD <-> BS)
// ==============================================================================
function actualizarEquivalenteAbono(fila) {
    if (!fila) return;
    const select = fila.querySelector('.metodo-abono-select');
    const inputMonto = fila.querySelector('.monto-abono-input');
    const display = fila.querySelector('.equiv-abono-display');
    if (!select || !inputMonto || !display) return;

    const opcion = select.options[select.selectedIndex];
    const moneda = opcion ? (opcion.getAttribute('data-moneda') || 'PRINCIPAL') : 'PRINCIPAL';
    const monto = parseFloat(inputMonto.value) || 0;
    const inputTasa = document.getElementById('abono-tasa-cambio');
    const tasa = inputTasa ? (parseFloat(inputTasa.value) || 0) : 0;

    if (monto <= 0 || tasa <= 0) {
        display.style.display = 'none';
        display.textContent = '';
        return;
    }

    if (moneda === 'SECUNDARIA') {
        const usd = monto / tasa;
        display.textContent = '\u2248 $ ' + usd.toFixed(2);
    } else {
        const bs = monto * tasa;
        display.textContent = '\u2248 BS ' + bs.toFixed(2);
    }
    display.style.display = 'inline';
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
    actualizarEquivalenteAbono(fila);
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

        // Equivalencia en vivo de cada línea (USD <-> BS)
        actualizarEquivalenteAbono(fila);
    });

    const restante = deudaTotal - sumaUSD;
    const restanteEl = document.getElementById('abono-restante-usd');
    const restanteBsEl = document.getElementById('abono-restante-bs');
    const btnConfirmar = document.getElementById('btn-confirmar-abono');
    const alertaSobrante = document.getElementById('abono-alerta-sobrante');

    // >>> NUEVO: equivalente BS del restante (o del sobrante) <<<
    if (restanteBsEl) {
        if (tasa > 0 && Math.abs(restante) > 0.01) {
            const esSobrante = restante < -0.01;
            const etiqueta = esSobrante ? 'Sobrante \u2248 BS ' : '\u2248 BS ';
            restanteBsEl.textContent = etiqueta + (Math.abs(restante) * tasa).toFixed(2);
            restanteBsEl.style.display = 'block';
        } else {
            restanteBsEl.style.display = 'none';
        }
    }

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

async function recargarTasaAbono() {
    // Recarga la tasa desde el servidor y la escribe en el input del modal
    await cargarMetodosPagoYConfig();
    const inputTasa = document.getElementById('abono-tasa-cambio');
    if (inputTasa) inputTasa.value = tasaCambioActual.toFixed(2);
    evaluarEstadoAbono();
}

async function procesarAbono() {
    if (abonoEnCurso) {
        console.warn('Abono ya en curso. Se ignora el clic duplicado.');
        return;
    }

    const tasa = parseFloat(document.getElementById('abono-tasa-cambio').value) || 1;
    const referencia = document.getElementById('abono-referencia-global').value.trim();

    // Recolectar pagos (incluyendo la referencia propia de cada método).
    const pagos = [];
    document.querySelectorAll('.linea-pago-abono').forEach(fila => {
        const select = fila.querySelector('.metodo-abono-select');
        const metodoId = parseInt(select.value);
        const monto = parseFloat(fila.querySelector('.monto-abono-input').value) || 0;
        const inputRef = fila.querySelector('.referencia-abono-input');
        const referenciaLinea = inputRef ? inputRef.value.trim() : '';

        if (metodoId && monto > 0) {
            pagos.push({
                metodo_id: metodoId,
                monto_pagado: monto.toFixed(2),
                referencia: referenciaLinea || referencia
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
            `El abono ($${sumaUSD.toFixed(2)}) supera la deuda total ($${deudaTotal.toFixed(2)}).\n\n` +
            `¿Deseas guardar $${sobrante.toFixed(2)} como saldo a favor para futuras compras a crédito?\n\n` +
            `Presiona ACEPTAR para guardar el saldo.\nPresiona CANCELAR para ajustar el monto.`
        );
        if (!confirmar) return;
        guardarSaldoFavor = true;
    }

    // Clave de idempotencia: si el mismo intento se reenvía (internet lento,
    // doble clic, reintento manual), el backend no lo registra dos veces.
    if (!abonoIdempotencyKey) {
        abonoIdempotencyKey = generarClaveIdempotencia();
    }

    const payload = {
        cliente_id: datosFichaActual.cliente.id,
        tasa_cambio: tasa.toFixed(2),
        guardar_saldo_favor: guardarSaldoFavor,
        referencia: referencia,
        idempotency_key: abonoIdempotencyKey,
        // Solo fecha actual o pasada; el backend rechaza futuras.
        fecha: (document.getElementById('abono-fecha') || {}).value || null,
        pagos: pagos
    };

    let btnConfirmar = null;
    let btnCerrar = null;
    let btnCancelar = null;
    try {
        abonoEnCurso = true;
        cierreAbonoPermitido = false;

        btnConfirmar = document.getElementById('btn-confirmar-abono');
        btnCerrar = document.getElementById('btn-cerrar-abono');
        btnCancelar = document.getElementById('btn-cancelar-abono');
        setBotonProcesando(btnConfirmar, true, 'PROCESANDO...');
        if (btnCerrar) btnCerrar.disabled = true;
        if (btnCancelar) btnCancelar.disabled = true;

        const respuesta = await apiFetch('/cxc/abonar-masivo/', 'POST', payload);

        let mensaje;
        if (respuesta.duplicado) {
            mensaje = "Este abono ya había sido registrado antes.\n\n" +
                      "El sistema no lo duplicó; la deuda y el saldo a favor ya están actualizados.";
        } else {
            mensaje = "Abono procesado exitosamente.\n\n";
            if (respuesta.facturas_afectadas && respuesta.facturas_afectadas.length > 0) {
                mensaje += "Facturas pagadas/actualizadas:\n";
                respuesta.facturas_afectadas.forEach(f => {
                    mensaje += `  - Factura #${f.venta_id}: $${f.monto_aplicado.toFixed(2)} aplicado\n`;
                });
            }
            if (respuesta.saldo_sobrante_guardado > 0) {
                mensaje += `\nSaldo a favor guardado: $${respuesta.saldo_sobrante_guardado.toFixed(2)}`;
            }
            if (respuesta.saldo_a_favor > 0) {
                mensaje += `\nSaldo a favor total del cliente: $${respuesta.saldo_a_favor.toFixed(2)}`;
            }
        }

        alert(mensaje);

        // La operación terminó: el intento ya no debe reutilizar esta clave.
        abonoIdempotencyKey = null;
        cierreAbonoPermitido = true;
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNuevoAbono')).hide();
        cargarClientes();
        verFichaCliente(datosFichaActual.cliente.id);

    } catch (error) {
        // No se reintenta automáticamente: la confirmacion de sobrante ya se
        // hizo antes de enviar. Mantenemos la misma clave para que un reintento
        // manual del usuario tampoco duplique el abono.
        const detalle = error && (error.error || error.detail || error.messageForUser);
        alert("Error al procesar el abono: " + (detalle || "Error desconocido."));
    } finally {
        abonoEnCurso = false;
        cierreAbonoPermitido = false;
        setBotonProcesando(btnConfirmar, false);
        if (btnCerrar) btnCerrar.disabled = false;
        if (btnCancelar) btnCancelar.disabled = false;
    }
}
