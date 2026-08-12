// assets/js/inventario.js

// ==============================================================================
// 1. ESTADO GLOBAL
// ==============================================================================
let tomasCache = [];
let tomaActiva = null;
let detallesToma = [];
let productosCache = [];
let almacenesCache = [];
let indiceConteo = 0;
let conteoModificado = false;

// ==============================================================================
// 2. INICIALIZACIÓN
// ==============================================================================
document.addEventListener('DOMContentLoaded', function() {
    if (!localStorage.getItem('access_token')) {
        window.location.href = 'index.html';
        return;
    }
    inicializarInventario();
});

async function inicializarInventario() {
    try {
        await cargarAlmacenes();
        await cargarProductos();
        await cargarTomas();
    } catch (e) {
        console.error("Error inicializando inventario:", e);
        alert("Error al cargar el módulo de inventarios.");
    }
}

async function cargarAlmacenes() {
    try {
        almacenesCache = await apiFetch('/almacenes/', 'GET');
        const select = document.getElementById('nueva-toma-almacen');
        select.innerHTML = almacenesCache.map(a => '<option value="' + a.id + '">' + a.nombre + '</option>').join('');
    } catch (e) {
        console.warn("No se pudieron cargar almacenes:", e);
    }
}

async function cargarProductos() {
    try {
        const resp = await apiFetch('/inventario/productos/', 'GET');
        productosCache = resp;
        renderizarProductosSeleccion();
    } catch (e) {
        console.warn("No se pudieron cargar productos:", e);
    }
}

async function cargarTomas() {
    try {
        tomasCache = await apiFetch('/inventarios/tomas/', 'GET');
        renderizarListaTomas();
    } catch (e) {
        console.error("Error cargando tomas:", e);
        document.getElementById('lista-tomas').innerHTML = '<div class="text-center text-danger p-4">Error cargando tomas</div>';
    }
}

// ==============================================================================
// 3. LISTA DE TOMAS
// ==============================================================================
function renderizarListaTomas(filtrar) {
    const cont = document.getElementById('lista-tomas');
    let lista = tomasCache;

    if (filtrar) {
        const texto = document.getElementById('filtro-tomas').value.toLowerCase();
        lista = tomasCache.filter(t => {
            return String(t.id).includes(texto) ||
                   (t.almacen_nombre || '').toLowerCase().includes(texto) ||
                   (t.tipo_display || '').toLowerCase().includes(texto);
        });
    }

    if (lista.length === 0) {
        cont.innerHTML = '<div class="text-center text-muted p-4">No hay tomas registradas</div>';
        return;
    }

    cont.innerHTML = '';
    lista.forEach(function(t) {
        const item = document.createElement('div');
        item.className = 'toma-card p-3 border-bottom ' + t.estado;
        if (tomaActiva && tomaActiva.id === t.id) item.classList.add('active');

        const badgeClass = t.estado === 'PROCESADO' ? 'bg-success' :
                           t.estado === 'ANULADO' ? 'bg-danger' : 'bg-warning text-dark';

        item.innerHTML = '' +
            '<div class="d-flex justify-content-between align-items-center">' +
                '<div>' +
                    '<h6 class="mb-0 fw-bold">Toma #' + t.id + '</h6>' +
                    '<small class="text-muted">' + (t.almacen_nombre || 'N/A') + ' | ' + (t.tipo_display || '') + '</small>' +
                '</div>' +
                '<span class="badge ' + badgeClass + '">' + (t.estado_display || t.estado) + '</span>' +
            '</div>' +
            '<small class="text-muted">' + new Date(t.fecha_creacion).toLocaleString('es-VE') + '</small>';

        item.onclick = function() { seleccionarToma(t.id); };
        cont.appendChild(item);
    });
}

function filtrarTomas() {
    renderizarListaTomas(true);
}

// ==============================================================================
// 4. DETALLE DE TOMA
// ==============================================================================
async function seleccionarToma(id) {
    try {
        tomaActiva = await apiFetch('/inventarios/tomas/' + id + '/', 'GET');
        detallesToma = tomaActiva.detalles || [];
        renderizarListaTomas();
        renderizarDetalleToma();

        // FIX PC: Reset scroll del panel principal después de que el DOM pinte
        requestAnimationFrame(function() {
            requestAnimationFrame(function() {
                const mainPanel = document.querySelector('.main-panel');
                if (mainPanel) mainPanel.scrollTop = 0;
                const panelDetalle = document.getElementById('panel-detalle');
                if (panelDetalle) panelDetalle.scrollTop = 0;
            });
        });

        // FIX MÓVIL: Activar vista detalle (slide)
        if (window.innerWidth < 768) {
            document.querySelector('.inv-container').classList.add('modo-detalle');
        }
    } catch (e) {
        alert("Error cargando detalle: " + (e.detail || e.error || "Desconocido"));
    }
}

function volverALista() {
    const container = document.querySelector('.inv-container');
    if (container) container.classList.remove('modo-detalle');

    // Esperar la transición CSS antes de limpiar el estado
    setTimeout(function() {
        tomaActiva = null;
        detallesToma = [];
        renderizarListaTomas();
        document.getElementById('panel-detalle').style.display = 'none';
        document.getElementById('panel-vacio').style.display = 'flex';
    }, window.innerWidth < 768 ? 300 : 0);
}

function renderizarDetalleToma() {
    if (!tomaActiva) return;

    document.getElementById('panel-vacio').style.display = 'none';
    document.getElementById('panel-detalle').style.display = 'block';

    document.getElementById('det-toma-id').innerText = tomaActiva.id;
    document.getElementById('det-toma-almacen').innerText = tomaActiva.almacen_nombre || 'N/A';
    document.getElementById('det-toma-usuario').innerText = tomaActiva.usuario_nombre || 'N/A';
    document.getElementById('det-toma-fecha').innerText = new Date(tomaActiva.fecha_creacion).toLocaleString('es-VE');
    document.getElementById('det-toma-tipo').innerText = tomaActiva.tipo_display || tomaActiva.tipo;

    const estadoBadge = document.getElementById('det-toma-estado');
    estadoBadge.innerText = tomaActiva.estado_display || tomaActiva.estado;
    estadoBadge.className = 'badge me-2 ' + (
        tomaActiva.estado === 'PROCESADO' ? 'bg-success' :
        tomaActiva.estado === 'ANULADO' ? 'bg-danger' : 'bg-warning text-dark'
    );

    // Stats
    const r = tomaActiva.resumen || {};
    document.getElementById('stat-faltantes').innerText = r.faltantes || 0;
    document.getElementById('stat-sobrantes').innerText = r.sobrantes || 0;
    document.getElementById('stat-cuadrados').innerText = r.cuadrados || 0;
    document.getElementById('stat-pendientes').innerText = r.pendientes || 0;

    // Footer valores
    document.getElementById('footer-valor-faltantes').innerText = '$ ' + (r.valor_faltantes_usd || 0).toFixed(2);
    document.getElementById('footer-valor-sobrantes').innerText = '$ ' + (r.valor_sobrantes_usd || 0).toFixed(2);
    const neto = (r.valor_sobrantes_usd || 0) - (r.valor_faltantes_usd || 0);
    const elNeto = document.getElementById('footer-valor-neto');
    elNeto.innerText = (neto >= 0 ? '$ ' : '-$ ') + Math.abs(neto).toFixed(2);
    elNeto.className = 'fw-bold ms-2 ' + (neto >= 0 ? 'text-success' : 'text-danger');

    // Botones de acción
    const accionesDiv = document.getElementById('det-toma-acciones');
    let html = '';
    if (tomaActiva.estado === 'BORRADOR') {
        html += '<button class="btn btn-success fw-bold me-1" onclick="procesarToma()"><i class="bi bi-check-circle"></i> PROCESAR</button>';
        html += '<button class="btn btn-danger fw-bold" onclick="anularToma()"><i class="bi bi-x-circle"></i> ANULAR</button>';
    } else if (tomaActiva.estado === 'PROCESADO') {
        html += '<button class="btn btn-dark fw-bold me-1" onclick="verInforme()"><i class="bi bi-file-text"></i> INFORME</button>';
        html += '<button class="btn btn-outline-danger fw-bold" onclick="anularToma()"><i class="bi bi-x-circle"></i> ANULAR</button>';
    }
    accionesDiv.innerHTML = html;

    // Visibilidad botones conteo
    const esBorrador = tomaActiva.estado === 'BORRADOR';
    document.getElementById('btn-conteo-interactivo').style.display = esBorrador ? 'inline-block' : 'none';
    document.getElementById('btn-descargar-excel').style.display = esBorrador ? 'inline-block' : 'none';
    document.getElementById('btn-cargar-excel').style.display = esBorrador ? 'inline-block' : 'none';

    renderizarTablaDetalles();
}

function renderizarTablaDetalles() {
    const tbody = document.getElementById('tabla-detalles-toma');
    tbody.innerHTML = '';

    if (!detallesToma || detallesToma.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-muted text-center py-4">Sin líneas</td></tr>';
        return;
    }

    detallesToma.forEach(function(d) {
        const dif = parseFloat(d.diferencia || 0);
        let clase = 'linea-toma';
        if (dif < 0) clase += ' faltante';
        else if (dif > 0) clase += ' sobrante';
        else clase += ' cuadrado';

        const esBorrador = tomaActiva && tomaActiva.estado === 'BORRADOR';
        const inputFisico = esBorrador
            ? '<input type="number" class="form-control form-control-sm text-end" style="width:100px" step="0.001" value="' + parseFloat(d.stock_fisico).toFixed(3) + '" onchange="actualizarConteoLinea(' + d.id + ', this.value)">'
            : '<span class="fw-bold">' + parseFloat(d.stock_fisico).toFixed(3) + '</span>';

        const difSigno = dif > 0 ? '+' : '';
        const difClass = dif < 0 ? 'text-danger' : dif > 0 ? 'text-success' : 'text-muted';

        const row = document.createElement('tr');
        row.className = clase;
        row.innerHTML = '' +
            '<td class="text-start"><small class="text-muted">' + (d.producto_codigo || '') + '</small><br><span class="fw-bold">' + (d.producto_nombre || '') + '</span></td>' +
            '<td class="text-center">' + (d.unidad || 'und') + '</td>' +
            '<td class="text-end">' + parseFloat(d.stock_teorico).toFixed(3) + '</td>' +
            '<td class="text-end">' + inputFisico + '</td>' +
            '<td class="text-end ' + difClass + ' fw-bold">' + difSigno + dif.toFixed(3) + '</td>' +
            '<td class="text-end">$ ' + parseFloat(d.subtotal_diferencia || 0).toFixed(2) + '</td>' +
            '<td class="text-center"><small class="text-muted">' + (d.observacion_linea || '') + '</small></td>';
        tbody.appendChild(row);
    });
}

// ==============================================================================
// 5. CREAR NUEVA TOMA
// ==============================================================================
function abrirModalNuevaToma() {
    document.getElementById('nueva-toma-tipo').value = 'COMPLETO';
    document.getElementById('nueva-toma-muestra').value = '10';
    document.getElementById('nueva-toma-obs').value = '';
    cambiarTipoToma();
    renderizarProductosSeleccion();
    const modal = new bootstrap.Modal(document.getElementById('modalNuevaToma'));
    modal.show();
}

function cambiarTipoToma() {
    const tipo = document.getElementById('nueva-toma-tipo').value;
    document.getElementById('grupo-muestra').style.display = tipo === 'MUESTRA_ALEATORIA' ? 'block' : 'none';
    document.getElementById('grupo-productos').style.display = tipo === 'POR_PRODUCTO' ? 'block' : 'none';
}

function renderizarProductosSeleccion() {
    const cont = document.getElementById('lista-productos-seleccion');
    if (!productosCache.length) {
        cont.innerHTML = '<div class="list-group-item text-muted small">Cargando productos...</div>';
        return;
    }
    cont.innerHTML = '';
    productosCache.forEach(function(p) {
        const item = document.createElement('label');
        item.className = 'list-group-item d-flex align-items-center';
        item.innerHTML = '' +
            '<input type="checkbox" class="form-check-input me-2 producto-check" value="' + p.id + '">' +
            '<span class="small">' + (p.codigo_base || '') + ' - ' + (p.nombre || '') + '</span>';
        cont.appendChild(item);
    });
}

function filtrarProductosToma() {
    const texto = document.getElementById('buscador-productos-toma').value.toLowerCase();
    const items = document.querySelectorAll('.producto-check');
    items.forEach(function(chk) {
        const label = chk.closest('label');
        const txt = label.innerText.toLowerCase();
        label.style.display = txt.includes(texto) ? 'flex' : 'none';
    });
}

async function crearNuevaToma() {
    const almacenId = document.getElementById('nueva-toma-almacen').value;
    const tipo = document.getElementById('nueva-toma-tipo').value;
    const muestra = parseInt(document.getElementById('nueva-toma-muestra').value) || 10;
    const obs = document.getElementById('nueva-toma-obs').value;

    let productosIds = [];
    if (tipo === 'POR_PRODUCTO') {
        document.querySelectorAll('.producto-check:checked').forEach(function(chk) {
            productosIds.push(parseInt(chk.value));
        });
    }

    const payload = {
        almacen_id: parseInt(almacenId),
        tipo: tipo,
        cantidad_muestra: muestra,
        productos_ids: productosIds,
        observacion: obs
    };

    try {
        const resp = await apiFetch('/inventarios/tomas/crear/', 'POST', payload);
        alert(resp.mensaje);

        const modalEl = document.getElementById('modalNuevaToma');
        bootstrap.Modal.getInstance(modalEl).hide();

        await cargarTomas();
        seleccionarToma(resp.toma_id);
    } catch (e) {
        alert("Error: " + (e.detail || e.error || e.messageForUser || "Desconocido"));
    }
}

// ==============================================================================
// 6. CONTEO INTERACTIVO (1x1)
// ==============================================================================
function iniciarConteoInteractivo() {
    if (!tomaActiva || tomaActiva.estado !== 'BORRADOR') return;
    if (!detallesToma.length) {
        alert("No hay productos para contar.");
        return;
    }
    indiceConteo = 0;
    conteoModificado = false;
    renderizarProductoConteo();
    const modal = new bootstrap.Modal(document.getElementById('modalConteoInteractivo'));
    modal.show();
    setTimeout(function() { document.getElementById('conteo-input-fisico').focus(); document.getElementById('conteo-input-fisico').select(); }, 300);
}

function renderizarProductoConteo() {
    const total = detallesToma.length;
    const d = detallesToma[indiceConteo];

    document.getElementById('conteo-progreso-texto').innerText = (indiceConteo + 1) + ' / ' + total;
    document.getElementById('conteo-progreso-barra').style.width = ((indiceConteo + 1) / total * 100) + '%';

    document.getElementById('conteo-codigo').innerText = d.producto_codigo || 'N/A';
    document.getElementById('conteo-unidad').innerText = d.unidad || 'und';
    document.getElementById('conteo-nombre').innerText = d.producto_nombre || 'Producto';
    document.getElementById('conteo-teorico').innerText = parseFloat(d.stock_teorico).toFixed(3);
    document.getElementById('conteo-input-fisico').value = parseFloat(d.stock_fisico || 0).toFixed(3);

    // Indicadores
    const contInd = document.getElementById('conteo-indicadores');
    contInd.innerHTML = '';
    detallesToma.forEach(function(item, idx) {
        const btn = document.createElement('button');
        btn.className = 'btn btn-sm ' + (idx === indiceConteo ? 'btn-primary' : parseFloat(item.stock_fisico || 0) > 0 ? 'btn-success' : 'btn-outline-secondary');
        btn.style.cssText = 'width: 32px; height: 32px; padding: 0; font-size: 10px;';
        btn.innerText = idx + 1;
        btn.onclick = function() { guardarConteoActual(false); indiceConteo = idx; renderizarProductoConteo(); };
        contInd.appendChild(btn);
    });
}

function manejarTeclaConteo(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        guardarConteoActual(true);
    }
}

async function guardarConteoActual(avanzar) {
    if (avanzar === undefined) avanzar = false;
    const valor = parseFloat(document.getElementById('conteo-input-fisico').value);
    if (isNaN(valor)) {
        alert("Ingresa un número válido.");
        return;
    }

    const detalle = detallesToma[indiceConteo];
    detalle.stock_fisico = valor;
    conteoModificado = true;

    // Guardar en servidor cada 5 productos o al final
    if ((indiceConteo + 1) % 5 === 0 || indiceConteo === detallesToma.length - 1) {
        await guardarConteosParciales();
    }

    if (avanzar) {
        if (indiceConteo < detallesToma.length - 1) {
            indiceConteo++;
            renderizarProductoConteo();
            setTimeout(function() { document.getElementById('conteo-input-fisico').focus(); document.getElementById('conteo-input-fisico').select(); }, 100);
        } else {
            await guardarConteosParciales();
            alert("¡Conteo completado! Todos los productos han sido registrados.");
            cerrarConteoInteractivo();
            seleccionarToma(tomaActiva.id);
        }
    }
}

function navegarConteo(direccion) {
    const nuevo = indiceConteo + direccion;
    if (nuevo >= 0 && nuevo < detallesToma.length) {
        guardarConteoActual(false);
        indiceConteo = nuevo;
        renderizarProductoConteo();
    }
}

async function guardarConteosParciales() {
    if (!conteoModificado || !tomaActiva) return;
    const cambios = detallesToma.map(function(d) {
        return { detalle_id: d.id, stock_fisico: d.stock_fisico };
    });

    try {
        await apiFetch('/inventarios/tomas/' + tomaActiva.id + '/actualizar/', 'PUT', { detalles: cambios });
        conteoModificado = false;
    } catch (e) {
        console.warn("Error guardando conteo parcial:", e);
    }
}

function cerrarConteoInteractivo() {
    if (conteoModificado) {
        guardarConteosParciales();
    }
    bootstrap.Modal.getInstance(document.getElementById('modalConteoInteractivo')).hide();
}

// ==============================================================================
// 7. ACTUALIZAR CONTEO DESDE TABLA
// ==============================================================================
async function actualizarConteoLinea(detalleId, valor) {
    const num = parseFloat(valor);
    if (isNaN(num)) {
        alert("Valor inválido");
        renderizarTablaDetalles();
        return;
    }

    try {
        await apiFetch('/inventarios/tomas/' + tomaActiva.id + '/actualizar/', 'PUT', {
            detalles: [{ detalle_id: detalleId, stock_fisico: num }]
        });
        await seleccionarToma(tomaActiva.id);
    } catch (e) {
        alert("Error: " + (e.detail || e.error || "Desconocido"));
        renderizarTablaDetalles();
    }
}

// ==============================================================================
// 8. EXCEL
// ==============================================================================
function descargarExcelToma() {
    if (!tomaActiva) return;
    window.open('/api/v1/inventarios/tomas/' + tomaActiva.id + '/generar-excel/', '_blank');
}

function abrirModalCargarExcel() {
    document.getElementById('input-excel-toma').value = '';
    new bootstrap.Modal(document.getElementById('modalCargarExcel')).show();
}

async function procesarCargaExcel() {
    const input = document.getElementById('input-excel-toma');
    if (!input.files.length) {
        alert("Selecciona un archivo.");
        return;
    }

    const formData = new FormData();
    formData.append('archivo', input.files[0]);

    try {
        const token = localStorage.getItem('access_token');
        const resp = await fetch('/api/v1/inventarios/tomas/' + tomaActiva.id + '/importar-excel/', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        const data = await resp.json();
        if (!resp.ok) throw data;

        alert(data.mensaje + (data.no_encontrados.length ? '\nNo encontrados: ' + data.no_encontrados.join(', ') : ''));
        bootstrap.Modal.getInstance(document.getElementById('modalCargarExcel')).hide();
        await seleccionarToma(tomaActiva.id);
    } catch (e) {
        alert("Error cargando Excel: " + (e.detail || e.error || e.messageForUser || "Desconocido"));
    }
}

// ==============================================================================
// 9. PROCESAR / ANULAR
// ==============================================================================
async function procesarToma() {
    if (!tomaActiva) return;
    if (!confirm("¿Procesar esta toma? Se crearán los ajustes de stock y no podrás editarla.")) return;

    try {
        const resp = await apiFetch('/inventarios/tomas/' + tomaActiva.id + '/procesar/', 'POST');
        alert(resp.mensaje);
        await cargarTomas();
        seleccionarToma(tomaActiva.id);
    } catch (e) {
        alert("Error: " + (e.detail || e.error || e.messageForUser || "Desconocido"));
    }
}

async function anularToma() {
    if (!tomaActiva) return;
    const msg = tomaActiva.estado === 'PROCESADO'
        ? "¿Anular esta toma? Se REVERTIRÁN los movimientos de stock."
        : "¿Anular esta toma?";
    if (!confirm(msg)) return;

    try {
        const resp = await apiFetch('/inventarios/tomas/' + tomaActiva.id + '/anular/', 'POST');
        alert(resp.mensaje);
        await cargarTomas();
        seleccionarToma(tomaActiva.id);
    } catch (e) {
        alert("Error: " + (e.detail || e.error || e.messageForUser || "Desconocido"));
    }
}

// ==============================================================================
// 10. INFORME E IMPRESIÓN
// ==============================================================================
async function verInforme() {
    if (!tomaActiva) return;
    try {
        const informe = await apiFetch('/inventarios/tomas/' + tomaActiva.id + '/informe/', 'GET');
        mostrarInformeModal(informe);
    } catch (e) {
        alert("Error: " + (e.detail || e.error || "Desconocido"));
    }
}

function mostrarInformeModal(data) {
    const body = document.getElementById('modal-informe-body');
    const r = data.resumen;

    let html = '' +
        '<div class="row g-3 mb-4">' +
            '<div class="col-6 col-md-3"><div class="card text-center border-danger"><div class="card-body"><h4 class="text-danger">' + r.faltantes + '</h4><small>FALTANTES</small></div></div></div>' +
            '<div class="col-6 col-md-3"><div class="card text-center border-success"><div class="card-body"><h4 class="text-success">' + r.sobrantes + '</h4><small>SOBRANTES</small></div></div></div>' +
            '<div class="col-6 col-md-3"><div class="card text-center border-secondary"><div class="card-body"><h4 class="text-secondary">' + r.cuadrados + '</h4><small>CUADRADOS</small></div></div></div>' +
            '<div class="col-6 col-md-3"><div class="card text-center border-dark"><div class="card-body"><h4>' + r.total_lineas + '</h4><small>TOTAL</small></div></div></div>' +
        '</div>' +
        '<div class="row mb-3">' +
            '<div class="col-md-4 text-center"><h5 class="text-danger">$ ' + r.valor_faltantes_usd.toFixed(2) + '</h5><small>Valor Faltantes</small></div>' +
            '<div class="col-md-4 text-center"><h5 class="text-success">$ ' + r.valor_sobrantes_usd.toFixed(2) + '</h5><small>Valor Sobrantes</small></div>' +
            '<div class="col-md-4 text-center"><h5>$ ' + r.valor_neto_usd.toFixed(2) + '</h5><small>Diferencia Neta</small></div>' +
        '</div>';

    if (data.faltantes.length) {
        html += '<h6 class="text-danger fw-bold"><i class="bi bi-dash-circle"></i> Productos Faltantes</h6>' +
                '<div class="table-responsive mb-3"><table class="table table-sm table-bordered"><thead class="table-light"><tr><th>Código</th><th>Producto</th><th>Teórico</th><th>Físico</th><th>Dif.</th><th>Valor USD</th></tr></thead><tbody>';
        data.faltantes.forEach(function(f) {
            html += '<tr><td>' + f.codigo + '</td><td>' + f.nombre + '</td><td>' + f.stock_teorico.toFixed(3) + '</td><td>' + f.stock_fisico.toFixed(3) + '</td><td class="text-danger fw-bold">' + f.diferencia.toFixed(3) + '</td><td>$ ' + f.valor_diferencia_usd.toFixed(2) + '</td></tr>';
        });
        html += '</tbody></table></div>';
    }

    if (data.sobrantes.length) {
        html += '<h6 class="text-success fw-bold"><i class="bi bi-plus-circle"></i> Productos Sobrantes</h6>' +
                '<div class="table-responsive mb-3"><table class="table table-sm table-bordered"><thead class="table-light"><tr><th>Código</th><th>Producto</th><th>Teórico</th><th>Físico</th><th>Dif.</th><th>Valor USD</th></tr></thead><tbody>';
        data.sobrantes.forEach(function(s) {
            html += '<tr><td>' + s.codigo + '</td><td>' + s.nombre + '</td><td>' + s.stock_teorico.toFixed(3) + '</td><td>' + s.stock_fisico.toFixed(3) + '</td><td class="text-success fw-bold">+' + s.diferencia.toFixed(3) + '</td><td>$ ' + s.valor_diferencia_usd.toFixed(2) + '</td></tr>';
        });
        html += '</tbody></table></div>';
    }

    body.innerHTML = html;

    // Preparar ticket
    document.getElementById('ticket-inf-id').innerText = data.toma_id;
    document.getElementById('ticket-inf-fecha').innerText = new Date(data.fecha_cierre || data.fecha_creacion).toLocaleString('es-VE');
    document.getElementById('ticket-inf-almacen').innerText = data.almacen;
    document.getElementById('ticket-inf-total').innerText = r.total_lineas;
    document.getElementById('ticket-inf-cuadrados').innerText = r.cuadrados;
    document.getElementById('ticket-inf-faltantes').innerText = r.faltantes;
    document.getElementById('ticket-inf-sobrantes').innerText = r.sobrantes;
    document.getElementById('ticket-inf-valor-falt').innerText = '$' + r.valor_faltantes_usd.toFixed(2);
    document.getElementById('ticket-inf-valor-sobr').innerText = '$' + r.valor_sobrantes_usd.toFixed(2);
    document.getElementById('ticket-inf-valor-neto').innerText = '$' + r.valor_neto_usd.toFixed(2);

    let faltHtml = '';
    data.faltantes.forEach(function(f) {
        faltHtml += '<div class="fila"><span>' + f.nombre.substring(0, 18) + '</span><span>' + f.diferencia.toFixed(2) + '</span></div>';
    });
    document.getElementById('ticket-inf-lista-faltantes').innerHTML = faltHtml || '<div class="fila"><span>Ninguno</span></div>';

    let sobrHtml = '';
    data.sobrantes.forEach(function(s) {
        sobrHtml += '<div class="fila"><span>' + s.nombre.substring(0, 18) + '</span><span>+' + s.diferencia.toFixed(2) + '</span></div>';
    });
    document.getElementById('ticket-inf-lista-sobrantes').innerHTML = sobrHtml || '<div class="fila"><span>Ninguno</span></div>';

    new bootstrap.Modal(document.getElementById('modalInforme')).show();
}

function imprimirInforme() {
    const ticket = document.getElementById('ticket-informe-impresion');
    ticket.classList.add('activo');
    setTimeout(function() {
        window.print();
        setTimeout(function() { ticket.classList.remove('activo'); }, 500);
    }, 100);
}