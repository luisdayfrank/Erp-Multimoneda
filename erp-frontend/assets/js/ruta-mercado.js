// assets/js/ruta-mercado.js

// ==============================================================================
// ESTADO GLOBAL
// ==============================================================================
let catalogo = [];
let clientesCache = [];
let metodosPagoCache = [];
let conceptosGastoCache = [];
let almacenesCache = [];
let filasProducto = [];
let pagos = [];
let creditos = [];
let gastos = [];
let rutaActualId = null;

// ==============================================================================
// INICIALIZACIÓN
// ==============================================================================
document.addEventListener('DOMContentLoaded', function() {
    if (!localStorage.getItem('access_token')) {
        window.location.href = 'index.html';
        return;
    }
    document.getElementById('ruta-fecha').valueAsDate = new Date();
    document.getElementById('nombreUsuario').innerText = 'Admin'; // Se actualiza luego
    inicializarRutaMercado();
});

async function inicializarRutaMercado() {
    try {
        // Cargar catálogo, clientes, métodos, conceptos, almacenes
        const [catalogoResp, datosResp, conceptosResp] = await Promise.all([
            apiFetch('/pos/catalogo/', 'GET'),
            apiFetch('/pos/datos-iniciales/', 'GET'),
            apiFetch('/egresos/conceptos/', 'GET')
        ]);

        catalogo = Array.isArray(catalogoResp) ? catalogoResp : (catalogoResp.results || []);
        clientesCache = datosResp.clientes || [];
        metodosPagoCache = datosResp.metodos_pago || [];
        conceptosGastoCache = conceptosResp || [];

        // Cargar almacenes (usamos el mismo endpoint o asumimos almacén 1 por defecto)
        // Cargar almacenes reales
        try {
            const almResp = await apiFetch('/almacenes/', 'GET');
            almacenesCache = almResp;
        } catch (e) {
            almacenesCache = [{id: 1, nombre: 'Almacén Principal'}];
        }

        llenarSelects();
        agregarPago(); // Una línea de pago por defecto

        // Cargar tasa actual
        const tasaResp = await apiFetch('/config/tasa-status/', 'GET');
        const tasa = parseFloat(tasaResp.tasa_cambio_actual) || 0;
        document.getElementById('ruta-tasa').value = tasa.toFixed(2);
        document.getElementById('tasaDisplay').innerText = 'Tasa: BS ' + tasa.toFixed(2);

    } catch (e) {
        console.error('Error inicializando:', e);
        alert('Error al cargar datos iniciales.');
    }
}

function llenarSelects() {
    // Almacén
    const selAlmacen = document.getElementById('ruta-almacen');
    selAlmacen.innerHTML = almacenesCache.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');

    // Tipo Excel
    document.getElementById('excel-tipo').addEventListener('change', function() {
        const manual = this.value === 'MANUAL';
        document.getElementById('alerta-seleccion-manual').style.display = manual ? 'block' : 'none';
        if (manual) {
            // Si elige manual, mostramos todos los productos en el grid para que seleccione
            renderizarGridSeleccionManual();
        }
    });
}

// ==============================================================================
// GENERAR EXCEL
// ==============================================================================
async function generarExcel() {
    const tipo = document.getElementById('excel-tipo').value;
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    const incluirPrecio = true;

    let productosIds = [];
    if (tipo === 'MANUAL') {
        productosIds = filasProducto.filter(f => f.presentacion_id).map(f => f.presentacion_id);
        if (productosIds.length === 0) {
            alert('Selecciona productos en el grid primero.');
            return;
        }
    }

    try {
        const resp = await fetch(`${BASE_URL}/rutas/generar-excel/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('access_token')}`
            },
            body: JSON.stringify({
                tipo: tipo,
                tasa_cambio: tasa,
                incluir_precio_sugerido: incluirPrecio,
                productos_ids: productosIds
            })
        });

        if (!resp.ok) throw new Error('Error al generar Excel');

        const blob = await resp.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ruta_mercado_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();

    } catch (e) {
        alert('Error: ' + e.message);
    }
}

// ==============================================================================
// IMPORTAR EXCEL
// ==============================================================================
const dropZone = document.getElementById('dropZone');
if (dropZone) {
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) subirExcel(e.dataTransfer.files[0]);
    });
}

async function subirExcel(file) {
    if (!file) return;
    if (!file.name.endsWith('.xlsx')) {
        alert('Solo se aceptan archivos .xlsx');
        return;
    }

    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;

    const formData = new FormData();
    formData.append('archivo', file);
    formData.append('tasa_cambio', tasa);

    try {
        const resp = await fetch(`${BASE_URL}/rutas/importar-excel/`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token')}` },
            body: formData
        });

        const text = await resp.text();
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            throw new Error('La respuesta del servidor no es válida. ¿Subiste un .xlsx generado por este módulo?');
        }

        if (!resp.ok) throw new Error(data.error || 'Error al importar');

        // Limpiar y rellenar
        filasProducto = [];
        (data.detalles || []).forEach(d => {
            filasProducto.push({
                presentacion_id: d.presentacion_id,
                nombre: d.nombre_producto,
                salida: d.cantidad_salida || 0,
                entrada: d.cantidad_entrada || 0,
                precio_bs: d.precio_venta_bs || 0
            });
        });

        renderizarTablaProductos();
        recalcularTodo();

        if (data.no_encontrados && data.no_encontrados.length > 0) {
            console.warn('No encontrados:', data.no_encontrados);
            alert('?? Productos no reconocidos:\n' + data.no_encontrados.join(', ') + '\n\nDebes crearlos en el catálogo primero o escribir el nombre exacto.');
        } else {
            alert('? Excel importado correctamente. ' + data.detalles_encontrados + ' productos cargados.');
        }

    } catch (e) {
        alert('? Error al subir Excel:\n' + e.message);
        console.error(e);
    }
}

// ==============================================================================
// GRID DE PRODUCTOS
// ==============================================================================
function renderizarTablaProductos() {
    const tbody = document.getElementById('tbodyProductos');
    tbody.innerHTML = '';

    if (filasProducto.length === 0) {
        tbody.innerHTML = `<tr id="fila-vacia"><td colspan="9" class="text-muted text-center py-4">
            <i class="bi bi-inbox fs-2 d-block mb-2"></i>Genera un Excel o añade productos manualmente</td></tr>`;
        return;
    }

    filasProducto.forEach((fila, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <select class="form-select form-select-sm" onchange="cambiarProducto(${index}, this.value)">
                    <option value="">-- Seleccionar --</option>
                    ${catalogo.map(p => `<option value="${p.id}" ${p.id == fila.presentacion_id ? 'selected' : ''}>${p.producto.nombre} (${p.nombre_presentacion})</option>`).join('')}
                </select>
            </td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.salida}" onchange="actualizarFila(${index}, 'salida', this.value)"></td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.entrada}" onchange="actualizarFila(${index}, 'entrada', this.value)"></td>
            <td class="text-center fw-bold text-primary">${calcularFila(fila).vendido.toFixed(2)}</td>
            <td><input type="number" class="form-control form-control-sm" step="0.01" value="${fila.precio_bs}" onchange="actualizarFila(${index}, 'precio_bs', this.value)"></td>
            <td class="text-center">${calcularFila(fila).precioUSD.toFixed(2)}</td>
            <td class="text-center fw-bold">${calcularFila(fila).totalBS.toFixed(2)}</td>
            <td class="text-center fw-bold text-success">${calcularFila(fila).totalUSD.toFixed(2)}</td>
            <td><button class="btn btn-sm btn-outline-danger" onclick="eliminarFila(${index})"><i class="bi bi-trash"></i></button></td>
        `;
        tbody.appendChild(tr);
    });
}

function calcularFila(fila) {
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    const salida = parseFloat(fila.salida) || 0;
    const entrada = parseFloat(fila.entrada) || 0;
    const precioBS = parseFloat(fila.precio_bs) || 0;
    const vendido = Math.max(0, salida - entrada);
    const precioUSD = tasa > 0 ? precioBS / tasa : 0;
    const totalBS = vendido * precioBS;
    const totalUSD = vendido * precioUSD;
    return { vendido, precioUSD, totalBS, totalUSD };
}

function actualizarFila(index, campo, valor) {
    filasProducto[index][campo] = valor;
    renderizarTablaProductos();
    recalcularCuadre();
}

function cambiarProducto(index, presentacionId) {
    const pres = catalogo.find(p => p.id == presentacionId);
    if (!pres) return;
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    filasProducto[index] = {
        presentacion_id: pres.id,
        nombre: pres.producto.nombre + ' (' + pres.nombre_presentacion + ')',
        salida: filasProducto[index]?.salida || 0,
        entrada: filasProducto[index]?.entrada || 0,
        precio_bs: tasa > 0 ? parseFloat(pres.precio_venta_principal) * tasa : 0
    };
    renderizarTablaProductos();
    recalcularCuadre();
}

function agregarFilaVacia() {
    filasProducto.push({ presentacion_id: null, nombre: '', salida: 0, entrada: 0, precio_bs: 0 });
    renderizarTablaProductos();
}

function eliminarFila(index) {
    filasProducto.splice(index, 1);
    renderizarTablaProductos();
    recalcularCuadre();
}

function renderizarGridSeleccionManual() {
    // Muestra todos los productos para que el usuario seleccione cuáles quiere en el Excel
    filasProducto = catalogo.map(p => ({
        presentacion_id: p.id,
        nombre: p.producto.nombre + ' (' + p.nombre_presentacion + ')',
        salida: 0, entrada: 0, precio_bs: 0
    }));
    renderizarTablaProductos();
}

// ==============================================================================
// FINANCIERO: PAGOS, CRÉDITOS, GASTOS
// ==============================================================================
function agregarPago() {
    const cont = document.getElementById('contenedor-pagos');
    const idx = pagos.length;
    const div = document.createElement('div');
    div.className = 'input-group input-group-sm mb-2';
    div.innerHTML = `
        <select class="form-select" id="pago-metodo-${idx}" style="max-width:140px;">
            ${metodosPagoCache.map(m => `<option value="${m.id}">${m.nombre}</option>`).join('')}
        </select>
        <input type="number" class="form-control" id="pago-monto-${idx}" step="0.01" placeholder="BS" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarPago(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    pagos.push({ metodo_id: null, monto_bs: 0 });
}

function eliminarPago(idx) {
    const cont = document.getElementById('contenedor-pagos');
    if (cont.children[idx]) cont.removeChild(cont.children[idx]);
    pagos.splice(idx, 1);
    recalcularCuadre();
}

function agregarCredito() {
    const cont = document.getElementById('contenedor-creditos');
    const idx = creditos.length;
    const div = document.createElement('div');
    div.className = 'input-group input-group-sm mb-2';
    div.innerHTML = `
        <select class="form-select" id="credito-cliente-${idx}" style="max-width:140px;">
            ${clientesCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
        </select>
        <input type="number" class="form-control" id="credito-monto-${idx}" step="0.01" placeholder="BS" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarCredito(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    creditos.push({ cliente_id: null, monto_bs: 0 });
}

function eliminarCredito(idx) {
    const cont = document.getElementById('contenedor-creditos');
    if (cont.children[idx]) cont.removeChild(cont.children[idx]);
    creditos.splice(idx, 1);
    recalcularCuadre();
}

function agregarGasto() {
    const cont = document.getElementById('contenedor-gastos');
    const idx = gastos.length;
    const div = document.createElement('div');
    div.className = 'input-group input-group-sm mb-2';
    div.innerHTML = `
        <select class="form-select" id="gasto-concepto-${idx}" style="max-width:140px;">
            ${conceptosGastoCache.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('')}
        </select>
        <input type="number" class="form-control" id="gasto-monto-${idx}" step="0.01" placeholder="BS" onchange="recalcularCuadre()">
        <button class="btn btn-outline-danger" type="button" onclick="eliminarGasto(${idx})"><i class="bi bi-x"></i></button>
    `;
    cont.appendChild(div);
    gastos.push({ concepto_id: null, monto_bs: 0 });
}

function eliminarGasto(idx) {
    const cont = document.getElementById('contenedor-gastos');
    if (cont.children[idx]) cont.removeChild(cont.children[idx]);
    gastos.splice(idx, 1);
    recalcularCuadre();
}

// ==============================================================================
// CUADRE EN TIEMPO REAL
// ==============================================================================
function recalcularTodo() {
    renderizarTablaProductos();
    recalcularCuadre();
}

function recalcularCuadre() {
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;

    // Productos
    let totalVentaBS = 0;
    let totalVentaUSD = 0;
    filasProducto.forEach(f => {
        const c = calcularFila(f);
        totalVentaBS += c.totalBS;
        totalVentaUSD += c.totalUSD;
    });

    // Pagos
    let totalPagosBS = 0;
    const contPagos = document.getElementById('contenedor-pagos');
    Array.from(contPagos.children).forEach((div, idx) => {
        const monto = parseFloat(div.querySelector('input').value) || 0;
        pagos[idx] = {
            metodo_id: parseInt(div.querySelector('select').value),
            monto_bs: monto
        };
        totalPagosBS += monto;
    });

    // Créditos
    let totalCreditosBS = 0;
    const contCreditos = document.getElementById('contenedor-creditos');
    Array.from(contCreditos.children).forEach((div, idx) => {
        const monto = parseFloat(div.querySelector('input').value) || 0;
        creditos[idx] = {
            cliente_id: parseInt(div.querySelector('select').value),
            monto_bs: monto
        };
        totalCreditosBS += monto;
    });

    // Gastos
    let totalGastosBS = 0;
    const contGastos = document.getElementById('contenedor-gastos');
    Array.from(contGastos.children).forEach((div, idx) => {
        const monto = parseFloat(div.querySelector('input').value) || 0;
        gastos[idx] = {
            concepto_id: parseInt(div.querySelector('select').value),
            monto_bs: monto
        };
        totalGastosBS += monto;
    });

    // Cobranzas
    const cobranzasBS = parseFloat(document.getElementById('cobranzas-bs').value) || 0;

    // Cuadre
    const esperadoBS = totalVentaBS - totalCreditosBS - totalGastosBS + cobranzasBS;
    const realBS = totalPagosBS + cobranzasBS;
    const diferenciaBS = realBS - esperadoBS;

    // Mostrar
    document.getElementById('cuadre-venta-bs').innerText = 'BS ' + totalVentaBS.toFixed(2);
    document.getElementById('cuadre-venta-usd').innerText = '$ ' + totalVentaUSD.toFixed(2);
    document.getElementById('cuadre-esperado-bs').innerText = 'BS ' + esperadoBS.toFixed(2);
    document.getElementById('cuadre-real-bs').innerText = 'BS ' + realBS.toFixed(2);

    const elDif = document.getElementById('cuadre-diferencia-bs');
    elDif.innerText = (diferenciaBS >= 0 ? '+ ' : '- ') + 'BS ' + Math.abs(diferenciaBS).toFixed(2);
    elDif.className = 'mb-0 ' + (diferenciaBS >= -0.01 ? 'cuadre-positivo' : 'cuadre-negativo');
}

// ==============================================================================
// GUARDAR / CERRAR RUTA
// ==============================================================================
function construirPayload() {
    const tasa = parseFloat(document.getElementById('ruta-tasa').value) || 0;
    const almacenId = parseInt(document.getElementById('ruta-almacen').value) || 1;
    const fecha = document.getElementById('ruta-fecha').value;
    const obs = document.getElementById('ruta-obs').value;

    // Filtrar filas válidas
    const detalles = filasProducto
        .filter(f => f.presentacion_id)
        .map(f => ({
            presentacion_id: f.presentacion_id,
            cantidad_salida: parseFloat(f.salida || 0).toFixed(2),
            cantidad_entrada: parseFloat(f.entrada || 0).toFixed(2),
            precio_venta_bs: parseFloat(f.precio_bs || 0).toFixed(2)
        }));

    const pagosPayload = pagos
        .filter(p => p.metodo_id && p.monto_bs > 0)
        .map(p => ({
            metodo_id: p.metodo_id,
            monto_bs: parseFloat(p.monto_bs).toFixed(2),
            monto_usd_equivalente: tasa > 0 ? (p.monto_bs / tasa).toFixed(2) : '0.00',
            referencia: ''
        }));

    const creditosPayload = creditos
        .filter(c => c.cliente_id && c.monto_bs > 0)
        .map(c => ({
            cliente_id: c.cliente_id,
            monto_bs: parseFloat(c.monto_bs).toFixed(2),
            descripcion: ''
        }));

    const gastosPayload = gastos
        .filter(g => g.concepto_id && g.monto_bs > 0)
        .map(g => ({
            concepto_id: g.concepto_id,
            monto_bs: parseFloat(g.monto_bs).toFixed(2),
            descripcion: ''
        }));

    const cobranzasBS = parseFloat(document.getElementById('cobranzas-bs').value) || 0;

    return {
        fecha: fecha,
        almacen: almacenId,
        tasa_cambio: tasa.toFixed(2),
        observacion: obs,
        total_cobranzas_bs: cobranzasBS.toFixed(2),
        detalles: detalles,
        pagos: pagosPayload,
        creditos: creditosPayload,
        gastos: gastosPayload
    };
}

async function guardarRuta(estado) {
    const payload = construirPayload();
    if (payload.detalles.length === 0) {
        alert('Debes tener al menos un producto.');
        return;
    }

    try {
        let resp;
        if (rutaActualId) {
            resp = await apiFetch(`/rutas/${rutaActualId}/`, 'PUT', payload);
        } else {
            resp = await apiFetch('/rutas/', 'POST', payload);
            rutaActualId = resp.id;
        }
        alert(`Ruta guardada como ${estado}. ID: ${resp.id}`);
        if (estado === 'CERRADA') {
            await cerrarRutaBackend(resp.id);
        }
    } catch (e) {
        alert('Error al guardar: ' + (e.detail || e.error || e.message || 'Error desconocido'));
    }
}

async function cerrarRuta() {
    if (!confirm('¿Estás seguro de cerrar la ruta? Esto descontará el inventario y generará las deudas. No se puede deshacer fácilmente.')) return;
    await guardarRuta('CERRADA');
}

async function cerrarRutaBackend(id) {
    try {
        const resp = await apiFetch(`/rutas/${id}/cerrar/`, 'POST');
        alert('Ruta cerrada exitosamente. Inventario actualizado y créditos generados.');
        rutaActualId = null;
        resetearFormulario();
    } catch (e) {
        alert('Error al cerrar: ' + (e.error || e.detail || 'Error'));
    }
}

function resetearFormulario() {
    filasProducto = [];
    pagos = []; creditos = []; gastos = [];
    document.getElementById('contenedor-pagos').innerHTML = '';
    document.getElementById('contenedor-creditos').innerHTML = '';
    document.getElementById('contenedor-gastos').innerHTML = '';
    document.getElementById('cobranzas-bs').value = '0.00';
    document.getElementById('ruta-obs').value = '';
    agregarPago();
    renderizarTablaProductos();
    recalcularCuadre();
}

// ==============================================================================
// HISTORIAL
// ==============================================================================
async function cargarHistorial() {
    const tbody = document.getElementById('tbodyHistorial');
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Cargando...</td></tr>';

    try {
        const rutas = await apiFetch('/rutas/', 'GET');
        tbody.innerHTML = '';
        if (rutas.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No hay rutas registradas</td></tr>';
            return;
        }

        rutas.forEach(r => {
            const tr = document.createElement('tr');
            tr.className = 'historial-item';
            const difClass = parseFloat(r.diferencia_bs) < -0.01 ? 'text-danger' : (parseFloat(r.diferencia_bs) > 0.01 ? 'text-success' : 'text-muted');
            tr.innerHTML = `
                <td>${r.id}</td>
                <td>${new Date(r.fecha).toLocaleDateString('es-VE')}</td>
                <td><span class="badge bg-${r.estado === 'CERRADA' ? 'success' : 'warning'}">${r.estado}</span></td>
                <td>$ ${parseFloat(r.total_venta_usd || 0).toFixed(2)}</td>
                <td class="${difClass} fw-bold">BS ${parseFloat(r.diferencia_bs || 0).toFixed(2)}</td>
                <td>${r.usuario_nombre || 'Admin'}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="verRuta(${r.id})"><i class="bi bi-eye"></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-danger py-4">Error al cargar historial</td></tr>';
    }
}

let rutaEnVista = null;
async function verRuta(id) {
    try {
        const r = await apiFetch(`/rutas/${id}/`, 'GET');
        rutaEnVista = r;
        document.getElementById('ver-ruta-id').innerText = r.id;
        const modal = new bootstrap.Modal(document.getElementById('modalVerRuta'));
        
        // Mostrar/ocultar botón reabrir según rol/estado
        const btnReabrir = document.getElementById('btn-reabrir-ruta');
        btnReabrir.style.display = r.estado === 'CERRADA' ? 'inline-block' : 'none';

        // Construir HTML del detalle
        let html = `
            <div class="row mb-3">
                <div class="col-md-6"><strong>Fecha:</strong> ${new Date(r.fecha).toLocaleDateString('es-VE')}</div>
                <div class="col-md-6"><strong>Estado:</strong> <span class="badge bg-${r.estado === 'CERRADA' ? 'success' : 'warning'}">${r.estado}</span></div>
                <div class="col-md-6"><strong>Tasa:</strong> BS ${parseFloat(r.tasa_cambio).toFixed(2)}</div>
                <div class="col-md-6"><strong>Observación:</strong> ${r.observacion || 'N/A'}</div>
            </div>
            <h6 class="fw-bold">Productos</h6>
            <table class="table table-sm table-bordered">
                <thead class="table-light"><tr><th>Producto</th><th>Salida</th><th>Entrada</th><th>Vendido</th><th>Precio BS</th><th>Total $</th></tr></thead>
                <tbody>
                    ${(r.detalles || []).map(d => `
                        <tr>
                            <td>${d.nombre_producto || d.nombre_presentacion}</td>
                            <td>${d.cantidad_salida}</td>
                            <td>${d.cantidad_entrada}</td>
                            <td class="fw-bold text-primary">${d.cantidad_vendida}</td>
                            <td>${d.precio_venta_bs}</td>
                            <td class="fw-bold text-success">${parseFloat(d.subtotal_usd || 0).toFixed(2)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="row">
                <div class="col-md-4">
                    <h6 class="fw-bold text-success">Pagos</h6>
                    <ul class="list-group list-group-flush">
                        ${(r.pagos || []).map(p => `<li class="list-group-item py-1">${p.metodo_nombre}: BS ${p.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin pagos</li>'}
                    </ul>
                </div>
                <div class="col-md-4">
                    <h6 class="fw-bold text-warning">Créditos</h6>
                    <ul class="list-group list-group-flush">
                        ${(r.creditos || []).map(c => `<li class="list-group-item py-1">${c.cliente_nombre}: BS ${c.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin créditos</li>'}
                    </ul>
                </div>
                <div class="col-md-4">
                    <h6 class="fw-bold text-danger">Gastos</h6>
                    <ul class="list-group list-group-flush">
                        ${(r.gastos || []).map(g => `<li class="list-group-item py-1">${g.concepto_nombre}: BS ${g.monto_bs}</li>`).join('') || '<li class="list-group-item py-1 text-muted">Sin gastos</li>'}
                    </ul>
                </div>
            </div>
            <hr>
            <div class="row text-center fw-bold">
                <div class="col">Venta: BS ${parseFloat(r.total_venta_bs).toFixed(2)}</div>
                <div class="col">Esperado: BS ${parseFloat(r.recaudado_esperado_bs).toFixed(2)}</div>
                <div class="col">Real: BS ${parseFloat(r.recaudado_real_bs).toFixed(2)}</div>
                <div class="col ${parseFloat(r.diferencia_bs) < 0 ? 'text-danger' : 'text-success'}">Dif: BS ${parseFloat(r.diferencia_bs).toFixed(2)}</div>
            </div>
        `;
        document.getElementById('ver-ruta-contenido').innerHTML = html;
        modal.show();
    } catch (e) {
        alert('Error al cargar ruta: ' + e.message);
    }
}

async function reabrirRutaActual() {
    if (!rutaEnVista) return;
    if (!confirm('¿Reabrir esta ruta? Se revertirá el inventario y se eliminarán las deudas generadas (si no tienen pagos).')) return;

    try {
        await apiFetch(`/rutas/${rutaEnVista.id}/reabrir/`, 'POST');
        alert('Ruta reabierta correctamente.');
        bootstrap.Modal.getInstance(document.getElementById('modalVerRuta')).hide();
        cargarHistorial();
    } catch (e) {
        alert('Error: ' + (e.error || e.detail || 'No se pudo reabrir'));
    }
}

function cerrarSesionLocal() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    window.location.href = 'index.html';
}